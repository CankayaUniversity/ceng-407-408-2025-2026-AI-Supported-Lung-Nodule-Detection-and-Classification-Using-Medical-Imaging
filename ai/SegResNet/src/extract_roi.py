"""
Module: extract_roi.py
Purpose: Extract ROI patches from predicted lung nodule masks

Simple workflow:
1. Load CT volume and binary nodule mask
2. Find individual nodules (connected components)
3. Extract bounding box around each nodule
4. Crop ROI patch with optional padding
5. Save crops and basic metadata
"""

import json
from pathlib import Path
from typing import Tuple

import numpy as np
from scipy.ndimage import label


def find_nodules(mask: np.ndarray) -> Tuple[np.ndarray, int]:
    """
    Find individual nodules in binary mask using connected components.
    
    Args:
        mask: Binary segmentation mask (3D array, shape: D x H x W)
        
    Returns:
        labeled_mask: Array with each nodule labeled with unique ID (1, 2, 3...)
        num_nodules: Number of nodules found
    """
    labeled_mask, num_nodules = label(mask)
    print(f"Found {num_nodules} nodules")
    return labeled_mask, num_nodules


def get_bounding_box(labeled_mask: np.ndarray, nodule_id: int) -> Tuple[int, ...]:
    """
    Get bounding box for a single nodule.
    
    Args:
        labeled_mask: Labeled mask from find_nodules()
        nodule_id: ID of the nodule (1, 2, 3...)
        
    Returns:
        (z_min, z_max, y_min, y_max, x_min, x_max) - bounding box coordinates
    """
    indices = np.where(labeled_mask == nodule_id)
    
    z_min, z_max = indices[0].min(), indices[0].max()
    y_min, y_max = indices[1].min(), indices[1].max()
    x_min, x_max = indices[2].min(), indices[2].max()
    
    return (z_min, z_max, y_min, y_max, x_min, x_max)


def extract_roi(volume: np.ndarray, bbox: Tuple[int, ...], 
                padding: int = 10) -> np.ndarray:
    """
    Extract ROI crop from CT volume given a bounding box.
    
    Args:
        volume: 3D CT volume (D x H x W)
        bbox: Bounding box (z_min, z_max, y_min, y_max, x_min, x_max)
        padding: Extra voxels to include around bbox (default 10)
        
    Returns:
        roi: 3D crop of the nodule region
    """
    z_min, z_max, y_min, y_max, x_min, x_max = bbox
    
    # Add padding and clip to volume boundaries
    z_min = max(0, z_min - padding)
    z_max = min(volume.shape[0] - 1, z_max + padding)
    y_min = max(0, y_min - padding)
    y_max = min(volume.shape[1] - 1, y_max + padding)
    x_min = max(0, x_min - padding)
    x_max = min(volume.shape[2] - 1, x_max + padding)
    
    roi = volume[z_min:z_max+1, y_min:y_max+1, x_min:x_max+1]
    
    return roi


def extract_all_rois(volume: np.ndarray, mask: np.ndarray, 
                     padding: int = 10) -> dict:
    """
    Extract all nodule ROIs from a CT volume.
    
    Args:
        volume: 3D CT volume
        mask: Binary segmentation mask
        padding: Padding around each nodule (default 10)
        
    Returns:
        Dictionary with extracted ROIs and metadata
    """
    if volume.shape != mask.shape:
        raise ValueError(f"Shape mismatch: volume {volume.shape} vs mask {mask.shape}")
    
    labeled_mask, num_nodules = find_nodules(mask)
    
    rois = {}
    metadata = []
    
    for nodule_id in range(1, num_nodules + 1):
        # Get bounding box
        bbox = get_bounding_box(labeled_mask, nodule_id)
        
        # Extract ROI
        roi = extract_roi(volume, bbox, padding)
        roi_mask = extract_roi(mask.astype(np.uint8), bbox, padding)
        
        # Compute statistics
        nodule_voxels = np.where(labeled_mask == nodule_id)
        center = (
            float(nodule_voxels[0].mean()),
            float(nodule_voxels[1].mean()),
            float(nodule_voxels[2].mean())
        )
        num_voxels = int((labeled_mask == nodule_id).sum())
        
        # Store ROI
        roi_name = f"roi_{nodule_id:03d}"
        rois[roi_name] = {
            'volume': roi,
            'mask': roi_mask,
            'bbox': bbox,
            'center': center,
            'num_voxels': num_voxels,
        }
        
        metadata.append({
            'roi_id': nodule_id,
            'bbox': bbox,
            'center': center,
            'num_voxels': num_voxels,
        })
        
        print(f"  ROI {nodule_id}: bbox {bbox}, voxels {num_voxels}")
    
    return {'rois': rois, 'metadata': metadata}


def save_rois(roi_data: dict, output_dir: str, patient_id: str):
    """
    Save extracted ROIs to disk.
    
    Creates folder: output_dir/patient_id/
    Files: roi_001_volume.npy, roi_001_mask.npy, roi_002_volume.npy, etc.
    
    Args:
        roi_data: Output from extract_all_rois()
        output_dir: Base directory for saving
        patient_id: Patient identifier (used as subfolder)
    """
    output_path = Path(output_dir) / patient_id
    output_path.mkdir(parents=True, exist_ok=True)
    
    print(f"\nSaving ROIs to {output_path}")
    
    for roi_name, roi_info in roi_data['rois'].items():
        roi_id = int(roi_name.split('_')[1])
        
        # Save volume and mask as .npy
        vol_file = output_path / f"roi_{roi_id:03d}_volume.npy"
        np.save(str(vol_file), roi_info['volume'])
        
        mask_file = output_path / f"roi_{roi_id:03d}_mask.npy"
        np.save(str(mask_file), roi_info['mask'])
        
        print(f"  Saved {vol_file.name}")
    
    # Save metadata as JSON
    meta_file = output_path / "roi_metadata.json"
    with open(meta_file, 'w') as f:
        json.dump({
            'patient_id': patient_id,
            'num_rois': len(roi_data['rois']),
            'rois': roi_data['metadata']
        }, f, indent=2)
    
    print(f"  Saved {meta_file.name}")


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Extract ROIs from nodule masks")
    parser.add_argument('--volume', type=str, required=True,
                       help='Path to 3D CT volume (.npy)')
    parser.add_argument('--mask', type=str, required=True,
                       help='Path to nodule mask (.npy)')
    parser.add_argument('--output', type=str, default='outputs/rois',
                       help='Output directory')
    parser.add_argument('--padding', type=int, default=10,
                       help='Padding around nodule')
    parser.add_argument('--patient-id', type=str, default='patient_001',
                       help='Patient identifier')
    
    args = parser.parse_args()
    
    # Load data
    print(f"Loading volume: {args.volume}")
    print(f"Loading mask: {args.mask}")
    volume = np.load(args.volume)
    mask = np.load(args.mask)
    
    # Extract ROIs
    print("\nExtracting ROIs...")
    roi_data = extract_all_rois(volume, mask, padding=args.padding)
    
    # Save ROIs
    save_rois(roi_data, args.output, args.patient_id)
    
    print("\n✓ ROI extraction complete")
