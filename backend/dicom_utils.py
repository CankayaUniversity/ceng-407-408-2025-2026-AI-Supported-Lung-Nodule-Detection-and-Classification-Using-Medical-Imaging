#!/usr/bin/env python3
"""
DICOM utility functions for loading, sorting, and preprocessing CT volumes.
"""

import os
import numpy as np
import pydicom
from typing import List, Tuple, Dict
import logging

logger = logging.getLogger(__name__)


def get_pixel_spacing(ds: pydicom.Dataset) -> Tuple[float, float]:
    """
    Read in-plane pixel spacing from a DICOM slice.

    Returns:
        Tuple of (row_spacing_mm, col_spacing_mm). Falls back to (1.0, 1.0)
        if the metadata is unavailable or invalid.
    """
    pixel_spacing = getattr(ds, 'PixelSpacing', None)
    if pixel_spacing is None or len(pixel_spacing) < 2:
        return 1.0, 1.0

    try:
        row_spacing = float(pixel_spacing[0])
        col_spacing = float(pixel_spacing[1])
        return row_spacing, col_spacing
    except (TypeError, ValueError):
        logger.warning("Invalid PixelSpacing encountered; falling back to 1.0 mm")
        return 1.0, 1.0


def load_dicom_series(series_dir: str) -> Tuple[List[pydicom.Dataset], List[str]]:
    """
    Load all DICOM files from a directory.
    
    Args:
        series_dir: Path to directory containing .dcm files
        
    Returns:
        Tuple of (list of DICOM datasets, list of file paths)
    """
    dicom_files = []
    file_paths = []
    
    for filename in sorted(os.listdir(series_dir)):
        if filename.lower().endswith('.dcm'):
            file_path = os.path.join(series_dir, filename)
            try:
                ds = pydicom.dcmread(file_path)
                dicom_files.append(ds)
                file_paths.append(file_path)
            except Exception as e:
                logger.warning(f"Failed to read {filename}: {e}")
    
    if not dicom_files:
        raise ValueError(f"No valid DICOM files found in {series_dir}")
    
    return dicom_files, file_paths


def sort_dicom_slices(dicom_list: List[pydicom.Dataset]) -> List[pydicom.Dataset]:
    """
    Sort DICOM slices by ImagePositionPatient[2] (z-coordinate) if available,
    otherwise by InstanceNumber or filename.
    
    Args:
        dicom_list: List of DICOM datasets
        
    Returns:
        Sorted list of DICOM datasets
    """
    def get_sort_key(ds):
        # Prefer ImagePositionPatient[2] (z-coordinate)
        if hasattr(ds, 'ImagePositionPatient') and len(ds.ImagePositionPatient) >= 3:
            return float(ds.ImagePositionPatient[2])
        # Fallback to InstanceNumber
        elif hasattr(ds, 'InstanceNumber'):
            return float(ds.InstanceNumber)
        # Last resort
        else:
            return 0
    
    return sorted(dicom_list, key=get_sort_key)


def dicom_to_hu(ds: pydicom.Dataset) -> np.ndarray:
    """
    Convert DICOM pixel array to Hounsfield Units (HU).
    
    Args:
        ds: DICOM dataset
        
    Returns:
        Numpy array in HU values
    """
    if not hasattr(ds, 'pixel_array'):
        raise ValueError("DICOM dataset has no pixel_array")
    
    pixel_array = ds.pixel_array.astype(np.float32)
    
    # Get RescaleSlope and RescaleIntercept
    rescale_slope = float(getattr(ds, 'RescaleSlope', 1.0))
    rescale_intercept = float(getattr(ds, 'RescaleIntercept', 0.0))
    
    # Convert to HU
    hu_array = pixel_array * rescale_slope + rescale_intercept
    
    return hu_array


def dicom_series_to_volume(dicom_list: List[pydicom.Dataset]) -> np.ndarray:
    """
    Convert sorted DICOM series to 3D volume.
    
    Args:
        dicom_list: Sorted list of DICOM datasets
        
    Returns:
        3D numpy array of shape (depth, height, width) in HU units
    """
    slices = []
    for ds in dicom_list:
        hu_slice = dicom_to_hu(ds)
        slices.append(hu_slice)
    
    volume = np.stack(slices, axis=0)
    return volume


def normalize_hu(volume: np.ndarray, hu_min: float = -1000, hu_max: float = 400) -> np.ndarray:
    """
    Normalize HU volume to [0, 1] range.
    
    Args:
        volume: 3D HU array
        hu_min: Minimum HU value for clipping
        hu_max: Maximum HU value for clipping
        
    Returns:
        Normalized volume in [0, 1] range as float32
    """
    # Clip to HU range
    clipped = np.clip(volume, hu_min, hu_max)
    
    # Normalize to [0, 1]
    normalized = (clipped - hu_min) / (hu_max - hu_min)
    
    return normalized.astype(np.float32)


def create_5slice_stack(volume: np.ndarray, center_idx: int) -> np.ndarray:
    """
    Create a 5-slice stack centered at center_idx.
    Pads with edge slices if center_idx is near boundaries.
    
    Args:
        volume: 3D volume of shape (D, H, W)
        center_idx: Index of center slice
        
    Returns:
        5-slice stack of shape (5, H, W)
    """
    D, H, W = volume.shape
    
    # Determine slice indices: [center-2, center-1, center, center+1, center+2]
    indices = [center_idx - 2, center_idx - 1, center_idx, center_idx + 1, center_idx + 2]
    
    # Clip to valid range
    indices = [np.clip(i, 0, D - 1) for i in indices]
    
    stack = np.stack([volume[i] for i in indices], axis=0)
    return stack


def sliding_window_positions(height: int, width: int, 
                            window_size: int = 192, 
                            stride: int = 96) -> List[Tuple[int, int]]:
    """
    Generate sliding window positions for full-size image coverage.
    
    Args:
        height: Image height
        width: Image width
        window_size: Window size (square window)
        stride: Stride between windows
        
    Returns:
        List of (y_start, x_start) positions
    """
    positions = []
    
    # Generate positions with overlap
    y = 0
    while y < height:
        x = 0
        while x < width:
            y_end = min(y + window_size, height)
            x_end = min(x + window_size, width)
            
            # Adjust start if window doesn't fit
            if y_end - y < window_size:
                y_start = max(0, y_end - window_size)
            else:
                y_start = y
            
            if x_end - x < window_size:
                x_start = max(0, x_end - window_size)
            else:
                x_start = x
            
            positions.append((y_start, x_start))
            x += stride
        
        y += stride
    
    # Remove duplicates while preserving order
    seen = set()
    unique_positions = []
    for pos in positions:
        if pos not in seen:
            seen.add(pos)
            unique_positions.append(pos)
    
    return unique_positions


def crop_volume_window(volume_5d: np.ndarray, y_start: int, x_start: int, 
                       window_size: int = 192) -> np.ndarray:
    """
    Crop a window from a 5-slice volume stack.
    
    Args:
        volume_5d: 5-slice stack of shape (5, H, W)
        y_start: Y coordinate of window top-left
        x_start: X coordinate of window top-left
        window_size: Window size
        
    Returns:
        Cropped window of shape (5, H, W) padded if necessary
    """
    _, H, W = volume_5d.shape
    
    y_end = min(y_start + window_size, H)
    x_end = min(x_start + window_size, W)
    
    crop = volume_5d[:, y_start:y_end, x_start:x_end]
    
    # Pad if needed
    if crop.shape[1] < window_size or crop.shape[2] < window_size:
        padded = np.zeros((5, window_size, window_size), dtype=np.float32)
        padded[:, :crop.shape[1], :crop.shape[2]] = crop
        crop = padded
    
    return crop


def get_slice_spacing(dicom_list: List[pydicom.Dataset]) -> float:
    """
    Get slice spacing in mm (PixelSpacing is XY, SliceLocation is Z).
    
    Args:
        dicom_list: List of DICOM datasets
        
    Returns:
        Slice thickness in mm
    """
    if len(dicom_list) < 2:
        return 1.0
    
    # Try SliceThickness first
    if hasattr(dicom_list[0], 'SliceThickness'):
        return float(dicom_list[0].SliceThickness)
    
    # Try computing from ImagePositionPatient[2]
    if hasattr(dicom_list[0], 'ImagePositionPatient') and \
       hasattr(dicom_list[1], 'ImagePositionPatient'):
        z0 = float(dicom_list[0].ImagePositionPatient[2])
        z1 = float(dicom_list[1].ImagePositionPatient[2])
        return abs(z1 - z0)
    
    return 1.0
