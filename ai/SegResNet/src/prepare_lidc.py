"""
Module: prepare_lidc.py
Purpose: Prepare LIDC-IDRI CT scans and segmentation masks for training.

This module handles:
1. Reading CT volumes from DICOM series
2. Reading nodule annotations (contours or coordinates)
3. Creating binary nodule masks
4. Saving processed volumes and masks

Typical usage:
    python prepare_lidc.py --input /path/to/lidc --output data/lidc_processed
"""

import os
import sys
import logging
from pathlib import Path
from typing import Tuple, Optional, List
import argparse

import numpy as np
import SimpleITK as sitk
import pydicom

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class LIDCProcessor:
    """Process LIDC-IDRI dataset: read scans and create nodule masks."""
    
    def __init__(self, output_dir: str):
        """
        Initialize processor.
        
        Args:
            output_dir: Directory to save processed data
        """
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"Output directory: {self.output_dir}")
    
    def load_dicom_series(self, dicom_dir: str) -> Tuple[np.ndarray, dict]:
        """
        Load a DICOM series from directory.
        
        Args:
            dicom_dir: Directory containing DICOM files for one scan
            
        Returns:
            Tuple of (volume array, metadata dict)
            
        Raises:
            ValueError: If no valid DICOM files found
        """
        logger.info(f"Loading DICOM series from {dicom_dir}...")
        
        dicom_files = sorted(
            Path(dicom_dir).glob("*.dcm"),
            key=lambda p: int(p.stem) if p.stem.isdigit() else p.stem
        )
        
        if not dicom_files:
            raise ValueError(f"No DICOM files found in {dicom_dir}")
        
        logger.info(f"Found {len(dicom_files)} DICOM files")
        
        # Use SimpleITK to read series
        reader = sitk.ImageSeriesReader()
        reader.SetFileNames([str(f) for f in dicom_files])
        
        try:
            image = reader.Execute()
            volume = sitk.GetArrayFromImage(image)  # (D, H, W)
            
            logger.info(f"Volume shape: {volume.shape}, dtype: {volume.dtype}")
            
            # Store metadata
            metadata = {
                'spacing': image.GetSpacing(),
                'origin': image.GetOrigin(),
                'direction': image.GetDirection(),
            }
            
            return volume, metadata
            
        except Exception as e:
            logger.error(f"Failed to load DICOM series: {e}")
            raise
    
    def read_nodule_annotations(self, annotation_file: str) -> List[dict]:
        """
        Read nodule annotations from file.
        
        TODO: This needs project-specific adjustment!
        Different LIDC sources have different annotation formats:
        - XML files (LIDC standard): Use xml.etree or pylidc library
        - CSV files: Use pandas.read_csv()
        - JSON files: Use json.load()
        - numpy arrays: Use np.load()
        
        Current implementation is a placeholder that expects:
        A list of dicts with keys: 'z', 'y', 'x', 'radius' (in mm)
        
        Args:
            annotation_file: Path to annotation file
            
        Returns:
            List of nodule dictionaries with coordinates
        """
        logger.info(f"Reading annotations from {annotation_file}...")
        
        if not os.path.exists(annotation_file):
            logger.warning(f"Annotation file not found: {annotation_file}")
            return []
        
        # TODO: Implement annotation parsing based on your data format
        # Example for XML (LIDC standard):
        # import xml.etree.ElementTree as ET
        # tree = ET.parse(annotation_file)
        # root = tree.getroot()
        # nodules = []
        # for nodule_elem in root.findall('.//nodule'):
        #     roi_info = nodule_elem.find('roi')
        #     if roi_info is not None:
        #         z = int(roi_info.find('imageZposition').text)
        #         # Extract x, y coordinates from contour points
        #         nodules.append({'z': z, 'y': y_center, 'x': x_center, 'radius': radius})
        # return nodules
        
        # Placeholder: return empty list
        return []
    
    def create_nodule_mask(self, volume_shape: Tuple, 
                          nodules: List[dict],
                          spacing: Tuple = (1.0, 1.0, 1.0)) -> np.ndarray:
        """
        Create binary mask from nodule annotations.
        
        Args:
            volume_shape: Shape of CT volume (D, H, W)
            nodules: List of nodule dictionaries with coordinates
            spacing: Voxel spacing (z_spacing, y_spacing, x_spacing) in mm
            
        Returns:
            Binary mask array (1 = nodule, 0 = background)
        """
        logger.info(f"Creating nodule mask from {len(nodules)} nodules...")
        
        mask = np.zeros(volume_shape, dtype=np.uint8)
        
        for i, nodule in enumerate(nodules):
            try:
                # Get nodule center and radius (in mm)
                z_center = nodule.get('z', 0)
                y_center = nodule.get('y', 0)
                x_center = nodule.get('x', 0)
                radius_mm = nodule.get('radius', 5.0)
                
                # Convert mm to voxel coordinates
                # TODO: Adjust if spacing order is different
                z_idx = int(z_center / spacing[0])
                y_idx = int(y_center / spacing[1])
                x_idx = int(x_center / spacing[2])
                
                # Convert radius from mm to voxels
                radius_voxels = int(radius_mm / spacing[0])  # Approximate
                
                # Create sphere mask
                zz, yy, xx = np.ogrid[
                    max(0, z_idx - radius_voxels) : min(volume_shape[0], z_idx + radius_voxels + 1),
                    max(0, y_idx - radius_voxels) : min(volume_shape[1], y_idx + radius_voxels + 1),
                    max(0, x_idx - radius_voxels) : min(volume_shape[2], x_idx + radius_voxels + 1)
                ]
                
                # Distance from center
                dist = np.sqrt(
                    ((zz - z_idx) * spacing[0]) ** 2 +
                    ((yy - y_idx) * spacing[1]) ** 2 +
                    ((xx - x_idx) * spacing[2]) ** 2
                )
                
                # Mark voxels within radius
                region_mask = (dist <= radius_mm)
                mask[
                    max(0, z_idx - radius_voxels) : min(volume_shape[0], z_idx + radius_voxels + 1),
                    max(0, y_idx - radius_voxels) : min(volume_shape[1], y_idx + radius_voxels + 1),
                    max(0, x_idx - radius_voxels) : min(volume_shape[2], x_idx + radius_voxels + 1)
                ][region_mask] = 1
                
                logger.info(f"  Nodule {i+1}: center=({z_idx}, {y_idx}, {x_idx}), "
                           f"radius={radius_voxels} voxels")
                
            except Exception as e:
                logger.warning(f"Failed to process nodule {i+1}: {e}")
                continue
        
        return mask
    
    def save_volume(self, volume: np.ndarray, filename: str, 
                   metadata: Optional[dict] = None) -> str:
        """
        Save volume to file (.npy or .nii.gz).
        
        Args:
            volume: 3D numpy array
            filename: Output filename (without path)
            metadata: Optional metadata dict
            
        Returns:
            Path to saved file
        """
        filepath = self.output_dir / filename
        
        if filename.endswith('.nii.gz') or filename.endswith('.nii'):
            # Save as NIfTI using SimpleITK
            image = sitk.GetImageFromArray(volume)
            if metadata:
                if 'spacing' in metadata:
                    image.SetSpacing(metadata['spacing'])
                if 'origin' in metadata:
                    image.SetOrigin(metadata['origin'])
            sitk.WriteImage(image, str(filepath))
            
        else:
            # Save as NumPy array
            np.save(str(filepath), volume)
        
        logger.info(f"Saved to {filepath} (shape: {volume.shape})")
        return str(filepath)
    
    def process_patient(self, patient_id: str, dicom_dir: str,
                       annotation_file: Optional[str] = None) -> bool:
        """
        Process a single patient: load scan, create mask, save both.
        
        Args:
            patient_id: Patient identifier (e.g., "LIDC-IDRI-0001")
            dicom_dir: Directory containing DICOM files
            annotation_file: Optional path to annotation file
            
        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Processing patient {patient_id}...")
        
        try:
            # Load CT volume
            volume, metadata = self.load_dicom_series(dicom_dir)
            
            # Read annotations
            nodules = []
            if annotation_file:
                nodules = self.read_nodule_annotations(annotation_file)
            
            if not nodules:
                logger.warning(f"No valid nodules found for {patient_id}")
            
            # Create mask
            mask = self.create_nodule_mask(
                volume.shape,
                nodules,
                spacing=metadata.get('spacing', (1.0, 1.0, 1.0))
            )
            
            # Save outputs
            volume_file = f"{patient_id}_image.npy"
            mask_file = f"{patient_id}_mask.npy"
            
            self.save_volume(volume, volume_file, metadata)
            self.save_volume(mask, mask_file)
            
            logger.info(f"✓ Successfully processed {patient_id}\n")
            return True
            
        except Exception as e:
            logger.error(f"✗ Failed to process {patient_id}: {e}\n")
            return False


def main():
    """Main execution: prepare LIDC dataset."""
    parser = argparse.ArgumentParser(
        description="Prepare LIDC-IDRI dataset for training"
    )
    parser.add_argument(
        '--input',
        type=str,
        required=True,
        help='Root directory of LIDC-IDRI data'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='data/lidc_processed',
        help='Output directory for processed data'
    )
    parser.add_argument(
        '--patient',
        type=str,
        default=None,
        help='Process single patient (e.g., LIDC-IDRI-0001). If None, process all.'
    )
    
    args = parser.parse_args()
    
    input_dir = Path(args.input)
    if not input_dir.exists():
        logger.error(f"Input directory not found: {input_dir}")
        return 1
    
    processor = LIDCProcessor(args.output)
    
    # TODO: Adjust patient folder naming and structure to match your data
    # Example: LIDC-IDRI/LIDC-IDRI-0001/01-01/
    
    logger.info("="*60)
    logger.info("LIDC-IDRI Dataset Preparation")
    logger.info("="*60)
    
    if args.patient:
        # Process single patient
        patient_id = args.patient
        patient_dir = input_dir / patient_id
        
        if not patient_dir.exists():
            logger.error(f"Patient directory not found: {patient_dir}")
            return 1
        
        # TODO: Adjust for your folder structure (e.g., 01-01 subdirs)
        dicom_dir = patient_dir / '01-01'
        annotation_file = patient_dir / f'{patient_id}.xml'
        
        success = processor.process_patient(
            patient_id,
            str(dicom_dir),
            str(annotation_file) if annotation_file.exists() else None
        )
        
        return 0 if success else 1
    
    else:
        # Process all patients
        logger.info(f"Scanning {input_dir} for patients...")
        
        patient_dirs = sorted([d for d in input_dir.iterdir() if d.is_dir()])
        
        if not patient_dirs:
            logger.warning(f"No patient directories found in {input_dir}")
            return 1
        
        logger.info(f"Found {len(patient_dirs)} patients\n")
        
        successful = 0
        failed = 0
        
        for patient_dir in patient_dirs:
            patient_id = patient_dir.name
            
            # TODO: Adjust folder structure to match your LIDC layout
            # Standard LIDC structure: LIDC-IDRI-XXXX/01-01/01-XX.dcm
            dicom_subdir = patient_dir / '01-01'
            annotation_file = patient_dir / f'{patient_id}.xml'
            
            if not dicom_subdir.exists():
                logger.warning(f"DICOM directory not found: {dicom_subdir}")
                failed += 1
                continue
            
            success = processor.process_patient(
                patient_id,
                str(dicom_subdir),
                str(annotation_file) if annotation_file.exists() else None
            )
            
            if success:
                successful += 1
            else:
                failed += 1
        
        logger.info("="*60)
        logger.info(f"Processing complete: {successful} successful, {failed} failed")
        logger.info("="*60)
        
        return 0 if failed == 0 else 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
