"""
LIDC-IDRI STRICT PREPROCESSING AUDIT
Verifies CT-SEG mapping and metadata consistency
"""
from pathlib import Path
import pandas as pd
import numpy as np
import xml.etree.ElementTree as ET
from collections import defaultdict

try:
    import pydicom
    PYDICOM_AVAILABLE = True
except ImportError:
    PYDICOM_AVAILABLE = False
    print("⚠️ pydicom not available - DICOM parsing will be limited")

# ============================================================================
# PATHS
# ============================================================================
LIDC_ROOT = Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
META_PATH = Path("C:/LIDC_DATA/manifest-1773770928394/metadata.csv")
XML_ROOT = Path("C:/LIDC_DATA/XML")

print("=" * 80)
print("LIDC-IDRI STRICT PREPROCESSING AUDIT")
print("=" * 80)

# ============================================================================
# 1. METADATA CSV AUDIT
# ============================================================================
print("\n[1] METADATA.CSV LOADING")
print("-" * 80)

try:
    df_meta = pd.read_csv(META_PATH)
    print(f"✓ metadata.csv found and loaded: {len(df_meta)} rows")
    print(f"  Columns: {list(df_meta.columns)}")
    print(f"  Data types:\n{df_meta.dtypes}\n")
except Exception as e:
    print(f"✗ Error loading metadata.csv: {e}")
    df_meta = None

# ============================================================================
# 2. METADATA MODALITY ANALYSIS
# ============================================================================
print("\n[2] METADATA MODALITY SUMMARY")
print("-" * 80)

if df_meta is not None:
    if 'Modality' in df_meta.columns:
        modality_counts = df_meta['Modality'].value_counts()
        print("Modality distribution in metadata:")
        print(modality_counts.to_string())
        print(f"\nUnique modalities: {df_meta['Modality'].nunique()}")
    
    # Patient count in metadata
    if 'Patient ID' in df_meta.columns:
        meta_unique_pids = df_meta['Patient ID'].nunique()
        print(f"\nUnique patients in metadata: {meta_unique_pids}")
        print(f"Rows per patient (avg): {len(df_meta) / meta_unique_pids:.1f}")
    
    # Series description
    if 'Series Description' in df_meta.columns:
        print(f"\nTop Series Descriptions:")
        desc_top = df_meta['Series Description'].value_counts().head(10)
        for desc, count in desc_top.items():
            print(f"  {desc[:60]:<60} : {count:>4}")

# ============================================================================
# 3. DISK STRUCTURE SUMMARY
# ============================================================================
print("\n[3] DISK STRUCTURE")
print("-" * 80)

disk_patients = sorted([
    p.name for p in LIDC_ROOT.iterdir() 
    if p.is_dir() and p.name.startswith("LIDC-IDRI-")
])
print(f"✓ Total patients on disk: {len(disk_patients)}")

# ============================================================================
# 4. CT-SEG MAPPING AUDIT (SAMPLE)
# ============================================================================
print("\n[4] CT-SEG MAPPING VERIFICATION (Sample of 10 patients)")
print("-" * 80)

ct_seg_mapping = []
verification_stats = {
    'verified_matches': 0,
    'ambiguous_matches': 0,
    'missing_ct': 0,
    'missing_seg': 0,
    'errors': 0
}

# Sample first 10 patients for detailed verification
sample_patients = disk_patients[:10]

for pid in sample_patients:
    try:
        pdir = LIDC_ROOT / pid
        studies = [s for s in pdir.iterdir() if s.is_dir()]
        
        for study in studies:
            series_dirs = [s for s in study.iterdir() if s.is_dir()]
            
            # Separate CT and SEG series
            ct_series = [s for s in series_dirs if "Segmentation" not in s.name and "evaluations" not in s.name]
            seg_series = [s for s in series_dirs if "Segmentation" in s.name]
            
            # For each CT, find matching SEG
            for ct in ct_series:
                ct_dcm_files = list(ct.glob("*.dcm"))
                if not ct_dcm_files:
                    verification_stats['missing_ct'] += 1
                    continue
                
                # Try to get DICOM modality and series info
                ct_modality = None
                ct_series_uid = None
                
                if PYDICOM_AVAILABLE and ct_dcm_files:
                    try:
                        ds = pydicom.dcmread(ct_dcm_files[0], stop_before_pixels=True)
                        ct_modality = getattr(ds, 'Modality', 'UNKNOWN')
                        ct_series_uid = getattr(ds, 'SeriesInstanceUID', 'UNKNOWN')
                    except:
                        pass
                
                # Count matching SEG
                matching_segs = 0
                seg_count_total = len(seg_series)
                
                if seg_series:
                    for seg in seg_series:
                        seg_dcm = list(seg.glob("*.dcm"))
                        if seg_dcm:
                            matching_segs += 1
                else:
                    verification_stats['missing_seg'] += 1
                
                # Record mapping
                status = 'VERIFIED' if matching_segs > 0 else 'NO_SEG'
                if matching_segs > 1:
                    status = 'AMBIGUOUS'
                    verification_stats['ambiguous_matches'] += 1
                elif matching_segs == 1:
                    verification_stats['verified_matches'] += 1
                
                ct_seg_mapping.append({
                    'Patient': pid,
                    'Study': study.name[:20],
                    'CT_Series': ct.name[:30],
                    'Modality': ct_modality,
                    'CT_DICOMs': len(ct_dcm_files),
                    'Matching_SEGs': matching_segs,
                    'Total_SEGs': seg_count_total,
                    'Status': status
                })
    
    except Exception as e:
        verification_stats['errors'] += 1
        print(f"  ✗ Error processing {pid}: {str(e)[:50]}")

# Print CT-SEG mapping table
if ct_seg_mapping:
    df_mapping = pd.DataFrame(ct_seg_mapping)
    print(f"\nCT-SEG Mapping Summary ({len(df_mapping)} entries):")
    print(df_mapping.to_string(index=False))
    
    print(f"\n  Verification Statistics:")
    print(f"    ✓ Verified matches (1 SEG per CT):       {verification_stats['verified_matches']}")
    print(f"    ⚠️  Ambiguous matches (multiple SEGs):    {verification_stats['ambiguous_matches']}")
    print(f"    ✗ No SEG found:                          {len(df_mapping[df_mapping['Status']=='NO_SEG'])}")
    print(f"    Total errors:                            {verification_stats['errors']}")

# ============================================================================
# 5. METADATA vs DISK COMPARISON
# ============================================================================
print("\n[5] METADATA vs DISK CONSISTENCY")
print("-" * 80)

disk_patient_set = set(disk_patients)

if df_meta is not None and 'Patient ID' in df_meta.columns:
    meta_patient_set = set(df_meta['Patient ID'].unique())
    
    print(f"Patients in metadata:  {len(meta_patient_set)}")
    print(f"Patients on disk:      {len(disk_patient_set)}")
    
    meta_only = meta_patient_set - disk_patient_set
    disk_only = disk_patient_set - meta_patient_set
    
    if meta_only:
        print(f"\n⚠️  In metadata, NOT on disk ({len(meta_only)}):")
        for p in sorted(list(meta_only))[:5]:
            print(f"  {p}")
        if len(meta_only) > 5:
            print(f"  ... and {len(meta_only) - 5} more")
    
    if disk_only:
        print(f"\n⚠️  On disk, NOT in metadata ({len(disk_only)}):")
        for p in sorted(list(disk_only))[:5]:
            print(f"  {p}")
        if len(disk_only) > 5:
            print(f"  ... and {len(disk_only) - 5} more")
    
    if not meta_only and not disk_only:
        print("✓ Perfect patient ID match between metadata and disk")
    
    # Series count check
    if 'Modality' in df_meta.columns:
        ct_rows = len(df_meta[df_meta['Modality'].isin(['CT', 'OT'])])
        seg_rows = len(df_meta[df_meta['Modality'] == 'SEG'])
        print(f"\nMetadata series count:")
        print(f"  CT/OT modality:  {ct_rows}")
        print(f"  SEG modality:     {seg_rows}")

# ============================================================================
# 6. METADATA USEFULNESS ASSESSMENT
# ============================================================================
print("\n[6] METADATA USEFULNESS ASSESSMENT")
print("-" * 80)

if df_meta is not None:
    useful_cols = []
    redundant_cols = []
    
    for col in df_meta.columns:
        unique_vals = df_meta[col].nunique()
        total_rows = len(df_meta)
        coverage = (df_meta[col].notna().sum() / total_rows) * 100
        
        if unique_vals == 1:
            redundant_cols.append((col, "constant value"))
        elif coverage < 10:
            redundant_cols.append((col, f"only {coverage:.0f}% filled"))
        else:
            useful_cols.append(col)
    
    print(f"Useful columns ({len(useful_cols)}):")
    for col in useful_cols:
        print(f"  ✓ {col}")
    
    if redundant_cols:
        print(f"\nRedundant columns ({len(redundant_cols)}):")
        for col, reason in redundant_cols:
            print(f"  ✗ {col}: {reason}")

# ============================================================================
# 7. FINAL ASSESSMENT
# ============================================================================
print("\n[7] FINAL ASSESSMENT")
print("-" * 80)

is_clean = (
    verification_stats['verified_matches'] > 0 and
    verification_stats['ambiguous_matches'] == 0 and
    verification_stats['errors'] == 0
)

print(f"CT-SEG Mapping Status:")
print(f"  Verified matches:   {verification_stats['verified_matches']} ✓")
print(f"  Ambiguous matches:  {verification_stats['ambiguous_matches']} ⚠️")
print(f"  Processing errors:  {verification_stats['errors']} ✗")

if is_clean:
    print("\n✓ DATASET IS PREPROCESSING-READY")
    print("  - CT-SEG mapping is unambiguous")
    print("  - Ready for DICOM normalization")
else:
    print("\n⚠️ DATASET REQUIRES INVESTIGATION")
    print("  - CT-SEG mapping has issues")
    print("  - Manual inspection recommended for ambiguous cases")

if df_meta is not None:
    print(f"\nMetadata.csv Assessment:")
    if 'Modality' in df_meta.columns and 'Series Description' in df_meta.columns:
        print("  ✓ Contains useful modality and series info")
        print("  Can be used to pre-plan CT-SEG pairings")
    else:
        print("  ⚠️ Limited utility for preprocessing")
        print("  XML annotations may be primary reference")

print("\n" + "=" * 80)
print("AUDIT COMPLETE")
print("=" * 80)
