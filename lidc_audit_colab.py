"""
LIDC-IDRI Dataset Audit Script for Google Colab
Inspects dataset structure, metadata, and finds anomalies
"""
from pathlib import Path
import pandas as pd
import numpy as np
from collections import defaultdict

# ============================================================================
# PATHS (Google Colab or Local)
# ============================================================================
# For local testing, use C:\LIDC_DATA
# For Colab, use /content/drive/MyDrive/LIDC_DATA paths
LIDC_ROOT = Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
XML_ROOT = Path("C:/LIDC_DATA/XML")
META_PATH = LIDC_ROOT / "metadata.csv"

print("=" * 70)
print("LIDC-IDRI DATASET AUDIT")
print("=" * 70)

# ============================================================================
# 1. DISK STRUCTURE INSPECTION
# ============================================================================
print("\n[1] DISK STRUCTURE")
print("-" * 70)

# Get all patient folders
try:
    disk_patients = sorted([
        p.name for p in LIDC_ROOT.iterdir() 
        if p.is_dir() and p.name.startswith("LIDC-IDRI-")
    ])
    print(f"✓ Total patients on disk: {len(disk_patients)}")
    print(f"  First patient: {disk_patients[0]}")
    print(f"  Last patient: {disk_patients[-1]}")
except Exception as e:
    print(f"✗ Error reading disk: {e}")
    disk_patients = []

# ============================================================================
# 2. PATIENT-LEVEL AUDIT
# ============================================================================
print("\n[2] PATIENT-LEVEL STRUCTURE")
print("-" * 70)

patient_audit = []
anomalies = []

for pid in disk_patients[:len(disk_patients)]:  # All patients
    try:
        pdir = LIDC_ROOT / pid
        
        # Get studies
        studies = [s for s in pdir.iterdir() if s.is_dir()]
        num_studies = len(studies)
        
        if num_studies == 0:
            anomalies.append(f"🔴 {pid}: No study folders found")
            continue
        
        # Count series per study
        for study_idx, study in enumerate(studies):
            series_list = [s for s in study.iterdir() if s.is_dir()]
            num_series = len(series_list)
            
            if num_series == 0:
                anomalies.append(f"🔴 {pid} > {study.name}: No series found")
                continue
            
            # Series name summary
            series_names = [s.name for s in series_list]
            ct_count = sum(1 for s in series_names if "Segmentation" not in s and "evaluations" not in s)
            seg_count = sum(1 for s in series_names if "Segmentation" in s)
            
            patient_audit.append({
                'Patient': pid,
                'Study': study_idx + 1,
                'StudyName': study.name[:30],
                'NumSeries': num_series,
                'CT': ct_count,
                'SEG': seg_count,
                'Evals': num_series - ct_count - seg_count
            })
    
    except Exception as e:
        anomalies.append(f"🔴 {pid}: {str(e)[:50]}")

# Print patient summary (compact)
if patient_audit:
    df_audit = pd.DataFrame(patient_audit)
    print(f"Total patient-study entries: {len(df_audit)}")
    print("\nSample entries (first 10):")
    print(df_audit.head(10).to_string(index=False))
    
    # Summary statistics
    print("\nSeries distribution:")
    print(f"  Mean series per entry: {df_audit['NumSeries'].mean():.1f}")
    print(f"  Median CT series: {df_audit['CT'].median():.0f}")
    print(f"  Median SEG series: {df_audit['SEG'].median():.0f}")

# ============================================================================
# 3. METADATA.CSV INSPECTION
# ============================================================================
print("\n[3] METADATA.CSV ANALYSIS")
print("-" * 70)

meta_patients = set()
try:
    if META_PATH.exists():
        df_meta = pd.read_csv(META_PATH)
        print(f"✓ metadata.csv loaded: {len(df_meta)} rows")
        print(f"  Columns: {list(df_meta.columns)}")
        
        meta_patients = set(df_meta['Patient ID'].unique()) if 'Patient ID' in df_meta.columns else set()
        print(f"\n  Unique patients in metadata: {len(meta_patients)}")
        
        # Modality distribution
        if 'Modality' in df_meta.columns:
            print("\n  Modality distribution:")
            print(df_meta['Modality'].value_counts().to_string())
        
        # Series Description
        if 'Series Description' in df_meta.columns:
            desc_counts = df_meta['Series Description'].value_counts()
            print(f"\n  Top 10 Series Descriptions:")
            for desc, count in desc_counts.head(10).items():
                print(f"    {desc[:50]:<50} : {count:>4}")
    else:
        print(f"✗ metadata.csv not found at {META_PATH}")
        df_meta = None
except Exception as e:
    print(f"✗ Error loading metadata: {e}")
    df_meta = None

# ============================================================================
# 4. METADATA vs DISK COMPARISON
# ============================================================================
print("\n[4] METADATA vs DISK COMPARISON")
print("-" * 70)

disk_patient_set = set(disk_patients)
print(f"Patients on disk:     {len(disk_patient_set)}")
print(f"Patients in metadata: {len(meta_patients)}")

if meta_patients and disk_patient_set:
    in_meta_not_disk = meta_patients - disk_patient_set
    in_disk_not_meta = disk_patient_set - meta_patients
    
    if in_meta_not_disk:
        print(f"\n  ⚠️  In metadata but NOT on disk ({len(in_meta_not_disk)}):")
        for p in sorted(list(in_meta_not_disk))[:5]:
            print(f"    {p}")
        if len(in_meta_not_disk) > 5:
            print(f"    ... and {len(in_meta_not_disk) - 5} more")
    
    if in_disk_not_meta:
        print(f"\n  ⚠️  On disk but NOT in metadata ({len(in_disk_not_meta)}):")
        for p in sorted(list(in_disk_not_meta))[:5]:
            print(f"    {p}")
        if len(in_disk_not_meta) > 5:
            print(f"    ... and {len(in_disk_not_meta) - 5} more")
    
    if not in_meta_not_disk and not in_disk_not_meta:
        print("  ✓ Perfect match between metadata and disk!")

# ============================================================================
# 5. ANOMALIES SUMMARY
# ============================================================================
print("\n[5] ANOMALIES")
print("-" * 70)

if anomalies:
    print(f"Found {len(anomalies)} issues:")
    for anomaly in anomalies[:10]:
        print(f"  {anomaly}")
    if len(anomalies) > 10:
        print(f"  ... and {len(anomalies) - 10} more")
else:
    print("✓ No anomalies detected")

# ============================================================================
# 6. XML FILES CHECK
# ============================================================================
print("\n[6] XML ANNOTATIONS")
print("-" * 70)

try:
    if XML_ROOT.exists():
        xml_files = list(XML_ROOT.glob("**/*.xml"))
        print(f"✓ Total XML files: {len(xml_files)}")
        if xml_files:
            print("  Sample files:")
            for xf in sorted(xml_files)[:5]:
                print(f"    {xf.name}")
    else:
        print(f"✗ XML folder not found at {XML_ROOT}")
except Exception as e:
    print(f"✗ Error reading XML: {e}")

# ============================================================================
# 7. FINAL SUMMARY TABLE
# ============================================================================
print("\n[7] SUMMARY TABLE")
print("-" * 70)

summary_data = {
    'Metric': [
        'Total Patients (disk)',
        'Total Patients (metadata)',
        'Metadata rows',
        'Anomalies found',
        'Match status'
    ],
    'Value': [
        len(disk_patient_set),
        len(meta_patients),
        len(df_meta) if df_meta is not None else 'N/A',
        len(anomalies),
        '✓ MATCH' if (len(disk_patient_set) == len(meta_patients) and not anomalies) else '⚠️ MISMATCH'
    ]
}

df_summary = pd.DataFrame(summary_data)
print(df_summary.to_string(index=False))

print("\n" + "=" * 70)
print("AUDIT COMPLETE")
print("=" * 70)
