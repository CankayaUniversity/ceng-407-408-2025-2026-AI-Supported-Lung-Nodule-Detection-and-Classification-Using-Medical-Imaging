"""
Module: build_25d_dataset.py
Purpose: Convert 3D medical images to 2.5D dataset
         2.5D = central slice + neighboring slices
         This approach reduces memory while preserving 3D context

TODO:
- Load 3D volumes (NIfTI or DICOM)
- Create 2.5D slices (e.g., slice-1, slice, slice+1)
- Save as HDF5 or NumPy arrays
- Create train/val/test split
"""

import os
import logging
from typing import Tuple, List

import numpy as np

logger = logging.getLogger(__name__)


def load_3d_volume(path: str) -> Tuple[np.ndarray, np.ndarray]:
    """
    Load 3D CT volume and corresponding mask.
    
    Args:
        path: Path to volume file (NIfTI or DICOM series)
        
    Returns:
        Tuple of (volume, mask) as numpy arrays
    """
    logger.info(f"Loading volume from {path}...")
    # TODO: Load using SimpleITK or nibabel
    pass


def create_25d_slices(volume: np.ndarray, 
                      mask: np.ndarray,
                      window: int = 3) -> Tuple[List, List]:
    """
    Create 2.5D slices from 3D volume.
    2.5D = [slice-1, slice, slice+1] stacked as 3 channels
    
    Args:
        volume: 3D CT volume (D, H, W)
        mask: 3D segmentation mask (D, H, W)
        window: Number of slices to use (typically 3)
        
    Returns:
        Lists of 2.5D images and masks
    """
    depth = volume.shape[0]
    slices_25d = []
    masks_25d = []
    
    logger.info(f"Creating 2.5D slices with window={window}...")
    
    # TODO:
    # For each slice d in depth:
    #   - Extract neighboring slices [d-1, d, d+1]
    #   - Handle boundary cases
    #   - Stack as 3-channel image
    #   - Append to lists
    
    return slices_25d, masks_25d


def build_dataset(input_dir: str, output_dir: str, test_split: float = 0.2):
    """
    Build complete 2.5D dataset from 3D volumes.
    
    Args:
        input_dir: Directory with prepared 3D volumes
        output_dir: Directory to save 2.5D dataset
        test_split: Fraction of data for test set
    """
    logger.info(f"Building 2.5D dataset from {input_dir}...")
    
    # TODO:
    # 1. List all volumes in input_dir
    # 2. For each volume:
    #    - Load 3D volume and mask
    #    - Create 2.5D slices
    #    - Save to HDF5 or NPZ
    # 3. Create train/val/test split
    # 4. Save split information (JSON)


def main():
    """Main execution: build 2.5D dataset"""
    logger.basicConfig(level=logging.INFO)
    
    input_dir = "data/lidc_3d"
    output_dir = "data/lidc_25d"
    
    build_dataset(input_dir, output_dir)


if __name__ == "__main__":
    main()
