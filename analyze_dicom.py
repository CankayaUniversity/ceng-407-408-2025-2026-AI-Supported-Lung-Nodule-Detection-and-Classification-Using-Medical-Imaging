#!/usr/bin/env python3
"""Analyze DICOM structure for proper CT-SEG mapping."""

import pydicom
import glob
import os
import sys

seg_dir = 'backend/uploads/STD-1767130127304'
if os.path.exists(seg_dir):
    dcm_files = sorted(glob.glob(os.path.join(seg_dir, '*.dcm')))
    print(f'✓ Found {len(dcm_files)} DICOM files\n')
    
    # Check first and last file
    for fname in [dcm_files[0], dcm_files[-1]]:
        try:
            ds = pydicom.dcmread(fname, stop_before_pixels=True)
            print(f"File: {os.path.basename(fname)}")
            print(f"  Modality: {ds.get('Modality', 'N/A')}")
            print(f"  SeriesInstanceUID: {str(ds.get('SeriesInstanceUID', 'N/A'))[:40]}")
            print(f"  SOPClassUID: {str(ds.get('SOPClassUID', 'N/A'))[:40]}")
            
            # Check for ReferencedImageSequence (SEG references CT)
            if 'ReferencedImageSequence' in ds:
                print(f"  ReferencedImageSequence: YES (segmentation references CT)")
                for ref in ds.ReferencedImageSequence:
                    print(f"    -> Referenced SeriesInstanceUID: {str(ref.get('SeriesInstanceUID', 'N/A'))[:40]}")
            else:
                print(f"  ReferencedImageSequence: NO")
            
            # Check ImagePositionPatient
            if 'ImagePositionPatient' in ds:
                pos = ds.ImagePositionPatient
                print(f"  ImagePositionPatient (z-coord): {float(pos[2]):.2f} mm")
            
            # For SEG: check frame references
            if 'ReferencedImageSequence' in ds:
                print(f"\n  ➜ This is a SEGMENTATION file (references CT)")
                if 'SourceImageSequence' in ds:
                    print(f"  SourceImageSequence items: {len(ds.SourceImageSequence)}")
        except Exception as e:
            print(f"Error reading {os.path.basename(fname)}: {e}")
        print()
else:
    print(f"✗ Directory not found: {seg_dir}")
