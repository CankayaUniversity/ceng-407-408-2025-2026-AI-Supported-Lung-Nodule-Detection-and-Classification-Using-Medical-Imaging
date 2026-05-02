#!/usr/bin/env python3
"""
Model loading and inference for SegResNet 2.5D segmentation.
"""

import torch
import numpy as np
import cv2
from monai.networks.nets import SegResNet
from typing import Tuple, Dict, List
import logging
import os

logger = logging.getLogger(__name__)


def load_segmentation_model(model_path: str, device: str = None) -> SegResNet:
    """
    Load SegResNet model from checkpoint.
    
    Args:
        model_path: Path to model checkpoint
        device: Device to load model on ('cuda', 'cpu', or None for auto)
        
    Returns:
        SegResNet model in eval mode
    """
    # Auto-detect device
    if device is None:
        device = 'cuda' if torch.cuda.is_available() else 'cpu'
    
    logger.info(f"Loading model from {model_path} on device: {device}")
    
    # Check file exists
    if not os.path.exists(model_path):
        raise FileNotFoundError(f"Model checkpoint not found at {model_path}")
    
    # Create model with exact architecture from specification
    model = SegResNet(
        spatial_dims=2,
        in_channels=5,
        out_channels=1,
        init_filters=8,
        blocks_down=(1, 2, 2, 4),
        blocks_up=(1, 1, 1),
    )
    
    # Load checkpoint
    checkpoint = torch.load(model_path, map_location=device)
    
    # Handle both direct state_dict and wrapped checkpoint
    if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
        state_dict = checkpoint['model_state_dict']
        logger.info(f"Model checkpoint info: epoch={checkpoint.get('epoch')}, best_dice={checkpoint.get('best_dice')}")
    else:
        state_dict = checkpoint
    
    # Load state dict
    model.load_state_dict(state_dict)
    model = model.to(device)
    model.eval()
    
    logger.info("Model loaded successfully")
    return model


def run_inference(model: SegResNet, 
                 window: np.ndarray, 
                 device: str = 'cpu',
                 threshold: float = 0.10) -> Tuple[np.ndarray, np.ndarray]:
    """
    Run model inference on a single 5-slice window.
    
    Args:
        model: SegResNet model in eval mode
        window: Input window of shape (5, 192, 192), values in [0, 1]
        device: Device model is on
        threshold: Probability threshold for mask
        
    Returns:
        Tuple of (probabilities, binary_mask) both shape (192, 192)
    """
    # Add batch and channel dims: (5, 192, 192) -> (1, 5, 192, 192)
    input_tensor = torch.from_numpy(window).unsqueeze(0).to(device).float()
    
    with torch.no_grad():
        # Model output: (1, 1, 192, 192)
        logits = model(input_tensor)
    
    # Apply sigmoid to get probabilities
    probs = torch.sigmoid(logits)
    
    # Convert to numpy and remove batch/channel dims
    probs_np = probs.squeeze().cpu().numpy()  # (192, 192)
    
    # Create binary mask
    mask = (probs_np > threshold).astype(np.uint8)
    
    return probs_np, mask


def run_batch_inference(model: SegResNet,
                        windows: List[np.ndarray],
                        device: str = 'cpu',
                        threshold: float = 0.10,
                        batch_size: int = 32) -> List[Tuple[np.ndarray, np.ndarray]]:
    """
    Run SegResNet inference for many 5-slice windows in batches.

    Each input window must be shape (5, 192, 192). Returns one
    (probabilities, mask) pair per input window.
    """
    if not windows:
        return []

    outputs = []
    for start in range(0, len(windows), batch_size):
        batch = np.stack(windows[start:start + batch_size], axis=0).astype(np.float32)
        input_tensor = torch.from_numpy(batch).to(device).float()

        with torch.no_grad():
            logits = model(input_tensor)
            probs = torch.sigmoid(logits).squeeze(1).cpu().numpy()

        masks = (probs > threshold).astype(np.uint8)
        outputs.extend((probs[i], masks[i]) for i in range(probs.shape[0]))

    return outputs


def _component_compactness(width: int, height: int, area: int) -> float:
    bbox_area = max(1, width * height)
    fill_ratio = area / float(bbox_area)
    aspect = min(width, height) / float(max(width, height, 1))
    return float(fill_ratio * aspect)


def extract_candidates(probabilities: np.ndarray,
                      mask: np.ndarray,
                      min_mask_area: int = 10) -> Dict:
    """
    Extract candidate information from model output.
    
    Args:
        probabilities: Probability map (192, 192) in [0, 1]
        mask: Binary mask (192, 192) in {0, 1}
        min_mask_area: Minimum number of positive pixels to consider as candidate
        
    Returns:
        Dict with candidate info or None if below threshold
    """
    mask = (mask > 0).astype(np.uint8)
    if int(np.sum(mask)) < min_mask_area:
        return None

    # Pick the best connected component instead of treating the whole mask as
    # one giant candidate. The model was trained on centered ROI crops, so the
    # useful component is usually compact and near the crop center.
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if num_labels <= 1:
        return None

    h, w = probabilities.shape
    crop_center = np.array([w / 2.0, h / 2.0], dtype=np.float32)
    best = None

    for label in range(1, num_labels):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if area < min_mask_area:
            continue

        x_min = int(stats[label, cv2.CC_STAT_LEFT])
        y_min = int(stats[label, cv2.CC_STAT_TOP])
        width = int(stats[label, cv2.CC_STAT_WIDTH])
        height = int(stats[label, cv2.CC_STAT_HEIGHT])
        if width > 52 or height > 52 or area > 1600:
            continue

        x_max = x_min + width - 1
        y_max = y_min + height - 1

        component_mask = labels == label
        component_probs = probabilities[component_mask]
        max_prob = float(np.max(component_probs))
        mean_prob = float(np.mean(component_probs))
        probability_sum = float(np.sum(component_probs))
        compactness = _component_compactness(width, height, area)

        centroid_x, centroid_y = centroids[label]
        center_distance = float(np.linalg.norm(np.array([centroid_x, centroid_y]) - crop_center))
        center_weight = 1.0 / (1.0 + center_distance / 48.0)

        # Strong probability first, then compact ROI-like components. Area is
        # logarithmic so a large smear cannot beat a confident compact blob.
        candidate_score = (
            max_prob * np.log(area + 1.0) * (0.70 + 0.30 * compactness) * center_weight
            + probability_sum / np.sqrt(area + 1.0) * 0.10
        )

        item = {
            'mask': component_mask.astype(np.uint8),
            'probabilities': probabilities,
            'max_probability': max_prob,
            'mean_probability': mean_prob,
            'probability_sum': probability_sum,
            'mask_area': area,
            'candidate_score': float(candidate_score),
            'compactness': float(compactness),
            'center_distance': center_distance,
            'bbox': {
                'y_min': y_min,
                'y_max': y_max,
                'x_min': x_min,
                'x_max': x_max,
                'width': max(1, width),
                'height': max(1, height),
                'center_x': int(round(centroid_x)),
                'center_y': int(round(centroid_y)),
            },
        }

        if best is None or item['candidate_score'] > best['candidate_score']:
            best = item

    if best is None:
        return None

    return {
        **best,
    }
