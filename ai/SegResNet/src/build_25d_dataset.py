"""
Module: build_25d_dataset.py
Purpose: Convert 3D CT volumes into 2.5D training samples.

For each slice k (not near borders):
- Extract 5-slice stack: [k-2, k-1, k, k+1, k+2]
- Save as 5-channel image
- Save mask for center slice k

This gives 3D context while keeping memory small.
"""

import argparse
import json
from pathlib import Path

import numpy as np


def load_volume(image_path, mask_path):
    """Load 3D volume and mask from .npy files."""
    image = np.load(image_path)
    mask = np.load(mask_path)
    
    if image.shape != mask.shape:
        raise ValueError(f"Shape mismatch: {image.shape} vs {mask.shape}")
    
    return image, mask


def extract_25d_samples(image, mask, patient_id):
    """Extract 5-slice stacks from 3D volume (skip first/last 2 slices)."""
    depth = image.shape[0]
    samples = []
    
    for k in range(2, depth - 2):
        # Stack slices [k-2, k-1, k, k+1, k+2]
        stack = np.stack([image[k-2], image[k-1], image[k], image[k+1], image[k+2]], axis=0)
        target = mask[k:k+1]  # Keep as (1, H, W)
        
        samples.append({
            'stack': stack,
            'target': target,
            'patient_id': patient_id,
            'slice': k,
            'has_nodule': (np.max(target) > 0),
        })
    
    return samples


def save_25d_samples(samples, output_dir, patient_id):
    """Save 2.5D samples as .npz files."""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    for sample in samples:
        k = sample['slice']
        filename = f"{patient_id}_slice_{k:04d}.npz"
        filepath = output_path / filename
        
        np.savez_compressed(
            filepath,
            image=sample['stack'].astype(np.float32),
            mask=sample['target'].astype(np.uint8)
        )
    
    return len(samples)


def process_patient(image_path, mask_path, patient_id, output_dir):
    """Load volume → extract samples → save."""
    print(f"Processing {patient_id}...")
    
    image, mask = load_volume(image_path, mask_path)
    print(f"  Shape: {image.shape}")
    
    samples = extract_25d_samples(image, mask, patient_id)
    print(f"  Extracted {len(samples)} samples")
    
    # Count nodule vs background
    with_nodule = sum(1 for s in samples if s['has_nodule'])
    print(f"    With nodule: {with_nodule}")
    print(f"    Background: {len(samples) - with_nodule}")
    
    num_saved = save_25d_samples(samples, output_dir, patient_id)
    print(f"✓ Saved {num_saved} samples\n")
    
    return num_saved


def find_volume_pairs(input_dir):
    """Find all matching image/mask pairs in directory.
    
    Expects files named: {patient_id}_image.npy and {patient_id}_mask.npy
    """
    input_path = Path(input_dir)
    pairs = []
    
    image_files = sorted(input_path.glob('*_image.npy'))
    print(f"Found {len(image_files)} image files\n")
    
    for image_file in image_files:
        patient_id = image_file.stem.replace('_image', '')
        mask_file = input_path / f'{patient_id}_mask.npy'
        
        if mask_file.exists():
            pairs.append((str(image_file), str(mask_file), patient_id))
        else:
            print(f"Warning: No mask found for {patient_id}")
    
    return pairs


def main():
    """Build 2.5D dataset from 3D volumes."""
    parser = argparse.ArgumentParser(description="Build 2.5D dataset from 3D volumes")
    parser.add_argument('--input', type=str, required=True,
                       help='Directory with 3D volumes (patient_id_image.npy, patient_id_mask.npy)')
    parser.add_argument('--output', type=str, default='data/lidc_25d',
                       help='Output directory for 2.5D samples')
    parser.add_argument('--patient', type=str, default=None,
                       help='Process single patient (optional)')
    
    args = parser.parse_args()
    
    input_dir = Path(args.input)
    if not input_dir.exists():
        print(f"Error: Input directory not found: {input_dir}")
        return 1
    
    print("="*60)
    print("2.5D Dataset Builder")
    print("="*60 + "\n")
    
    if args.patient:
        # Process single patient
        image_path = input_dir / f'{args.patient}_image.npy'
        mask_path = input_dir / f'{args.patient}_mask.npy'
        
        if not image_path.exists() or not mask_path.exists():
            print(f"Error: Patient files not found")
            return 1
        
        process_patient(str(image_path), str(mask_path), args.patient, args.output)
        
    else:
        # Process all patients
        pairs = find_volume_pairs(args.input)
        
        if not pairs:
            print("Error: No volume pairs found!")
            return 1
        
        print(f"Processing {len(pairs)} patients...\n")
        
        total_samples = 0
        for image_path, mask_path, patient_id in pairs:
            num = process_patient(image_path, mask_path, patient_id, args.output)
            total_samples += num
        
        print("="*60)
        print(f"✓ Done! Created {total_samples} total samples")
        print("="*60)
    
    return 0


if __name__ == "__main__":
    exit(main())
