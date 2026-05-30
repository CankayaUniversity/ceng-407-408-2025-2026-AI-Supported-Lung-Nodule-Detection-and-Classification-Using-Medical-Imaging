"""
TASK 2: VISUAL ALIGNMENT AUDIT
Loads CT volumes, SEG masks, and displays overlays to verify alignment
"""

from pathlib import Path
import pandas as pd
import numpy as np
import pydicom
import matplotlib
matplotlib.use('Agg')  # Non-interactive backend
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.colors import ListedColormap

# ============================================================================
# LOAD MAPPING CSV
# ============================================================================
csv_path = Path("ct_seg_mappings.csv")
if not csv_path.exists():
    print("ERROR: ct_seg_mappings.csv not found. Run mapping audit first.")
    exit(1)

df_mappings = pd.read_csv(csv_path)

print("=" * 100)
print("LIDC-IDRI VISUAL ALIGNMENT AUDIT")
print("=" * 100)

# ============================================================================
# SELECT 4-5 REPRESENTATIVE CT-SEG PAIRS
# ============================================================================
print("\n[1] SELECTING REPRESENTATIVE PAIRS")
print("-" * 100)

# Select diverse samples (from different CT series, different parts of dataset)
unique_cts = df_mappings['ct_series_uid'].unique()
selected_indices = np.linspace(0, len(unique_cts)-1, min(4, len(unique_cts)), dtype=int)
selected_cts = unique_cts[selected_indices]

pairs_to_inspect = []
for ct_uid in selected_cts:
    ct_rows = df_mappings[df_mappings['ct_series_uid'] == ct_uid]
    if len(ct_rows) > 0:
        pairs_to_inspect.append(ct_rows.iloc[0])

print(f"Selected {len(pairs_to_inspect)} representative pairs for visual inspection")

# ============================================================================
# INSPECT EACH PAIR
# ============================================================================
LIDC_ROOT = Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")

for pair_idx, pair_row in enumerate(pairs_to_inspect):
    patient_id = pair_row['patient_id']
    ct_series_uid = str(pair_row['ct_series_uid'])
    seg_series_uid = str(pair_row['seg_series_uid'])
    
    print(f"\n[{pair_idx + 1}] {patient_id}")
    print("-" * 100)
    
    try:
        patient_dir = LIDC_ROOT / patient_id
        
        if not patient_dir.exists():
            print(f"  ERROR: Patient directory not found: {patient_dir}")
            continue
        
        # ====================================================================
        # FIND CT AND SEG FOLDERS BY SEARCHING DICOM SERIES INSTANCE UIDS
        # ====================================================================
        ct_dir = None
        seg_dir = None
        
        # Search through all folders recursively
        for item in patient_dir.rglob("*.dcm"):
            try:
                ds = pydicom.dcmread(str(item), force=True)
                folder_series_uid = str(getattr(ds, 'SeriesInstanceUID', ''))
                folder_modality = getattr(ds, 'Modality', '')
                
                series_dir = item.parent
                
                if folder_series_uid == ct_series_uid and folder_modality == 'CT':
                    ct_dir = series_dir
                elif folder_series_uid == seg_series_uid and folder_modality == 'SEG':
                    seg_dir = series_dir
                
                if ct_dir and seg_dir:
                    break
            except:
                pass
        
        if ct_dir is None:
            print(f"  ERROR: CT series not found (UID: {ct_series_uid[:20]}...)")
            continue
        
        if seg_dir is None:
            print(f"  ERROR: SEG series not found (UID: {seg_series_uid[:20]}...)")
            continue
        
        print(f"  CT folder:  {ct_dir.name}")
        print(f"  SEG folder: {seg_dir.name}")
        
        # ====================================================================
        # LOAD CT VOLUME
        # ====================================================================
        ct_files = sorted(list(ct_dir.glob("*.dcm")))
        print(f"  CT DICOM files: {len(ct_files)} slices")
        
        if len(ct_files) == 0:
            print("  ERROR: No CT DICOM files found")
            continue
        
        # Load all CT slices
        ct_volume = []
        ct_positions = []
        
        for ct_file in ct_files:
            try:
                ds = pydicom.dcmread(str(ct_file), force=True)
                pix = ds.pixel_array
                ct_volume.append(pix)
                
                # Extract z-position
                if hasattr(ds, 'ImagePositionPatient'):
                    z_pos = float(ds.ImagePositionPatient[2])
                    ct_positions.append(z_pos)
            except:
                continue
        
        if len(ct_volume) == 0:
            print("  ERROR: Could not load CT slices")
            continue
        
        ct_volume = np.array(ct_volume)
        ct_positions = np.array(ct_positions) if ct_positions else np.arange(len(ct_volume))
        
        print(f"  CT volume shape: {ct_volume.shape}")
        print(f"  CT HU range: [{ct_volume.min()}, {ct_volume.max()}]")
        print(f"  CT z-positions: {ct_positions.min():.1f} to {ct_positions.max():.1f}")
        
        # ====================================================================
        # LOAD SEG VOLUME
        # ====================================================================
        seg_files = sorted(list(seg_dir.glob("*.dcm")))
        print(f"  SEG DICOM files: {len(seg_files)}")
        
        if len(seg_files) == 0:
            print("  ERROR: No SEG DICOM files found")
            continue
        
        # Load SEG volume
        seg_volume = None
        seg_positions = []
        
        try:
            ds_seg = pydicom.dcmread(str(seg_files[0]), force=True)
            
            # Extract pixel array and z-positions
            if hasattr(ds_seg, 'pixel_array'):
                pix_seg = ds_seg.pixel_array
                
                if pix_seg.ndim == 3:
                    seg_volume = pix_seg
                    print(f"  SEG volume shape: {seg_volume.shape} (multi-frame)")
                    
                    # Try to extract z-positions from ReferencedImageSequence
                    if hasattr(ds_seg, 'ReferencedImageSequence'):
                        for ref_img in ds_seg.ReferencedImageSequence:
                            if hasattr(ref_img, 'ReferencedSOPClassUID'):
                                seg_positions.append(None)
                    
                    if len(seg_positions) == 0:
                        seg_positions = np.arange(seg_volume.shape[0])
                
                elif pix_seg.ndim == 2:
                    seg_volume = pix_seg[np.newaxis, :, :]
                    print(f"  SEG volume shape: {seg_volume.shape} (single frame)")
                    seg_positions = [0]
        
        except Exception as e:
            print(f"  ERROR loading SEG: {str(e)[:50]}")
            continue
        
        if seg_volume is None or seg_volume.size == 0:
            print("  ERROR: SEG volume is empty")
            continue
        
        seg_positive_frames = np.where(np.any(seg_volume > 0, axis=(1, 2)))[0]
        print(f"  SEG positive frames: {seg_positive_frames.tolist()}")
        print(f"  SEG unique values: {np.unique(seg_volume).tolist()}")
        
        # ====================================================================
        # VISUALIZE OVERLAY
        # ====================================================================
        if len(seg_positive_frames) > 0:
            print(f"\n  VISUALIZATION:")
            
            # Create figure
            n_frames = min(3, len(seg_positive_frames))
            fig, axes = plt.subplots(1, n_frames, figsize=(15, 5))
            if n_frames == 1:
                axes = [axes]
            
            for plot_idx, seg_frame in enumerate(seg_positive_frames[:n_frames]):
                ax = axes[plot_idx]
                
                # Determine which CT slice to show
                # Simple heuristic: if we have 3D volume, show middle
                # Or try to match via frame number
                if ct_volume.shape[0] > seg_volume.shape[0]:
                    ct_frame = ct_volume.shape[0] // 2
                else:
                    ct_frame = min(seg_frame, ct_volume.shape[0] - 1)
                
                ct_slice = ct_volume[ct_frame]
                seg_slice = seg_volume[seg_frame]
                
                # Normalize CT to [0, 1] for display
                ct_norm = (ct_slice - ct_slice.min()) / (ct_slice.max() - ct_slice.min() + 1e-8)
                
                # Display CT
                ax.imshow(ct_norm, cmap='gray', alpha=0.8)
                
                # Overlay SEG mask
                if seg_slice.max() > 0:
                    mask_display = np.ma.masked_where(seg_slice == 0, seg_slice)
                    ax.imshow(mask_display, cmap='Reds', alpha=0.4)
                
                ax.set_title(f"CT slice {ct_frame}, SEG frame {seg_frame}")
                ax.axis('off')
            
            fig.tight_layout()
            output_file = f"alignment_audit_{patient_id}_{pair_idx}.png"
            plt.savefig(output_file, dpi=80, bbox_inches='tight')
            plt.close()
            
            print(f"    Saved visualization to: {output_file}")
        
        # ====================================================================
        # ALIGNMENT VERIFICATION
        # ====================================================================
        print(f"\n  ALIGNMENT VERIFICATION:")
        print(f"    CT shape:  {ct_volume.shape}")
        print(f"    SEG shape: {seg_volume.shape}")
        print(f"    SEG frames with data: {len(seg_positive_frames)}")
        print(f"    SEG frame indices:     {seg_positive_frames.tolist()}")
        
        # Check if dimensions match
        if ct_volume.shape[1:] == seg_volume.shape[1:]:
            print(f"    ✓ XY dimensions MATCH ({ct_volume.shape[1]}×{ct_volume.shape[2]})")
        else:
            print(f"    ✗ XY dimensions MISMATCH (CT: {ct_volume.shape[1]}×{ct_volume.shape[2]}, SEG: {seg_volume.shape[1]}×{seg_volume.shape[2]})")
        
        # Check if SEG is within CT depth
        if seg_volume.shape[0] <= ct_volume.shape[0]:
            print(f"    ✓ SEG depth within CT depth (SEG: {seg_volume.shape[0]}, CT: {ct_volume.shape[0]})")
        else:
            print(f"    ✗ SEG depth exceeds CT depth (SEG: {seg_volume.shape[0]}, CT: {ct_volume.shape[0]})")
        
        # Check data coverage
        seg_nonzero = np.sum(seg_volume > 0)
        seg_pixels = seg_volume.size
        coverage = 100.0 * seg_nonzero / seg_pixels
        print(f"    Mask coverage: {coverage:.2f}% ({seg_nonzero} nonzero pixels)")
    
    except Exception as e:
        print(f"  ERROR: {str(e)[:100]}")

print("\n" + "=" * 100)
print("VISUAL ALIGNMENT AUDIT COMPLETE")
print("=" * 100)
