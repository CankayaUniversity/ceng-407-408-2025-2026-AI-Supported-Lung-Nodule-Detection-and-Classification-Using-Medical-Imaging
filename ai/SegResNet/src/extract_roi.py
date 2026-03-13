"""
Module: extract_roi.py
Purpose: Extract Region of Interest (ROI) from predicted masks
         Generate bounding boxes around segmented nodules
         Save ROI crops for downstream analysis/classification

Typical workflow:
1. Load segmentation mask from model
2. Find connected components (individual nodules)
3. For each nodule:
   - Compute bounding box
   - Extract ROI from original image
   - Optionally pad/expand ROI
   - Save ROI
4. Create ROI metadata file
"""

import os
from typing import List, Tuple
import logging

import numpy as np
from scipy import ndimage

logger = logging.getLogger(__name__)


class ROI:
    """Represents a Region of Interest (bounding box)."""
    
    def __init__(self, label_id: int, 
                 bounds: Tuple[int, int, int, int, int, int],
                 center: Tuple[float, float, float],
                 volume: float):
        """
        Args:
            label_id: ID of this ROI
            bounds: (z_min, z_max, y_min, y_max, x_min, x_max)
            center: (z, y, x) coordinates of center
            volume: Volume of ROI in voxels
        """
        self.label_id = label_id
        self.bounds = bounds
        self.center = center
        self.volume = volume
    
    def to_dict(self):
        """Convert to dictionary for JSON serialization."""
        return {
            'label_id': int(self.label_id),
            'bounds': self.bounds,
            'center': self.center,
            'volume': float(self.volume),
        }


def find_connected_components(mask: np.ndarray) -> Tuple[np.ndarray, int]:
    """
    Find connected components in binary mask.
    
    Args:
        mask: Binary segmentation mask (3D array)
        
    Returns:
        Tuple of (labeled_array, num_components)
    """
    logger.info("Finding connected components...")
    
    # TODO: Use scipy.ndimage.label
    # labeled_array, num_components = ndimage.label(mask)
    
    return None, 0


def extract_bounding_box(labeled_mask: np.ndarray, label: int) -> Tuple[int, ...]:
    """
    Extract bounding box coordinates for a labeled region.
    
    Args:
        labeled_mask: Array with labeled components
        label: Component label ID
        
    Returns:
        Tuple of (z_min, z_max, y_min, y_max, x_min, x_max)
    """
    # TODO: Find min/max indices for this label
    # positions = np.where(labeled_mask == label)
    # z_min, z_max = positions[0].min(), positions[0].max()
    # etc.
    
    return (0, 0, 0, 0, 0, 0)  # Placeholder


def extract_roi_from_image(image: np.ndarray, 
                          bounds: Tuple[int, ...],
                          padding: int = 10) -> np.ndarray:
    """
    Extract ROI crop from image using bounding box.
    
    Args:
        image: 3D CT image
        bounds: Bounding box (z_min, z_max, y_min, y_max, x_min, x_max)
        padding: Number of voxels to pad bbox
        
    Returns:
        ROI crop
    """
    z_min, z_max, y_min, y_max, x_min, x_max = bounds
    
    # TODO: Apply padding
    z_min = max(0, z_min - padding)
    z_max = min(image.shape[0], z_max + padding)
    y_min = max(0, y_min - padding)
    y_max = min(image.shape[1], y_max + padding)
    x_min = max(0, x_min - padding)
    x_max = min(image.shape[2], x_max + padding)
    
    # Extract
    roi = image[z_min:z_max+1, y_min:y_max+1, x_min:x_max+1]
    
    return roi


def extract_all_rois(image: np.ndarray,
                     mask: np.ndarray,
                     min_volume: int = 50) -> List[ROI]:
    """
    Extract all ROIs from an image/mask pair.
    
    Args:
        image: 3D CT image
        mask: Binary segmentation mask
        min_volume: Minimum voxel volume to keep
        
    Returns:
        List of ROI objects
    """
    logger.info("Extracting ROIs from mask...")
    
    # Find connected components
    labeled_mask, num_components = find_connected_components(mask)
    
    rois = []
    
    for label_id in range(1, num_components + 1):
        # TODO:
        # 1. Extract bounding box
        # 2. Compute volume and center
        # 3. Filter by minimum volume
        # 4. Create ROI object
        # 5. Append to list
        
        pass
    
    return rois


def save_rois(rois: List[ROI], image: np.ndarray, mask: np.ndarray,
              output_dir: str, case_id: str):
    """
    Save all ROIs with metadata.
    
    Args:
        rois: List of ROI objects
        image: Original 3D image
        mask: Segmentation mask
        output_dir: Directory to save ROIs
        case_id: Patient/case identifier
    """
    logger.info(f"Saving {len(rois)} ROIs to {output_dir}...")
    
    # TODO:
    # 1. Create case-specific subdirectory
    # 2. For each ROI:
    #    - Extract crop from image
    #    - Save as NIfTI or NPZ
    #    - Save corresponding mask crop
    # 3. Save metadata JSON with all ROI info


def main():
    """Main ROI extraction execution."""
    logging.basicConfig(level=logging.INFO)
    
    # TODO:
    # 1. Load prediction mask
    # 2. Load original image
    # 3. Extract all ROIs
    # 4. Save ROIs and metadata


if __name__ == "__main__":
    main()
