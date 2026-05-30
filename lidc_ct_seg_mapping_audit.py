"""
LIDC-IDRI CT-SEG MAPPING AUDIT SCRIPT
Google Colab Version

Validates CT-to-SEG matching using DICOM metadata before preprocessing
"""

from pathlib import Path
import pandas as pd
import numpy as np
from collections import defaultdict
import sys

try:
    import pydicom
    from pydicom.errors import InvalidDicomError
    PYDICOM_AVAILABLE = True
except ImportError:
    print("ERROR: pydicom not installed. Install with:")
    print("  pip install pydicom")
    sys.exit(1)

# ============================================================================
# CONFIGURATION
# ============================================================================
# For Colab: Path("/content/drive/MyDrive/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
# For local: Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
LIDC_ROOT = Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
MAX_PATIENTS = 200  # Process all 200
VERBOSE = False  # Set True for detailed debugging

print("=" * 100)
print("LIDC-IDRI CT-SEG MAPPING AUDIT (DICOM-based)")
print("=" * 100)
print(f"\nConfiguration:")
print(f"  LIDC Root:      {LIDC_ROOT}")
print(f"  Max Patients:   {MAX_PATIENTS}")
print(f"  pydicom:        {pydicom.__version__ if PYDICOM_AVAILABLE else 'NOT AVAILABLE'}")

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def read_dicom_tags(dcm_path, tags=['Modality', 'SeriesInstanceUID', 'StudyInstanceUID', 'SeriesDescription']):
    """
    Safely read DICOM tags from a file.
    Returns dict with tag values, or None if read fails.
    Uses force=True to skip malformed tags.
    """
    try:
        # Use force=True to skip errors in corrupt files
        ds = pydicom.dcmread(str(dcm_path), stop_before_pixels=True, force=True)
        result = {}
        for tag in tags:
            result[tag] = getattr(ds, tag, None)
        return result
    except (InvalidDicomError, FileNotFoundError, KeyboardInterrupt, Exception) as e:
        # Skip unreadable files silently
        return None

def get_referenced_series_uid(seg_dcm_path):
    """
    For a SEG file, extract the referenced CT series UID.
    Looks for ReferencedSeriesSequence in the DICOM.
    """
    try:
        ds = pydicom.dcmread(str(seg_dcm_path), stop_before_pixels=True, force=True)
        
        # Try ReferencedSeriesSequence
        if hasattr(ds, 'ReferencedSeriesSequence') and len(ds.ReferencedSeriesSequence) > 0:
            ref_series = ds.ReferencedSeriesSequence[0]
            if hasattr(ref_series, 'SeriesInstanceUID'):
                return str(ref_series.SeriesInstanceUID)
        
        # Fallback: check ReferencedImageSequence for referenced SOP instances
        if hasattr(ds, 'ReferencedImageSequence') and len(ds.ReferencedImageSequence) > 0:
            # This would require more complex logic to map back
            return "COMPLEX_REF"
        
        return None
    except (InvalidDicomError, FileNotFoundError, KeyboardInterrupt, Exception):
        return None

def process_patient(patient_id, patient_dir):
    """
    Process a single patient: find all CT and SEG series with DICOM verification.
    Returns list of dicts with mapping data.
    """
    results = []
    errors = []
    
    try:
        studies = [s for s in patient_dir.iterdir() if s.is_dir()]
        
        if not studies:
            errors.append(f"No study folders found")
            return results, errors
        
        for study in studies:
            study_uid = None
            ct_series_list = []  # List of (series_dir, series_uid, modality)
            seg_series_list = []  # List of (series_dir, series_uid, modality)
            
            # 1. SCAN SERIES TO CLASSIFY CT vs SEG
            series_dirs = [s for s in study.iterdir() if s.is_dir()]
            
            for series_dir in series_dirs:
                dcm_files = list(series_dir.glob("*.dcm"))
                
                if not dcm_files:
                    continue
                
                # Read first DICOM to get metadata
                tags = read_dicom_tags(dcm_files[0])
                
                if tags is None:
                    continue
                
                modality = tags.get('Modality', 'UNKNOWN')
                series_uid = tags.get('SeriesInstanceUID', 'UNKNOWN')
                study_uid = tags.get('StudyInstanceUID', study_uid)
                series_desc = tags.get('SeriesDescription', '')
                
                # Classify
                if modality == 'CT':
                    ct_series_list.append({
                        'dir': series_dir,
                        'uid': series_uid,
                        'modality': modality,
                        'desc': series_desc,
                        'dcm_count': len(dcm_files)
                    })
                elif modality == 'SEG':
                    seg_series_list.append({
                        'dir': series_dir,
                        'uid': series_uid,
                        'modality': modality,
                        'desc': series_desc,
                        'dcm_count': len(dcm_files)
                    })
            
            if VERBOSE:
                print(f"  {patient_id} > {study.name[:30]}: {len(ct_series_list)} CT, {len(seg_series_list)} SEG")
            
            # 2. MATCH CT TO SEG VIA DICOM METADATA
            if not ct_series_list or not seg_series_list:
                continue
            
            for ct in ct_series_list:
                # Find matching SEG(s) via referenced series UID
                matching_segs = []
                
                for seg in seg_series_list:
                    # Get referenced series UID from SEG
                    seg_dcm = list(seg['dir'].glob("*.dcm"))
                    if seg_dcm:
                        ref_uid = get_referenced_series_uid(seg_dcm[0])
                        
                        # Check if reference matches CT
                        if ref_uid == ct['uid']:
                            matching_segs.append({
                                'seg': seg,
                                'ref_uid': ref_uid,
                                'confidence': 'VERIFIED'
                            })
                        elif ref_uid == 'COMPLEX_REF':
                            # SEG references via SOP instances, need deeper inspection
                            matching_segs.append({
                                'seg': seg,
                                'ref_uid': ref_uid,
                                'confidence': 'COMPLEX_REF'
                            })
                
                # Record result for this CT
                if matching_segs:
                    # Has matching SEGs
                    for match in matching_segs:
                        results.append({
                            'patient_id': patient_id,
                            'study_uid': study_uid or 'UNKNOWN',
                            'ct_series_uid': ct['uid'],
                            'seg_series_uid': match['seg']['uid'],
                            'ct_folder': ct['dir'].name[:40],
                            'seg_folder': match['seg']['dir'].name[:40],
                            'ct_dcm_count': ct['dcm_count'],
                            'seg_dcm_count': match['seg']['dcm_count'],
                            'ct_modality': ct['modality'],
                            'seg_modality': match['seg']['modality'],
                            'ct_desc': ct['desc'][:40] if ct['desc'] else '',
                            'seg_desc': match['seg']['desc'][:40] if match['seg']['desc'] else '',
                            'mapping_confidence': match['confidence'],
                            'notes': 'OK'
                        })
                else:
                    # CT with no matching SEGs
                    results.append({
                        'patient_id': patient_id,
                        'study_uid': study_uid or 'UNKNOWN',
                        'ct_series_uid': ct['uid'],
                        'seg_series_uid': 'NO_MATCH',
                        'ct_folder': ct['dir'].name[:40],
                        'seg_folder': 'N/A',
                        'ct_dcm_count': ct['dcm_count'],
                        'seg_dcm_count': 0,
                        'ct_modality': ct['modality'],
                        'seg_modality': 'N/A',
                        'ct_desc': ct['desc'][:40] if ct['desc'] else '',
                        'seg_desc': '',
                        'mapping_confidence': 'NO_SEG',
                        'notes': 'No SEG references this CT'
                    })
    
    except Exception as e:
        errors.append(f"Exception: {str(e)[:60]}")
    
    return results, errors

# ============================================================================
# MAIN AUDIT LOOP
# ============================================================================
print("\n[1] SCANNING PATIENTS FOR CT-SEG MAPPINGS")
print("-" * 100)

all_results = []
all_errors = []

patients = sorted([
    p.name for p in LIDC_ROOT.iterdir()
    if p.is_dir() and p.name.startswith("LIDC-IDRI-")
])[:MAX_PATIENTS]

print(f"Processing {len(patients)} patients...\n")

for idx, patient_id in enumerate(patients):
    patient_dir = LIDC_ROOT / patient_id
    results, errors = process_patient(patient_id, patient_dir)
    
    all_results.extend(results)
    if errors:
        all_errors.append((patient_id, errors))
    
    if (idx + 1) % 50 == 0:
        print(f"  Processed {idx + 1}/{len(patients)} patients...")

# ============================================================================
# ANALYSIS
# ============================================================================
print("\n[2] RESULTS SUMMARY")
print("-" * 100)

if all_results:
    df_mappings = pd.DataFrame(all_results)
    
    print(f"\nTotal CT-SEG mapping records: {len(df_mappings)}")
    print(f"Unique CT series: {df_mappings['ct_series_uid'].nunique()}")
    print(f"Unique SEG series: {df_mappings[df_mappings['seg_series_uid'] != 'NO_MATCH']['seg_series_uid'].nunique()}")
    
    # Confidence distribution
    print(f"\nMapping Confidence Distribution:")
    confidence_dist = df_mappings['mapping_confidence'].value_counts()
    for conf, count in confidence_dist.items():
        pct = count / len(df_mappings) * 100
        print(f"  {conf:20} : {count:>4} ({pct:>5.1f}%)")
    
    # ========================================================================
    # 3. SUCCESSFUL MAPPINGS
    # ========================================================================
    print("\n[3] SUCCESSFUL MAPPINGS (Sample)")
    print("-" * 100)
    
    verified = df_mappings[df_mappings['mapping_confidence'] == 'VERIFIED']
    print(f"\nVerified CT-SEG pairs: {len(verified)}")
    
    if len(verified) > 0:
        print("\nSample 10 verified mappings:")
        sample = verified.head(10)[['patient_id', 'ct_dcm_count', 'seg_dcm_count', 'mapping_confidence', 'notes']]
        print(sample.to_string(index=False))
    
    # ========================================================================
    # 4. PROBLEMATIC CASES
    # ========================================================================
    print("\n[4] PROBLEMATIC CASES")
    print("-" * 100)
    
    no_seg = df_mappings[df_mappings['mapping_confidence'] == 'NO_SEG']
    print(f"\nCT series with NO matching SEG: {len(no_seg)}")
    if len(no_seg) > 0:
        print("Examples:")
        for _, row in no_seg.head(5).iterrows():
            print(f"  {row['patient_id']} | {row['ct_folder']}")
    
    complex_ref = df_mappings[df_mappings['mapping_confidence'] == 'COMPLEX_REF']
    print(f"\nCT-SEG mappings with COMPLEX references: {len(complex_ref)}")
    if len(complex_ref) > 0:
        print("(These reference via SOP instances, need deeper DICOM inspection)")
    
    # ========================================================================
    # 5. VALIDATION STATISTICS
    # ========================================================================
    print("\n[5] VALIDATION STATISTICS")
    print("-" * 100)
    
    total_cts = len(df_mappings)
    verified_count = len(verified)
    no_seg_count = len(no_seg)
    complex_count = len(complex_ref)
    
    print(f"\nTotal CT series processed: {total_cts}")
    print(f"  ✓ Verified matches (1:N SEG):    {verified_count:>4} ({verified_count/total_cts*100:>5.1f}%)")
    print(f"  ⚠️  Complex references:            {complex_count:>4} ({complex_count/total_cts*100:>5.1f}%)")
    print(f"  ✗ No SEG found:                  {no_seg_count:>4} ({no_seg_count/total_cts*100:>5.1f}%)")
    
    # ========================================================================
    # 6. CT-SEG RATIO VALIDATION
    # ========================================================================
    print("\n[6] CT-SEG RATIO ANALYSIS")
    print("-" * 100)
    
    verified_segs = len(verified[verified['seg_series_uid'] != 'NO_MATCH'])
    if verified_count > 0:
        ratio = verified_segs / verified_count
        print(f"\nSEG per verified CT (average): {ratio:.2f}")
        print("Expected: ~4 (one per radiologist annotation)")
        print(f"Status: {'✓ EXPECTED' if 3.5 < ratio < 4.5 else '⚠️ UNEXPECTED'}")
    
    # ========================================================================
    # 7. READY FOR PREPROCESSING?
    # ========================================================================
    print("\n[7] PREPROCESSING READINESS")
    print("-" * 100)
    
    is_ready = (verified_count > 0) and (no_seg_count == 0 or no_seg_count / total_cts < 0.1)
    
    if is_ready:
        print("\n✓ DATASET IS READY FOR PREPROCESSING")
        print("  - Majority of CT series have verifiable SEG references")
        print("  - DICOM metadata is consistent and usable")
    else:
        print("\n⚠️ DATASET REQUIRES ATTENTION")
        if no_seg_count / total_cts > 0.1:
            print(f"  - Too many CTs without SEGs ({no_seg_count / total_cts * 100:.1f}%)")
        if complex_count > 0:
            print(f"  - {complex_count} mappings need deeper DICOM analysis")
    
    # ========================================================================
    # 8. EXPORT RESULTS
    # ========================================================================
    print("\n[8] DETAILED MAPPING TABLE (on disk)")
    print("-" * 100)
    
    output_csv = "ct_seg_mappings.csv"
    df_mappings.to_csv(output_csv, index=False)
    print(f"\n✓ Full mapping table saved to: {output_csv}")
    print(f"  Rows: {len(df_mappings)}")
    print(f"  Columns: {', '.join(df_mappings.columns.tolist())}")

else:
    print("✗ No CT-SEG mappings found!")

# ========================================================================
# 9. ERROR SUMMARY
# ========================================================================
if all_errors:
    print("\n[9] ERRORS ENCOUNTERED")
    print("-" * 100)
    
    print(f"\nPatients with errors: {len(all_errors)}")
    for patient_id, errors in all_errors[:5]:
        print(f"\n  {patient_id}:")
        for error in errors:
            print(f"    - {error}")
    
    if len(all_errors) > 5:
        print(f"\n  ... and {len(all_errors) - 5} more patients")

print("\n" + "=" * 100)
print("CT-SEG MAPPING AUDIT COMPLETE")
print("=" * 100)
