#!/usr/bin/env python3
"""
Generate overlay images for visualization.
"""

import numpy as np
import cv2
from typing import Optional, Tuple
import os
import logging

logger = logging.getLogger(__name__)


def normalize_image_8bit(image: np.ndarray) -> np.ndarray:
    """
    Normalize image to 8-bit grayscale (0-255).
    
    Args:
        image: Image array (any range)
        
    Returns:
        8-bit grayscale image
    """
    if image.max() == image.min():
        return np.zeros_like(image, dtype=np.uint8)
    
    normalized = ((image - image.min()) / (image.max() - image.min()) * 255).astype(np.uint8)
    return normalized


def save_png_safe(output_path: str, image: np.ndarray) -> None:
    """Save PNG robustly on Windows paths with non-ASCII characters."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    success, buffer = cv2.imencode('.png', image)
    if not success:
        raise IOError(f"Could not encode PNG: {output_path}")
    write_path = output_path
    if os.name == 'nt':
        write_path = '\\\\?\\' + os.path.abspath(output_path)
    with open(write_path, 'wb') as file:
        file.write(buffer.tobytes())


def create_overlay_image(ct_slice: np.ndarray,
                        mask: np.ndarray,
                        probabilities: Optional[np.ndarray] = None,
                        bbox: Optional[dict] = None,
                        output_path: Optional[str] = None) -> np.ndarray:
    """
    Create overlay image with CT slice and mask.
    
    Args:
        ct_slice: CT slice in any range, shape (H, W)
        mask: Binary mask, shape (H, W), values in {0, 1}
        probabilities: Optional probability map for colored overlay
        bbox: Optional bounding box dict with keys: x_min, x_max, y_min, y_max
        output_path: Optional path to save PNG
        
    Returns:
        RGB image with overlay
    """
    # Normalize CT slice to 8-bit
    ct_8bit = normalize_image_8bit(ct_slice)
    
    # Create RGB image (grayscale CT as base)
    overlay = cv2.cvtColor(ct_8bit, cv2.COLOR_GRAY2BGR)
    
    # Apply mask overlay
    if probabilities is not None:
        # Use probabilities for colored overlay intensity
        prob_8bit = (probabilities * 255).astype(np.uint8)
        # Green channel for probabilities
        overlay[mask > 0, 1] = np.minimum(
            overlay[mask > 0, 1].astype(np.int16) + prob_8bit[mask > 0].astype(np.int16),
            255
        )
    else:
        # Simple green mask
        overlay[mask > 0, 1] = 255  # Green channel
    
    # Draw bounding box if provided
    if bbox is not None:
        x_min = bbox.get('x_min', 0)
        x_max = bbox.get('x_max', ct_slice.shape[1])
        y_min = bbox.get('y_min', 0)
        y_max = bbox.get('y_max', ct_slice.shape[0])
        
        # Draw rectangle in yellow
        cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), (0, 255, 255), 2)
    
    # Save if path provided
    if output_path is not None:
        save_png_safe(output_path, overlay)
        logger.info(f"Overlay saved to {output_path}")
    
    return overlay


def create_mask_image(mask: np.ndarray, 
                     probabilities: Optional[np.ndarray] = None,
                     output_path: Optional[str] = None) -> np.ndarray:
    """
    Create a binary or probabilistic mask image for display.
    
    Args:
        mask: Binary mask, shape (H, W), values in {0, 1}
        probabilities: Optional probability map for grayscale intensity
        output_path: Optional path to save PNG
        
    Returns:
        Grayscale image (0-255)
    """
    if probabilities is not None:
        # Use probability values
        mask_img = (probabilities * 255).astype(np.uint8)
        # Zero out where mask is 0
        mask_img[mask == 0] = 0
    else:
        # Binary mask
        mask_img = (mask * 255).astype(np.uint8)
    
    if output_path is not None:
        save_png_safe(output_path, mask_img)
        logger.info(f"Mask image saved to {output_path}")
    
    return mask_img


def create_transparent_segmentation_overlay(mask: np.ndarray,
                                            bbox: Optional[dict] = None,
                                            output_path: Optional[str] = None) -> np.ndarray:
    """
    Create a transparent PNG overlay containing only segmentation graphics.

    This is intended for UI overlay on top of the Cornerstone DICOM canvas. It
    deliberately does not include the CT pixels, so enabling Seg does not wash
    out or double-render the image.
    """
    mask = (mask > 0).astype(np.uint8)
    height, width = mask.shape
    overlay = np.zeros((height, width, 4), dtype=np.uint8)

    if int(mask.sum()) > 0:
        fill = mask > 0
        overlay[fill, 0] = 70
        overlay[fill, 1] = 220
        overlay[fill, 2] = 80
        overlay[fill, 3] = 70

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour_layer = np.zeros_like(overlay)
        cv2.drawContours(contour_layer, contours, -1, (40, 230, 255, 210), 2)
        contour_alpha = contour_layer[:, :, 3] > 0
        overlay[contour_alpha] = contour_layer[contour_alpha]

    if bbox is not None:
        x_min = int(bbox.get('x_min', 0))
        x_max = int(bbox.get('x_max', width - 1))
        y_min = int(bbox.get('y_min', 0))
        y_max = int(bbox.get('y_max', height - 1))
        cv2.rectangle(overlay, (x_min, y_min), (x_max, y_max), (255, 255, 210, 230), 2)

    if output_path is not None:
        save_png_safe(output_path, overlay)
        logger.info(f"Transparent segmentation overlay saved to {output_path}")

    return overlay
