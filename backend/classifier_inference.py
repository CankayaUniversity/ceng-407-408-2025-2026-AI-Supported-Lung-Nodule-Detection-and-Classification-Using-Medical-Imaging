#!/usr/bin/env python3
"""
2.5D student classifier and Grad-CAM utilities.

This module runs after the existing segmentation pipeline. It never uses SEG or
ground-truth masks as model input; classifier crops come from the CT volume.
"""

import logging
import os
import sys
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)


class StudentCNN25D(nn.Module):
    def __init__(self):
        super(StudentCNN25D, self).__init__()
        self.conv1 = nn.Conv2d(in_channels=3, out_channels=16, kernel_size=3, padding=1)
        self.pool1 = nn.MaxPool2d(2, 2)

        self.conv2 = nn.Conv2d(in_channels=16, out_channels=32, kernel_size=3, padding=1)
        self.pool2 = nn.MaxPool2d(2, 2)

        self.conv3 = nn.Conv2d(in_channels=32, out_channels=64, kernel_size=3, padding=1)
        self.pool3 = nn.MaxPool2d(2, 2)

        self.fc1 = nn.Linear(64 * 4 * 4, 128)
        self.dropout = nn.Dropout(0.5)
        self.fc2 = nn.Linear(128, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        x = self.pool1(torch.relu(self.conv1(x)))
        x = self.pool2(torch.relu(self.conv2(x)))
        x = self.pool3(torch.relu(self.conv3(x)))
        x = x.view(-1, 64 * 4 * 4)
        x = torch.relu(self.fc1(x))
        x = self.dropout(x)
        x = self.fc2(x)
        return self.sigmoid(x)


def _strip_module_prefix(state_dict: Dict) -> Dict:
    if not any(str(key).startswith("module.") for key in state_dict.keys()):
        return state_dict
    return {str(key).replace("module.", "", 1): value for key, value in state_dict.items()}


def _looks_like_state_dict(obj) -> bool:
    return isinstance(obj, dict) and obj and all(torch.is_tensor(value) for value in obj.values())


def load_student_classifier(checkpoint_path: str, device: Optional[str] = None) -> nn.Module:
    """
    Load the binary 2.5D student classifier.

    Supports full saved modules, checkpoint dicts with model_state_dict, and
    pure state_dict files. Some notebooks save full models under
    __main__.StudentCNN25D, so we expose the class on __main__ before loading.
    """
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(f"Classifier model file not found at {checkpoint_path}")

    logger.info(f"Loading classifier from {checkpoint_path} on device: {device}")
    sys.modules["__main__"].StudentCNN25D = StudentCNN25D

    try:
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    except TypeError:
        checkpoint = torch.load(checkpoint_path, map_location=device)

    if isinstance(checkpoint, nn.Module):
        model = checkpoint
        logger.info("Classifier load path: full saved nn.Module")
    else:
        model = StudentCNN25D()
        if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
            state_dict = checkpoint["model_state_dict"]
            logger.info(
                "Classifier load path: checkpoint['model_state_dict']; "
                f"epoch={checkpoint.get('epoch')}, best_metric={checkpoint.get('best_metric')}"
            )
        elif _looks_like_state_dict(checkpoint):
            state_dict = checkpoint
            logger.info("Classifier load path: pure state_dict")
        elif isinstance(checkpoint, dict):
            tensor_items = {key: value for key, value in checkpoint.items() if torch.is_tensor(value)}
            if tensor_items and set(tensor_items.keys()) == set(checkpoint.keys()):
                state_dict = tensor_items
                logger.info("Classifier load path: tensor dict state_dict")
            else:
                raise ValueError(
                    "Unsupported classifier checkpoint dict. "
                    f"Available keys: {list(checkpoint.keys())[:20]}"
                )
        else:
            raise ValueError(f"Unsupported classifier checkpoint type: {type(checkpoint)}")

        model.load_state_dict(_strip_module_prefix(state_dict))

    model = model.to(device)
    model.eval()
    logger.info("Classifier loaded successfully")
    return model


def extract_candidate_centers_from_mask(pred_mask: np.ndarray, min_area: int = 10) -> List[Dict]:
    """Extract connected-component centers from a 2D or 3D predicted mask."""
    mask = (pred_mask > 0).astype(np.uint8)
    centers = []

    if mask.ndim == 2:
        num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
        for label in range(1, num_labels):
            area = int(stats[label, cv2.CC_STAT_AREA])
            if area < min_area:
                continue
            centers.append({
                "center": (int(round(centroids[label][1])), int(round(centroids[label][0]))),
                "area": area,
                "bbox": {
                    "x_min": int(stats[label, cv2.CC_STAT_LEFT]),
                    "y_min": int(stats[label, cv2.CC_STAT_TOP]),
                    "width": int(stats[label, cv2.CC_STAT_WIDTH]),
                    "height": int(stats[label, cv2.CC_STAT_HEIGHT]),
                },
            })
        return centers

    if mask.ndim != 3:
        raise ValueError(f"Expected 2D or 3D mask, got shape {mask.shape}")

    for z in range(mask.shape[0]):
        for component in extract_candidate_centers_from_mask(mask[z], min_area=min_area):
            y, x = component["center"]
            component["center"] = (z, y, x)
            centers.append(component)
    return centers


def crop_3d_cube(volume: np.ndarray, center: Tuple[int, int, int], size: int = 32) -> Tuple[np.ndarray, Dict]:
    """Crop a padded cube from a z,y,x volume."""
    if volume.ndim != 3:
        raise ValueError(f"Expected CT volume shape [D,H,W], got {volume.shape}")

    z, y, x = [int(round(value)) for value in center]
    half = size // 2
    starts = [z - half, y - half, x - half]
    ends = [start + size for start in starts]
    shape = volume.shape

    src_starts = [max(0, starts[i]) for i in range(3)]
    src_ends = [min(shape[i], ends[i]) for i in range(3)]
    dst_starts = [src_starts[i] - starts[i] for i in range(3)]
    dst_ends = [dst_starts[i] + (src_ends[i] - src_starts[i]) for i in range(3)]

    cube = np.zeros((size, size, size), dtype=np.float32)
    cube[
        dst_starts[0]:dst_ends[0],
        dst_starts[1]:dst_ends[1],
        dst_starts[2]:dst_ends[2],
    ] = volume[
        src_starts[0]:src_ends[0],
        src_starts[1]:src_ends[1],
        src_starts[2]:src_ends[2],
    ].astype(np.float32)

    crop_info = {
        "center_zyx": [z, y, x],
        "size": size,
        "z_start": int(starts[0]),
        "z_end": int(ends[0]),
        "y_start": int(starts[1]),
        "y_end": int(ends[1]),
        "x_start": int(starts[2]),
        "x_end": int(ends[2]),
        "src_z_start": int(src_starts[0]),
        "src_z_end": int(src_ends[0]),
        "src_y_start": int(src_starts[1]),
        "src_y_end": int(src_ends[1]),
        "src_x_start": int(src_starts[2]),
        "src_x_end": int(src_ends[2]),
        "dst_z_start": int(dst_starts[0]),
        "dst_y_start": int(dst_starts[1]),
        "dst_x_start": int(dst_starts[2]),
    }
    logger.info(f"Candidate center z,y,x: {crop_info['center_zyx']}")
    logger.info(f"Classifier crop coordinates: {crop_info}")
    logger.info(f"Crop cube shape: {cube.shape}")
    return cube, crop_info


def make_25d_classifier_input(cube: np.ndarray) -> torch.Tensor:
    """Create [1,3,32,32] tensor from axial/coronal/sagittal center slices."""
    if cube.shape != (32, 32, 32):
        raise ValueError(f"Expected classifier cube shape (32,32,32), got {cube.shape}")

    slice_z = cube[16, :, :]
    slice_y = cube[:, 16, :]
    slice_x = cube[:, :, 16]
    stacked = np.stack([slice_z, slice_y, slice_x], axis=0).astype(np.float32)
    tensor = torch.from_numpy(stacked).unsqueeze(0)
    logger.info(f"Classifier input shape: {tuple(tensor.shape)}")
    return tensor


def classify_candidate(classifier: nn.Module, classifier_input: torch.Tensor, device: str) -> Dict:
    if tuple(classifier_input.shape) != (1, 3, 32, 32):
        raise ValueError(f"Expected classifier input [1,3,32,32], got {tuple(classifier_input.shape)}")

    with torch.no_grad():
        output = classifier(classifier_input.to(device).float())

    probability = float(output.detach().cpu().view(-1)[0].item())
    logger.info(f"Classifier output: {probability:.6f}")
    return {
        "probability": probability,
        "predicted_class": int(probability >= 0.5),
        "label": "Positive nodule candidate" if probability >= 0.5 else "Negative / likely false positive",
    }


def generate_classifier_gradcam(classifier: nn.Module,
                                classifier_input: torch.Tensor,
                                target_layer: Optional[nn.Module] = None) -> np.ndarray:
    """Generate Grad-CAM for classifier.conv3."""
    if target_layer is None:
        target_layer = classifier.conv3

    if tuple(classifier_input.shape) != (1, 3, 32, 32):
        raise ValueError(f"Expected classifier input [1,3,32,32], got {tuple(classifier_input.shape)}")

    device = next(classifier.parameters()).device
    activations = {}
    gradients = {}

    def forward_hook(_module, _inputs, output):
        activations["value"] = output

    def backward_hook(_module, _grad_input, grad_output):
        gradients["value"] = grad_output[0]

    forward_handle = target_layer.register_forward_hook(forward_hook)
    backward_handle = target_layer.register_full_backward_hook(backward_hook)

    try:
        classifier.zero_grad(set_to_none=True)
        output = classifier(classifier_input.to(device).float())
        score = output[:, 0].sum()
        score.backward()

        if "value" not in activations or "value" not in gradients:
            raise RuntimeError("Grad-CAM hooks did not capture activations/gradients")

        acts = activations["value"].detach()
        grads = gradients["value"].detach()
        weights = grads.mean(dim=(2, 3), keepdim=True)
        cam = (weights * acts).sum(dim=1, keepdim=True)
        cam = torch.relu(cam)
        cam_min = cam.min()
        cam_max = cam.max()
        if float(cam_max - cam_min) > 1e-8:
            cam = (cam - cam_min) / (cam_max - cam_min)
        else:
            cam = torch.zeros_like(cam)

        cam_np = cam.squeeze().cpu().numpy().astype(np.float32)
        logger.info(f"Grad-CAM shape before resizing: {cam_np.shape}")
        cam_32 = cv2.resize(cam_np, (32, 32), interpolation=cv2.INTER_LINEAR)
        logger.info(f"Grad-CAM shape after resizing: {cam_32.shape}")
        return cam_32
    finally:
        forward_handle.remove()
        backward_handle.remove()


def generate_axial_input_saliency(classifier: nn.Module, classifier_input: torch.Tensor) -> np.ndarray:
    """
    Generate an axial-slice saliency map for display on the CT slice.

    The classifier is tri-planar (axial/coronal/sagittal channels), while
    Grad-CAM from conv3 mixes all channels. For the full axial CT overlay, this
    channel-specific saliency aligns better with the visible axial crop.
    """
    if tuple(classifier_input.shape) != (1, 3, 32, 32):
        raise ValueError(f"Expected classifier input [1,3,32,32], got {tuple(classifier_input.shape)}")

    device = next(classifier.parameters()).device
    input_tensor = classifier_input.to(device).float().clone().detach()
    input_tensor.requires_grad_(True)

    classifier.zero_grad(set_to_none=True)
    output = classifier(input_tensor)
    score = output[:, 0].sum()
    score.backward()

    gradients = input_tensor.grad.detach()[0, 0].abs().cpu().numpy().astype(np.float32)
    axial = input_tensor.detach()[0, 0].abs().cpu().numpy().astype(np.float32)
    saliency = gradients * (axial + 0.05)
    saliency = cv2.GaussianBlur(saliency, (5, 5), 0)
    saliency_min = float(saliency.min())
    saliency_max = float(saliency.max())
    if saliency_max - saliency_min > 1e-8:
        saliency = (saliency - saliency_min) / (saliency_max - saliency_min)
    else:
        saliency = np.zeros_like(saliency, dtype=np.float32)

    logger.info(f"Axial saliency shape: {saliency.shape}")
    return saliency.astype(np.float32)


def _to_8bit(image: np.ndarray) -> np.ndarray:
    image = image.astype(np.float32)
    min_value = float(np.min(image))
    max_value = float(np.max(image))
    if max_value - min_value <= 1e-8:
        return np.zeros_like(image, dtype=np.uint8)
    return ((image - min_value) / (max_value - min_value) * 255.0).clip(0, 255).astype(np.uint8)


def _windows_safe_path(path: str) -> str:
    abs_path = os.path.abspath(path)
    if os.name == "nt" and not abs_path.startswith("\\\\?\\"):
        return "\\\\?\\" + abs_path
    return abs_path


def _save_png(path: str, image: np.ndarray) -> str:
    os.makedirs(_windows_safe_path(os.path.dirname(path)), exist_ok=True)
    ok, buffer = cv2.imencode(".png", image)
    if not ok:
        raise IOError(f"Could not encode PNG: {path}")
    with open(_windows_safe_path(path), "wb") as file:
        file.write(buffer.tobytes())
    return path


def _save_transparent_heat_overlay(path: str,
                                   image_shape: Tuple[int, int],
                                   heatmap: np.ndarray,
                                   crop_info: Dict,
                                   candidate_mask: Optional[np.ndarray] = None) -> str:
    """Save a transparent full-slice PNG containing only a color explanation layer."""
    height, width = image_shape
    overlay = np.zeros((height, width, 4), dtype=np.uint8)

    x0 = max(0, int(crop_info["src_x_start"]))
    y0 = max(0, int(crop_info["src_y_start"]))
    x1 = min(width, int(crop_info["src_x_end"]))
    y1 = min(height, int(crop_info["src_y_end"]))
    if x1 <= x0 or y1 <= y0:
        return _save_png(path, overlay)

    heat = cv2.applyColorMap((heatmap * 255).clip(0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    resized = cv2.resize(heat, (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
    heat_alpha = cv2.resize(heatmap.astype(np.float32), (x1 - x0, y1 - y0), interpolation=cv2.INTER_CUBIC)
    heat_alpha = np.clip(heat_alpha, 0.0, 1.0)
    alpha = np.zeros((y1 - y0, x1 - x0), dtype=np.uint8)

    if candidate_mask is not None:
        local_mask = candidate_mask[y0:y1, x0:x1].astype(np.uint8)
        if local_mask.shape == alpha.shape and int(local_mask.sum()) > 0:
            local_mask = cv2.dilate(local_mask, np.ones((9, 9), np.uint8), iterations=1).astype(np.float32)
            local_mask = cv2.GaussianBlur(local_mask, (9, 9), 0)
            if float(local_mask.max()) > 0:
                local_mask = local_mask / float(local_mask.max())
            alpha = (local_mask * (45 + heat_alpha * 90)).clip(0, 125).astype(np.uint8)

    if int(alpha.max()) == 0:
        focused = np.where(heat_alpha >= 0.30, heat_alpha, 0.0)
        focused = cv2.GaussianBlur(focused, (7, 7), 0)
        alpha = (focused * 105).clip(0, 105).astype(np.uint8)

    # OpenCV images are BGR/BGRA. The browser will decode PNG colors correctly.
    overlay[y0:y1, x0:x1, :3] = resized
    overlay[y0:y1, x0:x1, 3] = alpha
    return _save_png(path, overlay)


def overlay_gradcam_on_crop(axial_crop: np.ndarray, gradcam: np.ndarray, alpha: float = 0.45) -> np.ndarray:
    if axial_crop.shape != (32, 32):
        raise ValueError(f"Expected axial crop shape (32,32), got {axial_crop.shape}")
    if gradcam.shape != (32, 32):
        raise ValueError(f"Expected Grad-CAM shape (32,32), got {gradcam.shape}")

    base = cv2.cvtColor(_to_8bit(axial_crop), cv2.COLOR_GRAY2BGR)
    heat = cv2.applyColorMap((gradcam * 255).clip(0, 255).astype(np.uint8), cv2.COLORMAP_JET)
    return cv2.addWeighted(base, 1.0 - alpha, heat, alpha, 0)


def _draw_contour(image_bgr: np.ndarray, mask: Optional[np.ndarray], bbox: Optional[Dict]) -> np.ndarray:
    output = image_bgr.copy()
    if mask is not None and mask.shape[:2] == output.shape[:2]:
        contours, _ = cv2.findContours((mask > 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(output, contours, -1, (0, 255, 255), 2)
    if bbox:
        cv2.rectangle(
            output,
            (int(bbox["x_min"]), int(bbox["y_min"])),
            (int(bbox["x_max"]), int(bbox["y_max"])),
            (0, 255, 255),
            2,
        )
    return output


def save_classifier_explanation_images(ct_slice: np.ndarray,
                                       axial_crop: np.ndarray,
                                       gradcam: np.ndarray,
                                       axial_saliency: np.ndarray,
                                       crop_info: Dict,
                                       output_dir: str,
                                       candidate_id: int,
                                       probability: float,
                                       predicted_label: str,
                                       bbox: Optional[Dict] = None,
                                       segmentation_mask: Optional[np.ndarray] = None,
                                       show_full_overlay: bool = True,
                                       show_debug_panels: bool = True) -> Dict:
    """Save crop and full-slice classifier explanation PNGs."""
    os.makedirs(_windows_safe_path(output_dir), exist_ok=True)
    slice_idx = int(crop_info["center_zyx"][0])
    prefix = f"c{candidate_id:02d}_s{slice_idx:03d}"

    ct_bgr = cv2.cvtColor(_to_8bit(ct_slice), cv2.COLOR_GRAY2BGR)
    candidate_contour_mask = None
    if segmentation_mask is not None and bbox:
        candidate_contour_mask = np.zeros_like(segmentation_mask, dtype=np.uint8)
        y0 = max(0, int(bbox["y_min"]) - 2)
        y1 = min(segmentation_mask.shape[0], int(bbox["y_max"]) + 3)
        x0 = max(0, int(bbox["x_min"]) - 2)
        x1 = min(segmentation_mask.shape[1], int(bbox["x_max"]) + 3)
        candidate_contour_mask[y0:y1, x0:x1] = segmentation_mask[y0:y1, x0:x1]

    contour_bgr = _draw_contour(ct_bgr, candidate_contour_mask, bbox)
    crop_bgr = cv2.resize(cv2.cvtColor(_to_8bit(axial_crop), cv2.COLOR_GRAY2BGR), (160, 160), interpolation=cv2.INTER_NEAREST)
    crop_gradcam = overlay_gradcam_on_crop(axial_crop, gradcam)
    crop_saliency = overlay_gradcam_on_crop(axial_crop, axial_saliency, alpha=0.5)
    crop_gradcam_large = cv2.resize(crop_gradcam, (160, 160), interpolation=cv2.INTER_NEAREST)
    crop_saliency_large = cv2.resize(crop_saliency, (160, 160), interpolation=cv2.INTER_NEAREST)

    full_overlay_path = None
    transparent_heatmap_path = None
    panels_path = None
    crop_path = _save_png(os.path.join(output_dir, f"{prefix}_crop.png"), crop_bgr)
    crop_gradcam_path = _save_png(os.path.join(output_dir, f"{prefix}_cropcam.png"), crop_gradcam_large)

    if show_full_overlay:
        full = contour_bgr.copy()
        z, y, x = crop_info["center_zyx"]
        x0 = max(0, int(crop_info["src_x_start"]))
        y0 = max(0, int(crop_info["src_y_start"]))
        x1 = min(full.shape[1], int(crop_info["src_x_end"]))
        y1 = min(full.shape[0], int(crop_info["src_y_end"]))
        logger.info(f"Pasting 32x32 Grad-CAM on full CT at x={x0}:{x1}, y={y0}:{y1}, z={z}")

        if x1 > x0 and y1 > y0:
            resized_cam = cv2.resize(crop_gradcam, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)
            if candidate_contour_mask is not None:
                local_mask = candidate_contour_mask[y0:y1, x0:x1].astype(np.uint8)
                if local_mask.shape[:2] == resized_cam.shape[:2] and int(local_mask.sum()) > 0:
                    local_mask = cv2.dilate(local_mask, np.ones((5, 5), np.uint8), iterations=1)
                    local_mask_3 = local_mask[:, :, None] > 0
                    muted = np.zeros_like(resized_cam)
                    muted[local_mask_3.repeat(3, axis=2)] = resized_cam[local_mask_3.repeat(3, axis=2)]
                    resized_cam = muted
            region = full[y0:y1, x0:x1]
            full[y0:y1, x0:x1] = cv2.addWeighted(region, 0.55, resized_cam, 0.45, 0)
            cv2.rectangle(full, (x0, y0), (x1, y1), (255, 255, 180), 2)

        full_overlay_path = _save_png(os.path.join(output_dir, f"{prefix}_full.png"), full)
        transparent_heatmap_path = _save_transparent_heat_overlay(
            os.path.join(output_dir, f"{prefix}_heatmap_overlay.png"),
            ct_slice.shape,
            axial_saliency,
            crop_info,
            candidate_mask=candidate_contour_mask,
        )

    if show_debug_panels:
        panel_h, panel_w = 220, 220

        def panel(title: str, image: np.ndarray) -> np.ndarray:
            canvas = np.zeros((panel_h, panel_w, 3), dtype=np.uint8)
            resized = cv2.resize(image, (panel_w, 180), interpolation=cv2.INTER_LINEAR)
            canvas[32:212, :] = resized
            cv2.putText(canvas, title, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (230, 230, 230), 1, cv2.LINE_AA)
            return canvas

        full_crop_overlay = full.copy() if full_overlay_path else contour_bgr
        panels = np.hstack([
            panel("Original CT slice", ct_bgr),
            panel("CT + segmentation contour", contour_bgr),
            panel("32x32 axial crop", crop_bgr),
            panel("Axial crop + saliency", crop_saliency_large),
            panel("Full slice + crop Grad-CAM", full_crop_overlay),
        ])
        footer = np.zeros((44, panels.shape[1], 3), dtype=np.uint8)
        cv2.putText(
            footer,
            f"Nodule probability: {probability:.3f} | {predicted_label} | Research/demo only, not a clinical diagnosis.",
            (10, 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.58,
            (230, 230, 230),
            1,
            cv2.LINE_AA,
        )
        panels_path = _save_png(os.path.join(output_dir, f"{prefix}_panels.png"), np.vstack([panels, footer]))

    return {
        "classifierCropUrl": crop_path,
        "classifierGradcamUrl": crop_gradcam_path,
        "classifierPanelsUrl": panels_path,
        "classifierFullGradcamUrl": full_overlay_path,
        "heatmapUrl": transparent_heatmap_path or full_overlay_path,
    }


def integrate_segmentation_classification_gradcam(classifier: nn.Module,
                                                  volume_norm: np.ndarray,
                                                  candidate: Dict,
                                                  prediction_map: Optional[np.ndarray],
                                                  ct_slice: np.ndarray,
                                                  output_dir: str,
                                                  candidate_id: int,
                                                  device: str,
                                                  show_full_overlay: bool = True,
                                                  show_debug_panels: bool = True) -> Dict:
    """Classify one segmentation candidate and save Grad-CAM explanations."""
    bbox = candidate.get("bbox")
    if not bbox:
        raise ValueError("Cannot classify candidate without bbox")

    center = (
        int(candidate["slice_index"]),
        int(bbox["center_y"]),
        int(bbox["center_x"]),
    )
    logger.info(f"CT volume shape: {volume_norm.shape}")
    if prediction_map is not None:
        logger.info(f"Predicted mask/probability map shape: {prediction_map.shape}")

    cube, crop_info = crop_3d_cube(volume_norm, center, size=32)
    classifier_input = make_25d_classifier_input(cube)
    classification = classify_candidate(classifier, classifier_input, device=device)
    gradcam = generate_classifier_gradcam(classifier, classifier_input, target_layer=classifier.conv3)
    axial_saliency = generate_axial_input_saliency(classifier, classifier_input)

    axial_crop = cube[16, :, :]
    segmentation_mask = (prediction_map > 0.10).astype(np.uint8) if prediction_map is not None else None
    image_paths = save_classifier_explanation_images(
        ct_slice=ct_slice,
        axial_crop=axial_crop,
        gradcam=gradcam,
        axial_saliency=axial_saliency,
        crop_info=crop_info,
        output_dir=output_dir,
        candidate_id=candidate_id,
        probability=classification["probability"],
        predicted_label=classification["label"],
        bbox=bbox,
        segmentation_mask=segmentation_mask,
        show_full_overlay=show_full_overlay,
        show_debug_panels=show_debug_panels,
    )

    return {
        **classification,
        "center": {"z": center[0], "y": center[1], "x": center[2]},
        "crop": crop_info,
        "gradcamShape": list(gradcam.shape),
        **image_paths,
    }
