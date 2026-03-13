"""
Module: split_dataset.py
Purpose: Split 2.5D dataset into train/val/test folders.

After running build_25d_dataset.py, all samples are in a single directory.
This script splits them into train/val/test folders for proper training.

Split strategy:
- Train: 70% of samples (learning from data)
- Val:   15% of samples (tuning hyperparameters)
- Test:  15% of samples (final evaluation, untouched during training)

Split is done per patient to prevent data leakage:
- All samples from one patient go to same split
- Ensures no overlap between train/val/test

Typical usage:
    python split_dataset.py --input data/lidc_25d --output data/lidc_25d
    
This will create:
    data/lidc_25d/train/
    data/lidc_25d/val/
    data/lidc_25d/test/
"""

import os
import shutil
import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple
import argparse
from collections import defaultdict
import random

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_patient_samples(data_dir: str) -> Dict[str, List[str]]:
    """
    Group samples by patient ID.
    
    Assumes filename format: {patient_id}_slice_{slice_num}.npz
    
    Args:
        data_dir: Directory containing .npz samples
        
    Returns:
        Dictionary: {patient_id: [list of sample files]}
    """
    data_path = Path(data_dir)
    samples = defaultdict(list)
    
    for npz_file in sorted(data_path.glob('*.npz')):
        # Extract patient_id from filename: LIDC-IDRI-0001_slice_0030.npz
        parts = npz_file.stem.split('_slice_')
        if len(parts) == 2:
            patient_id = parts[0]
            samples[patient_id].append(str(npz_file))
    
    return dict(samples)


def split_patients(patient_samples: Dict[str, List[str]], 
                  train_ratio: float = 0.7,
                  val_ratio: float = 0.15,
                  test_ratio: float = 0.15,
                  random_seed: int = 42) -> Tuple[List[str], List[str], List[str]]:
    """
    Split patients into train/val/test groups.
    
    Args:
        patient_samples: Dict of {patient_id: [files]}
        train_ratio: Fraction for training (default 0.7)
        val_ratio: Fraction for validation (default 0.15)
        test_ratio: Fraction for testing (default 0.15)
        random_seed: Seed for reproducibility
        
    Returns:
        Tuple of (train_patients, val_patients, test_patients)
    """
    # Verify ratios sum to 1.0
    total = train_ratio + val_ratio + test_ratio
    if abs(total - 1.0) > 1e-6:
        raise ValueError(f"Split ratios must sum to 1.0, got {total:.4f}")
    
    # Shuffle patient list
    random.seed(random_seed)
    patient_ids = list(patient_samples.keys())
    random.shuffle(patient_ids)
    
    # Calculate split indices
    num_patients = len(patient_ids)
    train_count = int(num_patients * train_ratio)
    val_count = int(num_patients * val_ratio)
    
    # Split patients
    train_patients = patient_ids[:train_count]
    val_patients = patient_ids[train_count:train_count + val_count]
    test_patients = patient_ids[train_count + val_count:]
    
    logger.info(f"Split {num_patients} patients:")
    logger.info(f"  Train: {len(train_patients)} patients")
    logger.info(f"  Val:   {len(val_patients)} patients")
    logger.info(f"  Test:  {len(test_patients)} patients")
    
    return train_patients, val_patients, test_patients


def organize_samples(patient_samples: Dict[str, List[str]],
                    train_patients: List[str],
                    val_patients: List[str],
                    test_patients: List[str]) -> Tuple[List[str], List[str], List[str]]:
    """
    Collect all samples for each split.
    
    Args:
        patient_samples: Dict of {patient_id: [files]}
        train_patients: List of patient IDs for training
        val_patients: List of patient IDs for validation
        test_patients: List of patient IDs for testing
        
    Returns:
        Tuple of (train_files, val_files, test_files)
    """
    train_files = []
    val_files = []
    test_files = []
    
    for patient_id in train_patients:
        train_files.extend(patient_samples[patient_id])
    
    for patient_id in val_patients:
        val_files.extend(patient_samples[patient_id])
    
    for patient_id in test_patients:
        test_files.extend(patient_samples[patient_id])
    
    logger.info(f"Total samples:")
    logger.info(f"  Train: {len(train_files)} samples")
    logger.info(f"  Val:   {len(val_files)} samples")
    logger.info(f"  Test:  {len(test_files)} samples")
    
    return train_files, val_files, test_files


def copy_files(files: List[str], dest_dir: str, split_name: str) -> int:
    """
    Copy files to destination directory.
    
    Args:
        files: List of file paths to copy
        dest_dir: Destination directory
        split_name: Name of split (for logging)
        
    Returns:
        Number of files copied
    """
    dest_path = Path(dest_dir)
    dest_path.mkdir(parents=True, exist_ok=True)
    
    count = 0
    for src_file in files:
        src_path = Path(src_file)
        dest_file = dest_path / src_path.name
        
        # Skip if already exists
        if dest_file.exists():
            logger.debug(f"Skipping (already exists): {dest_file.name}")
            continue
        
        shutil.copy2(src_file, dest_file)
        count += 1
        
        # Progress logging
        if count % max(1, len(files) // 5) == 0:
            logger.info(f"  {split_name}: copied {count}/{len(files)} samples")
    
    logger.info(f"✓ {split_name}: {count} samples copied to {dest_path}")
    return count


def save_split_metadata(output_dir: str,
                       train_count: int,
                       val_count: int,
                       test_count: int,
                       train_ratio: float,
                       val_ratio: float,
                       test_ratio: float):
    """
    Save split metadata to JSON for reference.
    
    Args:
        output_dir: Output directory
        train_count: Number of training samples
        val_count: Number of validation samples
        test_count: Number of test samples
        train_ratio: Training ratio
        val_ratio: Validation ratio
        test_ratio: Test ratio
    """
    metadata = {
        'split': {
            'train': train_count,
            'val': val_count,
            'test': test_count,
            'total': train_count + val_count + test_count,
        },
        'ratios': {
            'train': float(train_ratio),
            'val': float(val_ratio),
            'test': float(test_ratio),
        },
        'paths': {
            'train': 'train/',
            'val': 'val/',
            'test': 'test/',
        }
    }
    
    metadata_file = Path(output_dir) / 'split_metadata.json'
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)
    
    logger.info(f"\nSaved split metadata to {metadata_file}")


def main():
    """Main execution: split dataset."""
    parser = argparse.ArgumentParser(
        description="Split 2.5D dataset into train/val/test folders"
    )
    parser.add_argument(
        '--input',
        type=str,
        default='data/lidc_25d',
        help='Directory containing .npz samples (from build_25d_dataset.py)'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='data/lidc_25d',
        help='Output directory (will create train/, val/, test/ subdirs)'
    )
    parser.add_argument(
        '--train-ratio',
        type=float,
        default=0.7,
        help='Fraction of data for training (default 0.7)'
    )
    parser.add_argument(
        '--val-ratio',
        type=float,
        default=0.15,
        help='Fraction of data for validation (default 0.15)'
    )
    parser.add_argument(
        '--test-ratio',
        type=float,
        default=0.15,
        help='Fraction of data for testing (default 0.15)'
    )
    parser.add_argument(
        '--seed',
        type=int,
        default=42,
        help='Random seed for reproducibility (default 42)'
    )
    
    args = parser.parse_args()
    
    input_dir = Path(args.input)
    if not input_dir.exists():
        logger.error(f"Input directory not found: {input_dir}")
        return 1
    
    # Check for existing split directories
    output_dir = Path(args.output)
    train_dir = output_dir / 'train'
    val_dir = output_dir / 'val'
    test_dir = output_dir / 'test'
    
    if train_dir.exists() or val_dir.exists() or test_dir.exists():
        logger.warning("Split directories already exist. Skipping...")
        logger.info(f"  Train samples: {len(list(train_dir.glob('*.npz')))}")
        logger.info(f"  Val samples: {len(list(val_dir.glob('*.npz')))}")
        logger.info(f"  Test samples: {len(list(test_dir.glob('*.npz')))}")
        return 0
    
    logger.info("="*60)
    logger.info("Dataset Split (Train/Val/Test)")
    logger.info("="*60 + "\n")
    
    # Get patient samples
    logger.info(f"Scanning {input_dir} for samples...")
    patient_samples = get_patient_samples(str(input_dir))
    
    if not patient_samples:
        logger.error(f"No .npz samples found in {input_dir}")
        return 1
    
    logger.info(f"Found {len(patient_samples)} patients\n")
    
    # Split patients
    logger.info(f"Splitting with ratios: "
               f"train={args.train_ratio}, val={args.val_ratio}, test={args.test_ratio}")
    train_patients, val_patients, test_patients = split_patients(
        patient_samples,
        train_ratio=args.train_ratio,
        val_ratio=args.val_ratio,
        test_ratio=args.test_ratio,
        random_seed=args.seed
    )
    
    logger.info("")
    
    # Organize samples
    train_files, val_files, test_files = organize_samples(
        patient_samples,
        train_patients,
        val_patients,
        test_patients
    )
    
    logger.info("")
    
    # Create output directories and copy files
    logger.info("Copying samples to split directories...\n")
    
    train_count = copy_files(train_files, str(train_dir), "Train")
    val_count = copy_files(val_files, str(val_dir), "Val")
    test_count = copy_files(test_files, str(test_dir), "Test")
    
    # Save metadata
    save_split_metadata(
        str(output_dir),
        train_count,
        val_count,
        test_count,
        args.train_ratio,
        args.val_ratio,
        args.test_ratio
    )
    
    logger.info("\n" + "="*60)
    logger.info("✓ Dataset split complete!")
    logger.info("="*60)
    logger.info("\nNext steps:")
    logger.info("1. Start training: python src/train_segresnet.py --config configs/train_config.yaml")
    logger.info("2. Run inference: python src/infer_segresnet.py --model outputs/checkpoints/best_model.pth \\")
    logger.info("                  --input data/lidc_25d/test --output outputs/predictions")
    
    return 0


if __name__ == "__main__":
    exit_code = main()
    exit(exit_code)
