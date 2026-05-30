"""
TASK 1: SEG STRUCTURE AUDIT
Inspects actual DICOM content of SEG files to understand their structure
"""

from pathlib import Path
import pandas as pd
import numpy as np
import pydicom
from pydicom.errors import InvalidDicomError

# ============================================================================
# LOAD MAPPING CSV
# ============================================================================
csv_path = Path("ct_seg_mappings.csv")
if not csv_path.exists():
    print("ERROR: ct_seg_mappings.csv not found. Run mapping audit first.")
    exit(1)

df_mappings = pd.read_csv(csv_path)

print("=" * 100)
print("LIDC-IDRI SEG STRUCTURE AUDIT")
print("=" * 100)

# ============================================================================
# FIX: Calculate correct statistics
# ============================================================================
print("\n[1] CORRECTED SUMMARY STATISTICS")
print("-" * 100)

unique_cts = df_mappings['ct_series_uid'].nunique()
unique_segs = df_mappings['seg_series_uid'].nunique()
total_mapping_records = len(df_mappings)

# Group by CT to count SEGs per CT
cts_by_ct = df_mappings.groupby('ct_series_uid')['seg_series_uid'].count()
avg_segs_per_ct = cts_by_ct.mean()

print(f"\nCorrected Statistics:")
print(f"  Total mapping records:     {total_mapping_records}")
print(f"  Unique CT series:          {unique_cts}")
print(f"  Unique SEG series:         {unique_segs}")
print(f"  Average SEG per CT:        {avg_segs_per_ct:.2f}")
print(f"  Min SEG per CT:            {cts_by_ct.min()}")
print(f"  Max SEG per CT:            {cts_by_ct.max()}")

# ============================================================================
# TASK 1: INSPECT SEG DICOM STRUCTURE
# ============================================================================
print("\n[2] SEG STRUCTURE INSPECTION (Sample)")
print("-" * 100)

LIDC_ROOT = Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
seg_audit = []

# Sample 15 SEG series for inspection
sample_indices = np.linspace(0, len(df_mappings)-1, min(15, len(df_mappings)), dtype=int)

for idx in sample_indices:
    row = df_mappings.iloc[idx]
    patient_id = row['patient_id']
    seg_folder_name = row['seg_folder']
    
    try:
        # Find the SEG folder on disk
        patient_dir = LIDC_ROOT / patient_id
        
        # Find matching SEG folder
        seg_folders = list(patient_dir.rglob("*"))
        seg_dir = None
        for f in seg_folders:
            if f.name.startswith(seg_folder_name[:20]) and f.is_dir():
                seg_dir = f
                break
        
        if seg_dir is None:
            continue
        
        seg_dcm_files = list(seg_dir.glob("*.dcm"))
        if not seg_dcm_files:
            continue
        
        # Read SEG DICOM
        seg_file = seg_dcm_files[0]
        ds = pydicom.dcmread(str(seg_file), force=True)
        
        # Extract info
        modality = getattr(ds, 'Modality', 'N/A')
        seg_uid = getattr(ds, 'SeriesInstanceUID', 'N/A')
        series_desc = getattr(ds, 'SeriesDescription', 'N/A')
        num_frames = getattr(ds, 'NumberOfFrames', 1)
        
        # If SEG has pixel data
        rows = None
        cols = None
        unique_vals = None
        nonzero_count = None
        positive_frames = 0
        
        if hasattr(ds, 'pixel_array'):
            try:
                pix = ds.pixel_array
                if pix.ndim == 3:
                    rows, cols = pix.shape[1:]
                    num_frames = pix.shape[0]
                    unique_vals = np.unique(pix).tolist()
                    nonzero_count = int(np.sum(pix > 0))
                    positive_frames = int(np.sum(np.any(pix > 0, axis=(1,2))))
                elif pix.ndim == 2:
                    rows, cols = pix.shape
                    unique_vals = np.unique(pix).tolist()
                    nonzero_count = int(np.sum(pix > 0))
                    positive_frames = 1 if nonzero_count > 0 else 0
            except:
                pass
        
        # Referenced source images
        refs = "N/A"
        if hasattr(ds, 'ReferencedSeriesSequence') and len(ds.ReferencedSeriesSequence) > 0:
            refs = f"{len(ds.ReferencedSeriesSequence)} series refs"
        if hasattr(ds, 'ReferencedImageSequence') and len(ds.ReferencedImageSequence) > 0:
            refs = f"{len(ds.ReferencedImageSequence)} image refs"
        
        # Segment info
        segments = "N/A"
        if hasattr(ds, 'SegmentSequence') and len(ds.SegmentSequence) > 0:
            seg_list = []
            for seg in ds.SegmentSequence:
                seg_num = getattr(seg, 'SegmentNumber', '?')
                seg_label = getattr(seg, 'SegmentLabel', '?')
                seg_list.append(f"Seg{seg_num}:{seg_label}")
            segments = " | ".join(seg_list)
        
        # Infer type
        inferred_type = "UNKNOWN"
        if "Nodule" in str(series_desc) and "Annotation" in str(series_desc):
            inferred_type = "Single Nodule Annotation"
        elif "Segmentation" in str(series_desc):
            inferred_type = "Segmentation Mask"
        
        seg_audit.append({
            'patient_id': patient_id,
            'ct_uid': str(row['ct_series_uid'])[:20],
            'seg_uid': str(row['seg_series_uid'])[:20],
            'series_desc': str(series_desc)[:40],
            'num_frames': num_frames,
            'rows': rows,
            'cols': cols,
            'unique_vals': unique_vals,
            'nonzero_px': nonzero_count,
            'positive_frames': positive_frames,
            'segment_info': segments,
            'referenced': refs,
            'inferred_type': inferred_type
        })
    
    except Exception as e:
        seg_audit.append({
            'patient_id': patient_id,
            'error': str(e)[:50]
        })

# Display results
if seg_audit:
    df_seg = pd.DataFrame(seg_audit)
    print(f"\nSample SEG Structure ({len(df_seg)} entries):\n")
    
    # Display key columns
    cols_to_show = ['patient_id', 'num_frames', 'rows', 'cols', 'nonzero_px', 'positive_frames', 'inferred_type']
    available_cols = [c for c in cols_to_show if c in df_seg.columns]
    
    print(df_seg[available_cols].to_string(index=False))
    
    print("\n\nDetailed Segment Information:")
    for _, row in df_seg.head(5).iterrows():
        if 'error' not in row or pd.isna(row.get('error')):
            print(f"\n  {row['patient_id']}:")
            print(f"    Description:      {row.get('series_desc', 'N/A')}")
            print(f"    Frames:            {row.get('num_frames', 'N/A')}")
            print(f"    Dimensions:        {row.get('rows', 'N/A')}×{row.get('cols', 'N/A')}")
            print(f"    Nonzero pixels:    {row.get('nonzero_px', 'N/A')}")
            print(f"    Positive frames:   {row.get('positive_frames', 'N/A')}")
            print(f"    Inferred type:     {row.get('inferred_type', 'N/A')}")
            print(f"    Segment info:      {row.get('segment_info', 'N/A')}")

# ============================================================================
# PATTERN ANALYSIS
# ============================================================================
print("\n[3] PATTERN ANALYSIS")
print("-" * 100)

if 'inferred_type' in df_seg.columns:
    type_dist = df_seg['inferred_type'].value_counts()
    print("\nInferred SEG Types:")
    for t, count in type_dist.items():
        print(f"  {t}: {count}")

if 'positive_frames' in df_seg.columns and not df_seg['positive_frames'].isna().all():
    print(f"\nPositive Frame Statistics:")
    print(f"  Mean positive frames per SEG:  {df_seg['positive_frames'].mean():.1f}")
    print(f"  Median positive frames:        {df_seg['positive_frames'].median():.0f}")
    print(f"  Max positive frames:           {df_seg['positive_frames'].max()}")

print("\n" + "=" * 100)
print("SEG STRUCTURE AUDIT COMPLETE")
print("=" * 100)
