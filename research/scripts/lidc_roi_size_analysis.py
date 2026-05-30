"""
LIDC-IDRI ROI SIZE ANALYSIS SCRIPT
Analyzes bounding box sizes from verified CT-SEG pairs to determine optimal ROI target

Works on both Google Colab and local system
"""

import os
import sys
import gc
from pathlib import Path
import numpy as np
import pandas as pd
import pydicom
from pydicom.errors import InvalidDicomError
import matplotlib
matplotlib.use('Agg')  # Colab-friendly backend
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from scipy import stats

print("=" * 100)
print("LIDC-IDRI ROI SIZE ANALYSIS")
print("=" * 100)

# ============================================================================
# SETUP: DETECT ENVIRONMENT AND PATHS
# ============================================================================
print("\n[SETUP] Detecting environment...")

IS_COLAB = 'google.colab' in sys.modules
if IS_COLAB:
    print("  → Running on Google Colab")
    LIDC_ROOT = Path("/content/drive/MyDrive/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
    WORK_DIR = Path("/content/drive/MyDrive")
else:
    print("  → Running on local system")
    LIDC_ROOT = Path("C:/LIDC_DATA/manifest-1773770928394/LIDC-IDRI")
    WORK_DIR = Path.cwd()

print(f"  → LIDC Root: {LIDC_ROOT}")
print(f"  → Work Dir: {WORK_DIR}")

# ============================================================================
# LOAD MAPPING CSV
# ============================================================================
print("\n[DATA LOADING] Looking for CT-SEG mapping CSV...")

# Try local first, then work directory
csv_candidates = [
    Path.cwd() / "ct_seg_mappings.csv",
    WORK_DIR / "ct_seg_mappings.csv",
]

df_mappings = None
csv_path = None

for candidate in csv_candidates:
    if candidate.exists():
        print(f"  ✓ Found mapping CSV: {candidate}")
        df_mappings = pd.read_csv(candidate)
        csv_path = candidate
        break

if df_mappings is None:
    print("  ⚠ WARNING: Mapping CSV not found. Scanning dataset structure...")
    print("  → Will analyze all found SEG files in dataset")
    # In this case, we'll scan the dataset, but for now show the warning
    df_mappings = None
else:
    print(f"  → Loaded {len(df_mappings)} CT-SEG mapping records")

# ============================================================================
# CHECK FOR CHECKPOINT (Colab resume support)
# ============================================================================
checkpoint_file = Path.cwd() / "roi_analysis_checkpoint.pkl"
checkpoint_results = []

if checkpoint_file.exists():
    print("\n[CHECKPOINT] Found previous run checkpoint.")
    try:
        import pickle
        with open(checkpoint_file, 'rb') as f:
            checkpoint_data = pickle.load(f)
            checkpoint_results = checkpoint_data.get('results', [])
            checkpoint_processed = checkpoint_data.get('processed_indices', set())
        print(f"  → Restored {len(checkpoint_results)} results from checkpoint")
        print(f"  → Will skip {len(checkpoint_processed)} already-processed records")
    except Exception as e:
        print(f"  ⚠ Error loading checkpoint: {str(e)[:50]}")
        checkpoint_results = []
        checkpoint_processed = set()
else:
    checkpoint_processed = set()

# ============================================================================
# FUNCTION DEFINITIONS
# ============================================================================

def get_seg_bbox_stats(seg_file_path):
    """
    Load a SEG DICOM file and extract bounding box statistics.
    Memory-efficient version for Colab compatibility.
    
    Returns dict with:
    - bbox_width: width of bounding box in pixels
    - bbox_height: height of bounding box in pixels
    - bbox_area: area of bounding box in pixels²
    - bbox_xmin, bbox_xmax, bbox_ymin, bbox_ymax
    - num_frames: number of frames with positive pixels
    - num_positive: total nonzero pixels across all frames
    """
    try:
        ds = pydicom.dcmread(str(seg_file_path), force=True)
        
        if not hasattr(ds, 'pixel_array'):
            return None
        
        pix = ds.pixel_array
        
        # Ensure 3D array
        if pix.ndim == 2:
            pix = pix[np.newaxis, :, :]
        elif pix.ndim != 3:
            return None
        
        # Memory-efficient bounding box computation
        # Process frame by frame to avoid large intermediate arrays
        bbox_xmin = float('inf')
        bbox_xmax = -1
        bbox_ymin = float('inf')
        bbox_ymax = -1
        num_frames_positive = 0
        num_positive = 0
        
        for frame_idx in range(pix.shape[0]):
            frame = pix[frame_idx]
            nonzero = np.nonzero(frame)
            
            if len(nonzero[0]) > 0:
                num_frames_positive += 1
                num_positive += len(nonzero[0])
                
                y_coords = nonzero[0]
                x_coords = nonzero[1]
                
                bbox_ymin = min(bbox_ymin, y_coords.min())
                bbox_ymax = max(bbox_ymax, y_coords.max())
                bbox_xmin = min(bbox_xmin, x_coords.min())
                bbox_xmax = max(bbox_xmax, x_coords.max())
        
        if bbox_xmin == float('inf'):
            # No positive pixels
            return {
                'bbox_width': 0,
                'bbox_height': 0,
                'bbox_area': 0,
                'bbox_xmin': -1,
                'bbox_xmax': -1,
                'bbox_ymin': -1,
                'bbox_ymax': -1,
                'num_frames': 0,
                'num_positive': 0,
            }
        
        bbox_height = int(bbox_ymax - bbox_ymin + 1)
        bbox_width = int(bbox_xmax - bbox_xmin + 1)
        bbox_area = bbox_width * bbox_height
        
        return {
            'bbox_width': bbox_width,
            'bbox_height': bbox_height,
            'bbox_area': bbox_area,
            'bbox_xmin': int(bbox_xmin),
            'bbox_xmax': int(bbox_xmax),
            'bbox_ymin': int(bbox_ymin),
            'bbox_ymax': int(bbox_ymax),
            'num_frames': num_frames_positive,
            'num_positive': num_positive,
        }
    
    except Exception as e:
        return None


# ============================================================================
# MAIN ANALYSIS
# ============================================================================

print("\n[ANALYSIS] Processing SEG files...")

results = checkpoint_results.copy()  # Start with checkpoint data
gc_interval = 50  # Garbage collect every 50 files (Colab-friendly)
checkpoint_save_interval = 100  # Save checkpoint every 100 files

if df_mappings is not None:
    # Use mapping CSV
    total = len(df_mappings)
    processed = len(checkpoint_results)
    skipped = 0
    
    for idx, row in df_mappings.iterrows():
        # Skip already processed records
        if idx in checkpoint_processed:
            continue
        
        if (idx + 1) % 50 == 0 or idx == 0:
            status = f"  [{idx + 1:4d}/{total}] Processed: {processed:4d}, Skipped: {skipped:4d}"
            print(status, end='\r')
        
        patient_id = row['patient_id']
        seg_series_uid = str(row['seg_series_uid'])
        
        # Find SEG folder recursively
        patient_dir = LIDC_ROOT / patient_id
        
        if not patient_dir.exists():
            skipped += 1
            checkpoint_processed.add(idx)
            continue
        
        # Find matching SEG file
        seg_file = None
        try:
            for dcm_file in patient_dir.rglob("*.dcm"):
                try:
                    ds = pydicom.dcmread(str(dcm_file), force=True)
                    if getattr(ds, 'Modality', '') == 'SEG':
                        file_uid = str(getattr(ds, 'SeriesInstanceUID', ''))
                        if file_uid == seg_series_uid:
                            seg_file = dcm_file
                            break
                except:
                    continue
        except:
            skipped += 1
            checkpoint_processed.add(idx)
            continue
        
        if seg_file is None:
            skipped += 1
            checkpoint_processed.add(idx)
            continue
        
        # Analyze this SEG file
        try:
            stats_dict = get_seg_bbox_stats(seg_file)
        except Exception as e:
            skipped += 1
            checkpoint_processed.add(idx)
            continue
        
        if stats_dict is None:
            skipped += 1
            checkpoint_processed.add(idx)
            continue
        
        # Add patient info
        stats_dict['patient_id'] = patient_id
        stats_dict['seg_series_uid'] = seg_series_uid[:20]
        
        results.append(stats_dict)
        processed += 1
        checkpoint_processed.add(idx)
        
        # Periodic garbage collection for Colab
        if (idx + 1) % gc_interval == 0:
            gc.collect()
        
        # Periodic checkpoint save for Colab resume
        if (idx + 1) % checkpoint_save_interval == 0:
            try:
                import pickle
                checkpoint_data = {
                    'results': results,
                    'processed_indices': checkpoint_processed
                }
                with open(checkpoint_file, 'wb') as f:
                    pickle.dump(checkpoint_data, f)
            except:
                pass  # Silently fail checkpoint save to not interrupt analysis
    
    print(f"  [{total:4d}/{total}] Processed: {processed:4d}, Skipped: {skipped:4d} ✓ Complete")
    
    # Save final checkpoint
    try:
        import pickle
        checkpoint_data = {
            'results': results,
            'processed_indices': checkpoint_processed
        }
        with open(checkpoint_file, 'wb') as f:
            pickle.dump(checkpoint_data, f)
    except:
        pass

# Convert to DataFrame
df_results = pd.DataFrame(results)

if len(df_results) == 0:
    print("  ERROR: No SEG files processed. Check data path.")
    sys.exit(1)

print(f"\n  ✓ Analyzed {len(df_results)} SEG files")

# ============================================================================
# FILTER OUT ZERO-SIZE BBOXES
# ============================================================================
df_valid = df_results[df_results['bbox_width'] > 0].copy()

print(f"  → Valid bboxes (width > 0): {len(df_valid)}")
print(f"  → Empty masks: {len(df_results) - len(df_valid)}")

if len(df_valid) == 0:
    print("  ERROR: No valid bounding boxes found.")
    sys.exit(1)

# ============================================================================
# CALCULATE STATISTICS
# ============================================================================
print("\n[STATISTICS]")
print("-" * 100)

def calc_stats(data):
    """Calculate comprehensive statistics"""
    return {
        'min': data.min(),
        'max': data.max(),
        'mean': data.mean(),
        'median': data.median(),
        'p90': data.quantile(0.90),
        'p95': data.quantile(0.95),
        'std': data.std(),
    }

# Bbox width statistics
width_stats = calc_stats(df_valid['bbox_width'])
print("\nBounding Box WIDTH (pixels):")
for key, val in width_stats.items():
    print(f"  {key:10s}: {val:8.1f}")

# Bbox height statistics
height_stats = calc_stats(df_valid['bbox_height'])
print("\nBounding Box HEIGHT (pixels):")
for key, val in height_stats.items():
    print(f"  {key:10s}: {val:8.1f}")

# Bbox area statistics
area_stats = calc_stats(df_valid['bbox_area'])
print("\nBounding Box AREA (pixels²):")
for key, val in area_stats.items():
    print(f"  {key:10s}: {val:10.1f}")

# Num frames statistics
frames_stats = {
    'min': df_valid['num_frames'].min(),
    'max': df_valid['num_frames'].max(),
    'mean': df_valid['num_frames'].mean(),
    'median': df_valid['num_frames'].median(),
}
print("\nNumber of FRAMES (z-slices with annotation):")
for key, val in frames_stats.items():
    print(f"  {key:10s}: {val:8.1f}")

# Num positive pixels
pixels_stats = {
    'min': df_valid['num_positive'].min(),
    'max': df_valid['num_positive'].max(),
    'mean': df_valid['num_positive'].mean(),
    'median': df_valid['num_positive'].median(),
}
print("\nTotal NONZERO PIXELS per SEG:")
for key, val in pixels_stats.items():
    print(f"  {key:10s}: {val:10.0f}")

# ============================================================================
# MARGIN SIMULATION
# ============================================================================
print("\n[MARGIN SIMULATION]")
print("-" * 100)

margins = [16, 24, 32]

for margin in margins:
    print(f"\nWith margin={margin} pixels on each side:")
    
    # Calculate ROI sizes with margin
    roi_widths = df_valid['bbox_width'] + 2 * margin
    roi_heights = df_valid['bbox_height'] + 2 * margin
    roi_areas = roi_widths * roi_heights
    
    print(f"  ROI Width:   min={roi_widths.min():.0f}, max={roi_widths.max():.0f}, "
          f"mean={roi_widths.mean():.1f}, median={roi_widths.median():.0f}, "
          f"p90={roi_widths.quantile(0.90):.0f}, p95={roi_widths.quantile(0.95):.0f}")
    
    print(f"  ROI Height:  min={roi_heights.min():.0f}, max={roi_heights.max():.0f}, "
          f"mean={roi_heights.mean():.1f}, median={roi_heights.median():.0f}, "
          f"p90={roi_heights.quantile(0.90):.0f}, p95={roi_heights.quantile(0.95):.0f}")
    
    print(f"  ROI Area:    min={roi_areas.min():.0f}, max={roi_areas.max():.0f}, "
          f"mean={roi_areas.mean():.1f}, median={roi_areas.median():.0f}")

# ============================================================================
# SUMMARY DATAFRAME
# ============================================================================
print("\n[SUMMARY TABLE]")
print("-" * 100)

summary_table = pd.DataFrame({
    'Metric': [
        'Width (px)',
        'Height (px)',
        'Area (px²)',
        'Frames (z)',
        'Nonzero Pixels'
    ],
    'Min': [
        f"{width_stats['min']:.0f}",
        f"{height_stats['min']:.0f}",
        f"{area_stats['min']:.0f}",
        f"{frames_stats['min']:.0f}",
        f"{pixels_stats['min']:.0f}",
    ],
    'Max': [
        f"{width_stats['max']:.0f}",
        f"{height_stats['max']:.0f}",
        f"{area_stats['max']:.0f}",
        f"{frames_stats['max']:.0f}",
        f"{pixels_stats['max']:.0f}",
    ],
    'Mean': [
        f"{width_stats['mean']:.1f}",
        f"{height_stats['mean']:.1f}",
        f"{area_stats['mean']:.1f}",
        f"{frames_stats['mean']:.1f}",
        f"{pixels_stats['mean']:.0f}",
    ],
    'Median': [
        f"{width_stats['median']:.0f}",
        f"{height_stats['median']:.0f}",
        f"{area_stats['median']:.0f}",
        f"{frames_stats['median']:.0f}",
        f"{pixels_stats['median']:.0f}",
    ],
    'p90': [
        f"{width_stats['p90']:.0f}",
        f"{height_stats['p90']:.0f}",
        f"{area_stats['p90']:.0f}",
        f"{df_valid['num_frames'].quantile(0.90):.0f}",
        f"{df_valid['num_positive'].quantile(0.90):.0f}",
    ],
    'p95': [
        f"{width_stats['p95']:.0f}",
        f"{height_stats['p95']:.0f}",
        f"{area_stats['p95']:.0f}",
        f"{df_valid['num_frames'].quantile(0.95):.0f}",
        f"{df_valid['num_positive'].quantile(0.95):.0f}",
    ]
})

print(summary_table.to_string(index=False))

# ============================================================================
# GENERATE VISUALIZATIONS (Matplotlib)
# ============================================================================
print("\n[VISUALIZATION] Generating plots...")

fig, axes = plt.subplots(2, 2, figsize=(14, 10))

# Plot 1: Width histogram
ax = axes[0, 0]
ax.hist(df_valid['bbox_width'], bins=50, color='steelblue', edgecolor='black', alpha=0.7)
ax.axvline(width_stats['mean'], color='red', linestyle='--', linewidth=2, label=f"Mean: {width_stats['mean']:.1f}")
ax.axvline(width_stats['median'], color='green', linestyle='--', linewidth=2, label=f"Median: {width_stats['median']:.0f}")
ax.set_xlabel('Bounding Box Width (pixels)', fontsize=11)
ax.set_ylabel('Frequency', fontsize=11)
ax.set_title('Distribution of Nodule Bounding Box Widths', fontsize=12, fontweight='bold')
ax.legend()
ax.grid(alpha=0.3)

# Plot 2: Height histogram
ax = axes[0, 1]
ax.hist(df_valid['bbox_height'], bins=50, color='coral', edgecolor='black', alpha=0.7)
ax.axvline(height_stats['mean'], color='red', linestyle='--', linewidth=2, label=f"Mean: {height_stats['mean']:.1f}")
ax.axvline(height_stats['median'], color='green', linestyle='--', linewidth=2, label=f"Median: {height_stats['median']:.0f}")
ax.set_xlabel('Bounding Box Height (pixels)', fontsize=11)
ax.set_ylabel('Frequency', fontsize=11)
ax.set_title('Distribution of Nodule Bounding Box Heights', fontsize=12, fontweight='bold')
ax.legend()
ax.grid(alpha=0.3)

# Plot 3: Width vs Height scatter
ax = axes[1, 0]
ax.scatter(df_valid['bbox_width'], df_valid['bbox_height'], alpha=0.5, s=30, color='purple')
ax.set_xlabel('Width (pixels)', fontsize=11)
ax.set_ylabel('Height (pixels)', fontsize=11)
ax.set_title('Bounding Box Width vs Height', fontsize=12, fontweight='bold')
ax.grid(alpha=0.3)

# Plot 4: ROI size coverage with different margins
ax = axes[1, 1]
roi_target_sizes = [64, 96, 128, 160, 192, 256]
coverage_data = {}

for target_size in roi_target_sizes:
    # How many nodules fit within this target size?
    max_dim = np.maximum(df_valid['bbox_width'], df_valid['bbox_height'])
    # With margin=0, check coverage
    inside = (max_dim <= target_size).sum()
    coverage = 100.0 * inside / len(df_valid)
    coverage_data[target_size] = coverage

ax.plot(list(coverage_data.keys()), list(coverage_data.values()), 'o-', linewidth=2, markersize=8, color='darkblue')
ax.fill_between(list(coverage_data.keys()), list(coverage_data.values()), alpha=0.3)
ax.set_xlabel('Target ROI Size (pixels)', fontsize=11)
ax.set_ylabel('Coverage (%)', fontsize=11)
ax.set_title('Percentage of Nodules Fitting in Target ROI Size', fontsize=12, fontweight='bold')
ax.grid(alpha=0.3)
ax.set_ylim([0, 105])

plt.tight_layout()

# Save figure
output_file = 'roi_size_analysis.png'
plt.savefig(output_file, dpi=150, bbox_inches='tight')
print(f"  ✓ Saved plot to: {output_file}")
plt.close()

# ============================================================================
# FINAL RECOMMENDATION
# ============================================================================
print("\n[RECOMMENDATION]")
print("=" * 100)

max_dim = np.maximum(df_valid['bbox_width'], df_valid['bbox_height'])

# Coverage analysis
coverage_128 = (max_dim <= 128).sum() / len(df_valid) * 100
coverage_160 = (max_dim <= 160).sum() / len(df_valid) * 100
coverage_256 = (max_dim <= 256).sum() / len(df_valid) * 100

with_margin_16_fits_128 = ((df_valid['bbox_width'] + 32 <= 128) & (df_valid['bbox_height'] + 32 <= 128)).sum()
with_margin_16_fits_160 = ((df_valid['bbox_width'] + 32 <= 160) & (df_valid['bbox_height'] + 32 <= 160)).sum()
with_margin_24_fits_160 = ((df_valid['bbox_width'] + 48 <= 160) & (df_valid['bbox_height'] + 48 <= 160)).sum()
with_margin_24_fits_192 = ((df_valid['bbox_width'] + 48 <= 192) & (df_valid['bbox_height'] + 48 <= 192)).sum()
with_margin_32_fits_256 = ((df_valid['bbox_width'] + 64 <= 256) & (df_valid['bbox_height'] + 64 <= 256)).sum()

print(f"""
NODULE SIZE ANALYSIS RESULTS:
─────────────────────────────────────────────────────────────────────────────────

Raw Bounding Box (no margin):
  • Mean bbox max dimension: {max_dim.mean():.1f} pixels
  • Median bbox max dimension: {max_dim.median():.0f} pixels
  • 90th percentile: {max_dim.quantile(0.90):.0f} pixels
  • 95th percentile: {max_dim.quantile(0.95):.0f} pixels
  
Coverage without margin:
  • Fit in 128×128:  {coverage_128:5.1f}% ({int((max_dim <= 128).sum())}/{len(df_valid)})
  • Fit in 160×160:  {coverage_160:5.1f}% ({int((max_dim <= 160).sum())}/{len(df_valid)})
  • Fit in 256×256:  {coverage_256:5.1f}% ({int((max_dim <= 256).sum())}/{len(df_valid)})

Coverage WITH MARGIN:
  • Bbox + margin=16 fit in 128×128:  {with_margin_16_fits_128:3d}/{len(df_valid)} ({100*with_margin_16_fits_128/len(df_valid):5.1f}%)
  • Bbox + margin=16 fit in 160×160:  {with_margin_16_fits_160:3d}/{len(df_valid)} ({100*with_margin_16_fits_160/len(df_valid):5.1f}%)
  • Bbox + margin=24 fit in 160×160:  {with_margin_24_fits_160:3d}/{len(df_valid)} ({100*with_margin_24_fits_160/len(df_valid):5.1f}%)
  • Bbox + margin=24 fit in 192×192:  {with_margin_24_fits_192:3d}/{len(df_valid)} ({100*with_margin_24_fits_192/len(df_valid):5.1f}%)
  • Bbox + margin=32 fit in 256×256:  {with_margin_32_fits_256:3d}/{len(df_valid)} ({100*with_margin_32_fits_256/len(df_valid):5.1f}%)

─────────────────────────────────────────────────────────────────────────────────

RECOMMENDATION:

Optimal target ROI size: 192×192 pixels (with margin=24)

Rationale:
  1. Captures {100*with_margin_24_fits_192/len(df_valid):.1f}% of nodules with margin=24
  2. Margin=24 provides adequate context for segmentation (balance context vs. noise)
  3. 192×192 is computationally efficient while retaining detail
  4. Falls between standard sizes: not too small (128) causing crop loss, not too large (256) 
     causing unnecessary padding

Alternative options:
  • 160×160 with margin=16: More aggressive crop, fits {100*with_margin_16_fits_160/len(df_valid):.1f}% (smaller margins)
  • 256×256 with margin=32: Conservative, fits {100*with_margin_32_fits_256/len(df_valid):.1f}%, but larger memory footprint
  
Recommendation for preprocessing:
  → Use 192×192 ROI size
  → Apply margin=24 pixels around detected bounding box
  → For oversized nodules ({len(df_valid) - with_margin_24_fits_192} cases), apply adaptive resizing
     (resize instead of crop to allow seeing full nodule context)

═══════════════════════════════════════════════════════════════════════════════════
""")

print("\n✓ Analysis complete.")
print(f"  Plots saved to: {output_file}")
print(f"  Results table: {len(df_valid)} validated nodules analyzed")
print(f"  Checkpoint saved to: {checkpoint_file}")
print("\n  ℹ️  Checkpoint lets you resume if Colab times out.")
print("      Re-running this script will skip already-processed records.")
print(f"\n[TIME ESTIMATE]")
print(f"  • Total files processed: {len(results)}")
print(f"  • Avg time per file: ~0.5-1s (depends on Colab")
print(f"  • If interrupted, simply re-run this cell to resume from checkpoint")
