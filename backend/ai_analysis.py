#!/usr/bin/env python3
"""
Main AI analysis pipeline for lung nodule detection.
"""

import os
import sys
import logging
import numpy as np
import torch
import cv2
import math
from typing import List, Dict, Optional
import json
from pathlib import Path
import re

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Import local modules
from dicom_utils import (
    load_dicom_series, sort_dicom_slices, dicom_series_to_volume,
    normalize_hu, create_5slice_stack, sliding_window_positions, crop_volume_window,
    get_pixel_spacing
)
from model_inference import load_segmentation_model, run_inference, run_batch_inference, extract_candidates
from overlay_utils import create_overlay_image, create_mask_image, create_transparent_segmentation_overlay
from classifier_inference import (
    load_student_classifier,
    crop_3d_cube,
    make_25d_classifier_input,
    classify_candidate,
    integrate_segmentation_classification_gradcam,
)

MODEL_INPUT_SIZE = 192
MULTI_SCALE_WINDOW_SIZES = [64, 96, 128, 160]
SEGMENTATION_BATCH_SIZE = 24


def natural_sort_key(value: str):
    """Sort file names the same way the Review page does with numeric chunks."""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', value)]


def dicom_sort_key(ds) -> float:
    """Prefer physical z position, then InstanceNumber, matching the intended volume order."""
    if hasattr(ds, 'ImagePositionPatient') and len(ds.ImagePositionPatient) >= 3:
        return float(ds.ImagePositionPatient[2])
    if hasattr(ds, 'InstanceNumber'):
        return float(ds.InstanceNumber)
    return 0.0


def resize_stack_to_model_input(stack_5d: np.ndarray, target_size: int = MODEL_INPUT_SIZE) -> np.ndarray:
    """Resize a 5-slice crop to the model input resolution slice-by-slice."""
    resized = [
        cv2.resize(slice_img, (target_size, target_size), interpolation=cv2.INTER_LINEAR)
        for slice_img in stack_5d
    ]
    return np.stack(resized, axis=0).astype(np.float32)


def resize_map(map_2d: np.ndarray, size: int, interpolation: int) -> np.ndarray:
    return cv2.resize(map_2d.astype(np.float32), (size, size), interpolation=interpolation)


def clamp_window_top_left(center_y: int, center_x: int, height: int, width: int, window_size: int) -> tuple:
    y_start = int(round(center_y - window_size / 2))
    x_start = int(round(center_x - window_size / 2))
    y_start = max(0, min(height - window_size, y_start))
    x_start = max(0, min(width - window_size, x_start))
    return y_start, x_start


def propose_roi_centers(center_slice_norm: np.ndarray, max_centers: int = 28) -> List[tuple]:
    """
    Propose solid/bright compact ROI centers from the CT slice.

    This is not a detector by itself; it only chooses ROI-style crop centers so
    the SegResNet sees inputs closer to its nodule-centered training crops.
    """
    h, w = center_slice_norm.shape
    img = center_slice_norm.astype(np.float32)

    # Body-ish mask removes external black air. Candidate mask keeps denser
    # lung findings/vessels while avoiding the huge mediastinum components.
    body_mask = (img > 0.05).astype(np.uint8)
    body_mask = cv2.morphologyEx(body_mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    candidate_mask = ((img > 0.42) & (img < 0.98) & (body_mask > 0)).astype(np.uint8)
    candidate_mask = cv2.morphologyEx(candidate_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(candidate_mask, connectivity=8)
    centers = []
    image_center_x = w / 2.0

    for label in range(1, num_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < 6 or area > 1800:
            continue

        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        bw = int(stats[label, cv2.CC_STAT_WIDTH])
        bh = int(stats[label, cv2.CC_STAT_HEIGHT])
        if bw < 3 or bh < 3 or bw > 85 or bh > 85:
            continue

        aspect = min(bw, bh) / float(max(bw, bh, 1))
        fill = area / float(max(1, bw * bh))
        if aspect < 0.18:
            continue

        component_values = img[labels == label]
        max_value = float(np.max(component_values))
        mean_value = float(np.mean(component_values))
        cx, cy = centroids[label]

        # No left/right anatomical prior. Mildly prefer compact, dense blobs.
        score = max_value * np.log(area + 1.0) * (0.55 + 0.45 * fill) * (0.70 + 0.30 * aspect)
        centers.append({
            "center_y": int(round(cy)),
            "center_x": int(round(cx)),
            "score": float(score),
            "area": area,
            "mean": mean_value,
            "max": max_value,
            "distance_from_midline": abs(float(cx) - image_center_x),
        })

    centers.sort(key=lambda item: item["score"], reverse=True)

    # Keep diverse centers so one vessel cluster cannot consume every ROI.
    kept = []
    for center in centers:
        if any(np.hypot(center["center_x"] - other["center_x"], center["center_y"] - other["center_y"]) < 24 for other in kept):
            continue
        kept.append(center)
        if len(kept) >= max_centers:
            break

    if not kept:
        # Conservative fallback: sparse central grid, still much smaller than
        # the previous full multi-scale sweep.
        grid_y = np.linspace(h * 0.25, h * 0.75, 5).astype(int)
        grid_x = np.linspace(w * 0.25, w * 0.75, 5).astype(int)
        kept = [{"center_y": int(y), "center_x": int(x), "score": 0.0} for y in grid_y for x in grid_x]

    return [(item["center_y"], item["center_x"]) for item in kept]


def roi_window_positions(center_slice_norm: np.ndarray, window_size: int) -> List[tuple]:
    h, w = center_slice_norm.shape
    positions = set()
    for center_y, center_x in propose_roi_centers(center_slice_norm):
        positions.add(clamp_window_top_left(center_y, center_x, h, w, window_size))
    return sorted(positions)


def expand_candidate_bbox(local_bbox: Dict, y_start: int, x_start: int) -> Dict:
    """Convert bbox coordinates from crop space to full-slice space."""
    y_min = int(local_bbox['y_min'] + y_start)
    y_max = int(local_bbox['y_max'] + y_start)
    x_min = int(local_bbox['x_min'] + x_start)
    x_max = int(local_bbox['x_max'] + x_start)
    return {
        'y_min': y_min,
        'y_max': y_max,
        'x_min': x_min,
        'x_max': x_max,
        'width': max(1, x_max - x_min),
        'height': max(1, y_max - y_min),
        'center_x': (x_min + x_max) // 2,
        'center_y': (y_min + y_max) // 2,
    }


def lung_context_score(slice_norm: np.ndarray, bbox: Dict, margin: int = 20) -> float:
    """Estimate whether a candidate sits inside aerated lung context."""
    h, w = slice_norm.shape
    x0 = max(0, int(bbox['x_min']) - margin)
    x1 = min(w, int(bbox['x_max']) + margin + 1)
    y0 = max(0, int(bbox['y_min']) - margin)
    y1 = min(h, int(bbox['y_max']) + margin + 1)
    if x1 <= x0 or y1 <= y0:
        return 0.0

    region = slice_norm[y0:y1, x0:x1]
    # normalized HU roughly [-1000, 400] -> lung parenchyma tends to be low.
    lung_like = (region > 0.03) & (region < 0.55)

    # Remove the candidate bbox itself from the context measurement.
    inner = np.zeros_like(lung_like, dtype=bool)
    bx0 = max(0, int(bbox['x_min']) - x0)
    bx1 = min(inner.shape[1], int(bbox['x_max']) - x0 + 1)
    by0 = max(0, int(bbox['y_min']) - y0)
    by1 = min(inner.shape[0], int(bbox['y_max']) - y0 + 1)
    inner[by0:by1, bx0:bx1] = True
    context = ~inner
    if int(context.sum()) == 0:
        return 0.0
    return float(lung_like[context].mean())


def candidate_full_mask(candidate: Dict, height: int, width: int) -> np.ndarray:
    """Place a candidate's local component mask back into full-slice coordinates."""
    full_mask = np.zeros((height, width), dtype=np.uint8)
    local_mask = candidate.get('mask')
    if local_mask is None:
        bbox = candidate.get('bbox')
        if bbox:
            full_mask[bbox['y_min']:bbox['y_max'] + 1, bbox['x_min']:bbox['x_max'] + 1] = 1
        return full_mask

    y_start = int(candidate.get('window_y', 0))
    x_start = int(candidate.get('window_x', 0))
    window_size = int(candidate.get('window_size', local_mask.shape[0]))
    if local_mask.shape != (window_size, window_size):
        local_mask = cv2.resize(local_mask.astype(np.uint8), (window_size, window_size), interpolation=cv2.INTER_NEAREST)

    y_end = min(height, y_start + window_size)
    x_end = min(width, x_start + window_size)
    full_mask[y_start:y_end, x_start:x_end] = local_mask[:y_end - y_start, :x_end - x_start]
    return full_mask


def candidate_probability_map(candidate: Dict, height: int, width: int) -> np.ndarray:
    """Place candidate local probabilities into full-slice coordinates."""
    full_probs = np.zeros((height, width), dtype=np.float32)
    local_probs = candidate.get('probabilities')
    local_mask = candidate.get('mask')
    if local_probs is None:
        return full_probs

    y_start = int(candidate.get('window_y', 0))
    x_start = int(candidate.get('window_x', 0))
    window_size = int(candidate.get('window_size', local_probs.shape[0]))
    if local_probs.shape != (window_size, window_size):
        local_probs = cv2.resize(local_probs.astype(np.float32), (window_size, window_size), interpolation=cv2.INTER_LINEAR)
    if local_mask is not None and local_mask.shape != (window_size, window_size):
        local_mask = cv2.resize(local_mask.astype(np.uint8), (window_size, window_size), interpolation=cv2.INTER_NEAREST)

    if local_mask is not None:
        local_probs = np.where(local_mask > 0, local_probs, 0.0)

    y_end = min(height, y_start + window_size)
    x_end = min(width, x_start + window_size)
    full_probs[y_start:y_end, x_start:x_end] = local_probs[:y_end - y_start, :x_end - x_start]
    return full_probs


def estimate_lung_slice_bounds(volume_norm: np.ndarray) -> tuple:
    """Estimate the inclusive slice range where lungs are substantially visible."""
    if volume_norm.ndim != 3 or volume_norm.shape[0] == 0:
        return 0, 0

    slice_scores = []
    kernel = np.ones((7, 7), np.uint8)
    for slice_norm in volume_norm:
        body_mask = (slice_norm > 0.05).astype(np.uint8)
        if int(body_mask.sum()) == 0:
            slice_scores.append(0)
            continue

        body_mask = cv2.morphologyEx(body_mask, cv2.MORPH_CLOSE, kernel)
        lung_like = ((slice_norm > 0.05) & (slice_norm < 0.52) & (body_mask > 0)).astype(np.uint8)
        lung_like = cv2.morphologyEx(lung_like, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        slice_scores.append(int(lung_like.sum()))

    max_score = max(slice_scores, default=0)
    if max_score <= 0:
        return 0, max(0, volume_norm.shape[0] - 1)

    threshold = max(int(max_score * 0.18), int(volume_norm.shape[1] * volume_norm.shape[2] * 0.015))
    valid_indices = [index for index, score in enumerate(slice_scores) if score >= threshold]
    if not valid_indices:
        return 0, max(0, volume_norm.shape[0] - 1)

    return valid_indices[0], valid_indices[-1]


def patient_x_at_pixel(ds, pixel_x: float, pixel_y: float) -> Optional[float]:
    """Map image pixel coordinates to DICOM patient X coordinate when possible."""
    orientation = getattr(ds, 'ImageOrientationPatient', None)
    position = getattr(ds, 'ImagePositionPatient', None)
    if orientation is None or position is None or len(orientation) < 6 or len(position) < 3:
        return None

    try:
        row_spacing_mm, col_spacing_mm = get_pixel_spacing(ds)
        row_cosines = np.asarray(orientation[:3], dtype=np.float32)
        col_cosines = np.asarray(orientation[3:6], dtype=np.float32)
        origin = np.asarray(position[:3], dtype=np.float32)
        patient_point = origin + row_cosines * (col_spacing_mm * float(pixel_x)) + col_cosines * (row_spacing_mm * float(pixel_y))
        return float(patient_point[0])
    except (TypeError, ValueError):
        return None


def estimate_candidate_location(candidate: Dict,
                                dicom_slice,
                                slice_idx: int,
                                num_slices: int,
                                lung_slice_start: int,
                                lung_slice_end: int,
                                image_width: int) -> Dict:
    """Estimate coarse left/right + upper/middle/lower lobe location."""
    bbox = candidate.get('bbox') or {}
    center_x = float(bbox.get('center_x', image_width / 2.0))
    center_y = float(bbox.get('center_y', 0.0))

    patient_x = patient_x_at_pixel(dicom_slice, center_x, center_y)
    center_patient_x = patient_x_at_pixel(dicom_slice, image_width / 2.0, center_y)
    if patient_x is not None and center_patient_x is not None:
        side = 'L' if patient_x > center_patient_x else 'R'
        side_confidence = 'high'
    else:
        side = 'L' if center_x >= image_width / 2.0 else 'R'
        side_confidence = 'medium'

    lung_start = max(0, min(lung_slice_start, num_slices - 1))
    lung_end = max(lung_start, min(lung_slice_end, num_slices - 1))
    if lung_end == lung_start:
        slice_fraction = float(slice_idx) / float(max(1, num_slices - 1))
        vertical_confidence = 'low'
    else:
        slice_fraction = (float(slice_idx) - float(lung_start)) / float(max(1, lung_end - lung_start))
        vertical_confidence = 'medium'
    slice_fraction = float(np.clip(slice_fraction, 0.0, 1.0))

    if side == 'R':
        if slice_fraction < 0.33:
            code = 'RUL'
        elif slice_fraction < 0.66:
            code = 'RML'
        else:
            code = 'RLL'
    else:
        code = 'LUL' if slice_fraction < 0.50 else 'LLL'

    confidence = 'high' if side_confidence == 'high' and vertical_confidence == 'medium' else 'medium' if side_confidence != 'low' else 'low'
    return {
        'code': code,
        'sliceFraction': slice_fraction,
        'lungSliceStart': lung_start,
        'lungSliceEnd': lung_end,
        'confidence': confidence,
        'sideConfidence': side_confidence,
        'patientX': patient_x,
    }


def bbox_iou(box_a: Dict, box_b: Dict) -> float:
    """Compute IoU for two bounding boxes with xy min/max keys."""
    if not box_a or not box_b:
        return 0.0

    x_left = max(box_a['x_min'], box_b['x_min'])
    y_top = max(box_a['y_min'], box_b['y_min'])
    x_right = min(box_a['x_max'], box_b['x_max'])
    y_bottom = min(box_a['y_max'], box_b['y_max'])

    if x_right <= x_left or y_bottom <= y_top:
        return 0.0

    inter = float((x_right - x_left) * (y_bottom - y_top))
    area_a = float(max(1, box_a['width']) * max(1, box_a['height']))
    area_b = float(max(1, box_b['width']) * max(1, box_b['height']))
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def is_duplicate_candidate(candidate: Dict, kept_candidate: Dict) -> bool:
    """Heuristic duplicate test across nearby slices and overlapping boxes."""
    slice_delta = abs(candidate['slice_index'] - kept_candidate['slice_index'])
    if slice_delta > 2:
        return False

    box_a = candidate.get('bbox')
    box_b = kept_candidate.get('bbox')
    if not box_a or not box_b:
        return False

    center_dist = np.hypot(
        float(box_a['center_x']) - float(box_b['center_x']),
        float(box_a['center_y']) - float(box_b['center_y'])
    )
    if center_dist > 40.0:
        return False

    return bbox_iou(box_a, box_b) > 0.25


def candidate_similarity(candidate_a: Dict, candidate_b: Dict) -> bool:
    """Check whether two candidates are likely the same lesion across nearby slices."""
    if abs(candidate_a['slice_index'] - candidate_b['slice_index']) > 2:
        return False

    box_a = candidate_a.get('bbox')
    box_b = candidate_b.get('bbox')
    if not box_a or not box_b:
        return False

    center_dist = float(np.hypot(
        float(box_a['center_x']) - float(box_b['center_x']),
        float(box_a['center_y']) - float(box_b['center_y'])
    ))
    if center_dist > 48.0:
        return False

    return bbox_iou(box_a, box_b) > 0.20


def compute_temporal_support(candidate: Dict, candidates: List[Dict]) -> int:
    """Count similar candidates in neighboring slices."""
    support = 1
    for other in candidates:
        if other is candidate:
            continue
        if abs(other['slice_index'] - candidate['slice_index']) != 1:
            continue
        if candidate_similarity(candidate, other):
            support += 1
    return support


def temporal_boost(score: float, support: int) -> float:
    """Boost multi-slice nodules and penalize isolated single-slice hits."""
    if support <= 1:
        factor = 0.85
    elif support == 2:
        factor = 1.10
    else:
        factor = 1.25
    return score * factor


def group_candidate_clusters(candidates: List[Dict]) -> List[Dict]:
    """Group candidates by nearby slice/location and score lesion-level clusters."""
    clusters = []
    for candidate in sorted(candidates, key=lambda item: item.get('temporal_score', item.get('candidate_score', 0.0)), reverse=True):
        placed = False
        for cluster in clusters:
            if any(candidate_similarity(candidate, member) for member in cluster['members']):
                cluster['members'].append(candidate)
                placed = True
                break
        if not placed:
            clusters.append({'members': [candidate]})

    for cluster in clusters:
        members = cluster['members']
        best = max(members, key=lambda item: item.get('temporal_score', item.get('candidate_score', 0.0)))
        slice_count = len(set(item['slice_index'] for item in members))
        max_prob = max(float(item.get('max_probability', 0.0)) for item in members)
        mean_score = float(np.mean([item.get('temporal_score', item.get('candidate_score', 0.0)) for item in members]))
        cluster['best'] = best
        cluster['slice_count'] = slice_count
        cluster['score'] = float(best.get('temporal_score', best.get('candidate_score', 0.0)) + 0.15 * mean_score + 0.35 * np.log(slice_count + 1.0) * max_prob)

    clusters.sort(key=lambda item: item['score'], reverse=True)
    return clusters


def select_dominant_candidates(candidates: List[Dict], top_k: int) -> List[Dict]:
    """Pick top lesion clusters while suppressing weak isolated false positives."""
    clusters = group_candidate_clusters(candidates)
    if not clusters:
        return []

    selected = []
    best_score = clusters[0]['score']
    for cluster in clusters:
        best = cluster['best']
        if selected:
            isolated = cluster['slice_count'] <= 1
            weak_relative = cluster['score'] < best_score * 0.72
            low_prob = float(best.get('max_probability', 0.0)) < 0.55
            if isolated and (weak_relative or low_prob):
                continue
        best['clusterScore'] = float(cluster['score'])
        best['clusterSliceCount'] = int(cluster['slice_count'])
        selected.append(best)
        if len(selected) >= top_k:
            break

    return selected


def _classifier_probability(candidate: Dict, classifier_results: Dict) -> float:
    """Read classifier probability for a candidate, falling back to segmentation score."""
    result = classifier_results.get(id(candidate), {})
    if result and 'probability' in result:
        return float(result.get('probability', 0.0))
    return float(candidate.get('mean_probability', candidate.get('max_probability', 0.0)))


def classify_candidate_for_ranking(classifier, volume_norm: np.ndarray, candidate: Dict, device: str) -> Optional[Dict]:
    """Run the 2.5D classifier without Grad-CAM so candidate ranking can use classifier probability."""
    bbox = candidate.get("bbox")
    if not bbox:
        return None

    center = (
        int(candidate["slice_index"]),
        int(bbox["center_y"]),
        int(bbox["center_x"]),
    )
    cube, _ = crop_3d_cube(volume_norm, center, size=32)
    classifier_input = make_25d_classifier_input(cube)
    return classify_candidate(classifier, classifier_input, device=device)


def _same_nodule_across_neighbor_slices(candidate_a: Dict,
                                        candidate_b: Dict,
                                        max_slice_gap: int = 6) -> bool:
    """Detect duplicate candidates from the same nodule on nearby slices."""
    slice_gap = abs(int(candidate_a['slice_index']) - int(candidate_b['slice_index']))
    if slice_gap > max_slice_gap:
        return False

    box_a = candidate_a.get('bbox')
    box_b = candidate_b.get('bbox')
    if not box_a or not box_b:
        return False

    center_dist = float(np.hypot(
        float(box_a['center_x']) - float(box_b['center_x']),
        float(box_a['center_y']) - float(box_b['center_y'])
    ))
    avg_size = 0.5 * (
        max(float(box_a.get('width', 0.0)), float(box_a.get('height', 0.0))) +
        max(float(box_b.get('width', 0.0)), float(box_b.get('height', 0.0)))
    )
    distance_limit = float(np.clip(avg_size * 1.35, 30.0, 48.0))

    if center_dist > distance_limit:
        return False

    # Across several CT slices the 2D boxes may shift or stop overlapping, so close
    # centers are enough; IoU is only an extra strong signal when it exists.
    return True


def merge_neighboring_slice_candidates_by_classifier(candidates: List[Dict],
                                                     classifier_results: Dict,
                                                     max_slice_gap: int = 6) -> List[Dict]:
    """Merge same-lesion candidates and keep the highest classifier probability."""
    if len(candidates) <= 1:
        return candidates

    clusters: List[Dict] = []
    ranked = sorted(
        candidates,
        key=lambda item: (
            _classifier_probability(item, classifier_results),
            float(item.get('temporal_score', item.get('candidate_score', 0.0))),
            int(item.get('mask_area', 0)),
        ),
        reverse=True
    )

    for candidate in ranked:
        placed = False
        for cluster in clusters:
            if any(_same_nodule_across_neighbor_slices(candidate, member, max_slice_gap) for member in cluster['members']):
                cluster['members'].append(candidate)
                placed = True
                break
        if not placed:
            clusters.append({'members': [candidate]})

    merged = []
    for cluster in clusters:
        members = cluster['members']
        best = max(
            members,
            key=lambda item: (
                _classifier_probability(item, classifier_results),
                float(item.get('temporal_score', item.get('candidate_score', 0.0))),
                int(item.get('mask_area', 0)),
            )
        )
        display_slices = sorted({
            int(item.get('display_slice_index', item.get('slice_index', 0))) + 1
            for item in members
        })
        model_slices = sorted({int(item.get('slice_index', 0)) for item in members})
        best['mergedCandidateCount'] = int(len(members))
        best['mergedDisplaySlices'] = display_slices
        best['mergedModelSlices'] = model_slices
        best['temporal_support'] = max(int(best.get('temporal_support', 1)), len(display_slices))
        if len(members) > 1:
            logger.info(
                "Merged %d neighboring candidates into one lesion; kept slice %s with classifier %.4f",
                len(members),
                best.get('display_slice_index', best.get('slice_index')),
                _classifier_probability(best, classifier_results),
            )
        merged.append(best)

    merged.sort(
        key=lambda item: (
            _classifier_probability(item, classifier_results),
            float(item.get('temporal_score', item.get('candidate_score', 0.0))),
        ),
        reverse=True
    )
    return merged


def save_debug_candidate_overlay(ct_slice: np.ndarray,
                                 slice_prediction: np.ndarray,
                                 candidate: Dict,
                                 debug_dir: str) -> Optional[str]:
    """Save a per-candidate overlay for debugging and review."""
    if candidate.get('bbox') is None:
        return None

    score = float(candidate.get('temporal_score', candidate.get('candidate_score', 0.0)))
    file_name = (
        f"slice_{candidate['slice_index']:03d}_"
        f"w{candidate.get('window_size', 0):03d}_"
        f"score{score:.3f}_"
        f"area{int(candidate.get('mask_area', 0))}.png"
    )
    output_path = os.path.join(debug_dir, file_name)

    # Create a mask from the aggregated slice prediction to highlight the region.
    mask = (slice_prediction > 0.10).astype(np.uint8)
    create_overlay_image(ct_slice, mask, slice_prediction, bbox=candidate['bbox'], output_path=output_path)
    return output_path


def analyze_dicom_study(study_dir: str, 
                       model_path: str,
                       output_dir: Optional[str] = None,
                       top_k: int = 10,
                       device: Optional[str] = None,
                       threshold: float = 0.10,
                       classifier_model_path: Optional[str] = None,
                       show_full_overlay: bool = True,
                       show_debug_panels: bool = True) -> Dict:
    """
    Complete AI analysis pipeline for a DICOM study.
    
    Args:
        study_dir: Directory containing DICOM files
        model_path: Path to SegResNet checkpoint
        output_dir: Optional directory to save overlays
        top_k: Number of top candidates to return
        device: Device for inference ('cuda' or 'cpu')
        threshold: Probability threshold for mask
        
    Returns:
        Dict with analysis results including candidates and metadata
    """
    try:
        logger.info(f"Starting analysis for study in {study_dir}")
        
        # Step 1: Load and sort DICOM series
        logger.info("Loading DICOM series...")
        dicom_files, file_paths = load_dicom_series(study_dir)

        # The model volume is processed in physical slice order, but the Review
        # page displays slices in natural file-name order. Keep an explicit map
        # so returned sliceIndex values jump to the same slice the UI shows.
        display_order_paths = sorted(file_paths, key=lambda p: natural_sort_key(os.path.basename(p)))
        display_index_by_path = {os.path.abspath(path): idx for idx, path in enumerate(display_order_paths)}

        sorted_pairs = sorted(zip(dicom_files, file_paths), key=lambda pair: dicom_sort_key(pair[0]))
        dicom_files = [pair[0] for pair in sorted_pairs]
        sorted_file_paths = [pair[1] for pair in sorted_pairs]
        model_to_display_index = [
            display_index_by_path.get(os.path.abspath(path), idx)
            for idx, path in enumerate(sorted_file_paths)
        ]
        logger.info(f"Loaded and sorted {len(dicom_files)} DICOM files")
        
        if len(dicom_files) < 5:
            raise ValueError(f"Study has only {len(dicom_files)} slices, need at least 5")
        
        # Step 2: Convert to volume
        logger.info("Converting DICOM series to 3D volume...")
        volume = dicom_series_to_volume(dicom_files)
        logger.info(f"Volume shape: {volume.shape}")
        
        # Step 3: Normalize HU
        logger.info("Normalizing HU values...")
        volume_norm = normalize_hu(volume, hu_min=-1000, hu_max=400)
        logger.info(f"Normalized volume range: [{volume_norm.min():.3f}, {volume_norm.max():.3f}]")
        lung_slice_start, lung_slice_end = estimate_lung_slice_bounds(volume_norm)
        logger.info(f"Estimated lung slice range: {lung_slice_start} - {lung_slice_end}")
        
        # Step 4: Load segmentation model
        logger.info(f"Loading segmentation model from {model_path}...")
        model = load_segmentation_model(model_path, device=device)
        if device is None:
            device = 'cuda' if torch.cuda.is_available() else 'cpu'

        if classifier_model_path is None:
            classifier_model_path = os.path.join(
                os.path.dirname(__file__),
                'models',
                'ogrenci_model_25D_full.pt.zip'
            )
        logger.info(f"Loading student classifier from {classifier_model_path}...")
        classifier = load_student_classifier(classifier_model_path, device=device)
        
        # Step 5: Run sliding-window inference
        logger.info("Running multi-scale ROI-style inference...")
        D, H, W = volume_norm.shape
        
        # Initialize prediction maps per slice
        prediction_maps = {}  # slice_idx -> accumulated probability map
        candidate_list = []
        series_id = Path(study_dir).name
        debug_dir = os.path.join(os.path.dirname(__file__), 'outputs', 'debug_candidates', series_id)
        os.makedirs(debug_dir, exist_ok=True)
        
        # Only process slices 2 to D-3 (need 2 slices before and after)
        for center_idx in range(2, D - 2):
            display_idx = model_to_display_index[center_idx]
            logger.info(f"Processing model slice {center_idx} / {D-1} (review slice {display_idx})...")
            
            # Create 5-slice stack
            stack_5d = create_5slice_stack(volume_norm, center_idx)  # (5, H, W)
            
            # Initialize accumulator for this slice if not exists
            if center_idx not in prediction_maps:
                prediction_maps[center_idx] = np.zeros((H, W), dtype=np.float32)

            for window_size in MULTI_SCALE_WINDOW_SIZES:
                window_positions = roi_window_positions(stack_5d[2], window_size=window_size)
                logger.debug(
                    f"  {len(window_positions)} ROI windows for slice {center_idx} at window_size={window_size}"
                )

                batch_windows = []
                batch_positions = []
                for y_start, x_start in window_positions:
                    window = crop_volume_window(stack_5d, y_start, x_start, window_size=window_size)
                    window_192 = resize_stack_to_model_input(window, target_size=MODEL_INPUT_SIZE)
                    batch_windows.append(window_192)
                    batch_positions.append((y_start, x_start))

                batch_results = run_batch_inference(
                    model,
                    batch_windows,
                    device=device,
                    threshold=threshold,
                    batch_size=SEGMENTATION_BATCH_SIZE,
                )

                for (y_start, x_start), (probs_192, mask_192) in zip(batch_positions, batch_results):
                    probs_window = resize_map(probs_192, window_size, interpolation=cv2.INTER_LINEAR)
                    mask_window = (probs_window > threshold).astype(np.uint8)

                    # Accumulate full-slice prediction map for overlays/debugging.
                    y_end = min(y_start + window_size, H)
                    x_end = min(x_start + window_size, W)
                    existing = prediction_maps[center_idx][y_start:y_end, x_start:x_end]
                    prediction_maps[center_idx][y_start:y_end, x_start:x_end] = np.maximum(
                        existing,
                        probs_window[:y_end - y_start, :x_end - x_start]
                    )

                    candidate_info = extract_candidates(probs_window, mask_window, min_mask_area=10)
                    if candidate_info is None:
                        continue

                    candidate_info['window_y'] = y_start
                    candidate_info['window_x'] = x_start
                    candidate_info['window_size'] = window_size
                    candidate_info['slice_index'] = center_idx
                    candidate_info['display_slice_index'] = display_idx
                    candidate_info['mean_probability'] = float(candidate_info['mean_probability'])
                    candidate_info['max_probability'] = float(candidate_info['max_probability'])
                    candidate_info['probability_sum'] = float(candidate_info.get('probability_sum', candidate_info['mean_probability'] * candidate_info['mask_area']))
                    candidate_info['candidate_score'] = float(candidate_info['candidate_score'])

                    if candidate_info.get('bbox') is not None:
                        candidate_info['bbox'] = expand_candidate_bbox(candidate_info['bbox'], y_start, x_start)
                        context = lung_context_score(stack_5d[2], candidate_info['bbox'])
                        candidate_info['lung_context'] = context
                        if context < 0.18:
                            continue
                        candidate_info['candidate_score'] = float(candidate_info['candidate_score'] * (0.55 + context))

                    candidate_list.append(candidate_info)
        
        logger.info(f"Total candidate regions found: {len(candidate_list)}")
        
        # Step 6: Temporal consistency boost and grouping by slice/location
        logger.info("Merging, scoring, and applying temporal consistency...")
        for candidate in candidate_list:
            support = compute_temporal_support(candidate, candidate_list)
            candidate['temporal_support'] = support
            candidate['temporal_boost'] = float(1.0 if support > 1 else 0.85 if support == 1 else 0.85)
            candidate['temporal_score'] = float(temporal_boost(candidate['candidate_score'], support))

        candidate_list.sort(key=lambda x: x['temporal_score'], reverse=True)
        fallback_candidates = select_dominant_candidates(candidate_list, top_k=top_k)
        final_candidates = fallback_candidates
        
        logger.info(f"Pre-classifier candidate count: {len(final_candidates)}")

        # Save top 50 debug overlays for inspection of candidate ranking.
        debug_overlay_paths = []
        debug_candidates = candidate_list[:50]
        for candidate in debug_candidates:
            slice_idx = candidate['slice_index']
            if slice_idx not in prediction_maps:
                continue
            ct_slice = dicom_files[slice_idx].pixel_array.astype(np.float32)
            overlay_path = save_debug_candidate_overlay(ct_slice, prediction_maps[slice_idx], candidate, debug_dir)
            if overlay_path:
                debug_overlay_paths.append(overlay_path)

        # Step 8: Classify a wider segmentation pool, then generate Grad-CAM only for final candidates.
        classifier_results = {}
        if output_dir is not None:
            classifier_pool_size = min(len(candidate_list), max(top_k * 15, 30))
            classifier_pool = candidate_list[:classifier_pool_size]
            logger.info(
                "Running classifier ranking for top %d segmentation candidates before final selection...",
                len(classifier_pool),
            )

            for idx, candidate in enumerate(classifier_pool):
                if candidate.get('bbox') is None:
                    continue
                try:
                    classifier_result = classify_candidate_for_ranking(
                        classifier=classifier,
                        volume_norm=volume_norm,
                        candidate=candidate,
                        device=device,
                    )
                    if classifier_result is None:
                        continue
                    classifier_results[id(candidate)] = classifier_result
                    logger.info(
                        "Rank pool candidate %d classifier probability %.4f (%s)",
                        idx + 1,
                        classifier_result['probability'],
                        classifier_result['label'],
                    )
                except Exception as exc:
                    logger.warning("Classifier ranking failed for candidate %d: %s", idx + 1, exc)

            positive_candidates = [
                candidate for candidate in classifier_pool
                if float(classifier_results.get(id(candidate), {}).get('probability', 0.0)) >= 0.5
            ]
            if positive_candidates:
                positive_candidates.sort(
                    key=lambda item: (
                        float(classifier_results.get(id(item), {}).get('probability', 0.0)),
                        float(item.get('temporal_score', item.get('candidate_score', 0.0))),
                        int(item.get('mask_area', 0)),
                    ),
                    reverse=True
                )
                final_candidates = positive_candidates
            final_candidates = merge_neighboring_slice_candidates_by_classifier(
                final_candidates,
                classifier_results,
                max_slice_gap=6,
            )[:top_k]

            logger.info(f"Final candidate count after classifier ranking: {len(final_candidates)}")

        # Step 9: Generate candidate-specific overlays (if output_dir specified)
        overlay_paths = {}
        if output_dir is not None:
            os.makedirs(output_dir, exist_ok=True)
            logger.info(f"Generating overlays in {output_dir}...")

            for idx, candidate in enumerate(final_candidates):
                slice_idx = candidate['slice_index']
                mask = candidate_full_mask(candidate, H, W)
                if mask.sum() == 0:
                    continue
                overlay_path = os.path.join(output_dir, f"candidate_{idx + 1:02d}_slice_{slice_idx:03d}.png")
                create_transparent_segmentation_overlay(mask, bbox=candidate.get('bbox'), output_path=overlay_path)
                overlay_paths[id(candidate)] = overlay_path

            logger.info("Generating classifier Grad-CAM explanations for final candidates...")
            classifier_dir = os.path.join(output_dir, "classifier_explanations")
            os.makedirs(classifier_dir, exist_ok=True)
            for idx, candidate in enumerate(final_candidates):
                slice_idx = candidate['slice_index']
                if candidate.get('bbox') is None:
                    continue
                ct_slice = volume_norm[slice_idx].astype(np.float32)
                classifier_result = integrate_segmentation_classification_gradcam(
                    classifier=classifier,
                    volume_norm=volume_norm,
                    candidate=candidate,
                    prediction_map=candidate_probability_map(candidate, H, W),
                    ct_slice=ct_slice,
                    output_dir=classifier_dir,
                    candidate_id=idx + 1,
                    device=device,
                    show_full_overlay=show_full_overlay,
                    show_debug_panels=show_debug_panels,
                )
                classifier_results[id(candidate)] = classifier_result
                logger.info(
                    "Final candidate %d classifier probability %.4f (%s)",
                    idx + 1,
                    classifier_result['probability'],
                    classifier_result['label'],
                )
        
        # Step 10: Prepare results
        results = {
            'success': True,
            'study_dir': study_dir,
            'num_slices': D,
            'volume_shape': list(volume.shape),
            'total_candidates_found': len(candidate_list),
            'top_candidates': len(final_candidates),
            'debug_candidates_dir': debug_dir,
            'candidates': []
        }
        
        # Format candidates for frontend
        for idx, candidate in enumerate(final_candidates):
            slice_idx = candidate['slice_index']
            display_slice_idx = int(candidate.get('display_slice_index', model_to_display_index[slice_idx]))
            bbox = candidate.get('bbox')
            coord_x = (bbox['center_x'] / W * 100.0) if bbox else 0.0
            coord_y = (bbox['center_y'] / H * 100.0) if bbox else 0.0
            classifier_result = classifier_results.get(id(candidate), {})
            segmentation_probability = float(candidate['mean_probability'])
            classifier_probability = float(classifier_result.get('probability', 0.0))
            nodule_probability = segmentation_probability
            average_risk = (segmentation_probability + classifier_probability) / 2.0
            predicted_class = int(classifier_result.get('predicted_class', int(classifier_probability >= 0.5)))
            classification_label = classifier_result.get(
                'label',
                'Positive nodule candidate' if classifier_probability >= 0.5 else 'Negative / likely false positive'
            )
            # Yeni risk algoritması: classifier < 0.4 ise düşük, ortalama >= 0.7 ise yüksek, aksi halde orta
            if classifier_probability < 0.4:
                risk = 'low'
            elif average_risk >= 0.7:
                risk = 'high'
            else:
                risk = 'medium'
            row_spacing_mm, col_spacing_mm = get_pixel_spacing(dicom_files[slice_idx])
            width_mm = float(bbox['width']) * col_spacing_mm if bbox else None
            height_mm = float(bbox['height']) * row_spacing_mm if bbox else None
            pixel_area_mm2 = row_spacing_mm * col_spacing_mm
            mask_area_mm2 = float(candidate['mask_area']) * pixel_area_mm2
            equivalent_diameter_mm = math.sqrt((4.0 * mask_area_mm2) / math.pi) if mask_area_mm2 > 0 else None
            location_estimate = estimate_candidate_location(
                candidate,
                dicom_files[slice_idx],
                slice_idx=slice_idx,
                num_slices=D,
                lung_slice_start=lung_slice_start,
                lung_slice_end=lung_slice_end,
                image_width=W,
            )
            formatted = {
                'id': idx + 1,
                'nodule_number': idx + 1,
                'sliceIndex': display_slice_idx,
                'sliceNumber': display_slice_idx + 1,
                'modelSliceIndex': slice_idx,
                'location': location_estimate['code'],
                'size': f"{equivalent_diameter_mm:.1f}" if equivalent_diameter_mm is not None else "N/A",
                'sizePx': f"{bbox['width']:.1f}" if bbox else "N/A",
                'probability': f"{nodule_probability:.3f}",
                'confidence': f"{nodule_probability:.3f}",
                'score': f"{candidate['temporal_score']:.3f}",
                'risk': risk,
                'classificationProbability': f"{classifier_probability:.3f}",
                'classificationPredictedClass': predicted_class,
                'classificationLabel': classification_label,
                'segmentationProbability': f"{segmentation_probability:.3f}",
                'maxProbability': f"{candidate['max_probability']:.3f}",
                'maskArea': candidate['mask_area'],
                'lungContext': f"{candidate.get('lung_context', 0.0):.3f}",
                'bbox': bbox,
                'overlayUrl': overlay_paths.get(id(candidate), None),
                'heatmapUrl': classifier_result.get('heatmapUrl'),
                'classifierCropUrl': classifier_result.get('classifierCropUrl'),
                'classifierGradcamUrl': classifier_result.get('classifierGradcamUrl'),
                'classifierPanelsUrl': classifier_result.get('classifierPanelsUrl'),
                'classifierFullGradcamUrl': classifier_result.get('classifierFullGradcamUrl'),
                'classificationCenter': classifier_result.get('center'),
                'classificationCrop': classifier_result.get('crop'),
                'gradcamShape': classifier_result.get('gradcamShape'),
                'reviewed': False,
                'includeInReport': True,
                'windowSize': candidate.get('window_size'),
                'temporalSupport': candidate.get('temporal_support', 1),
                'mergedCandidateCount': candidate.get('mergedCandidateCount', 1),
                'mergedDisplaySlices': candidate.get('mergedDisplaySlices', [display_slice_idx + 1]),
                'mergedModelSlices': candidate.get('mergedModelSlices', [slice_idx]),
                'coordinates': {
                    'x': coord_x,
                    'y': coord_y,
                    'pixelX': bbox['center_x'] if bbox else 0,
                    'pixelY': bbox['center_y'] if bbox else 0,
                    'pixelSpacingRowMm': row_spacing_mm,
                    'pixelSpacingColMm': col_spacing_mm,
                    'maskWidthMm': width_mm,
                    'maskHeightMm': height_mm,
                    'maskAreaMm2': mask_area_mm2,
                    'equivalentDiameterMm': equivalent_diameter_mm,
                    'locationConfidence': location_estimate['confidence'],
                    'locationSliceFraction': location_estimate['sliceFraction'],
                    'lungSliceStart': location_estimate['lungSliceStart'],
                    'lungSliceEnd': location_estimate['lungSliceEnd'],
                    'patientX': location_estimate['patientX']
                }
            }
            results['candidates'].append(formatted)
        
        logger.info("Analysis completed successfully")
        return results
        
    except Exception as e:
        logger.error(f"Error during analysis: {e}", exc_info=True)
        return {
            'success': False,
            'error': str(e),
            'candidates': []
        }


if __name__ == '__main__':
    # Example usage
    if len(sys.argv) < 3:
        print("Usage: python ai_analysis.py <dicom_dir> <model_path> [output_dir]")
        sys.exit(1)
    
    study_dir = sys.argv[1]
    model_path = sys.argv[2]
    output_dir = sys.argv[3] if len(sys.argv) > 3 else None
    
    results = analyze_dicom_study(study_dir, model_path, output_dir=output_dir)
    print(json.dumps(results, indent=2))
