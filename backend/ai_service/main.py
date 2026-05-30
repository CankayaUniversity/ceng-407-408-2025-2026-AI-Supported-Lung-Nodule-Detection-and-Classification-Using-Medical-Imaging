"""
Pulmo AI Service - FastAPI inference service for lung nodule detection.
Two-stage pipeline: HeatmapUNet3D (Stage 1) + Student2p5D (Stage 2).
"""

import os
import sys
import threading
import numpy as np
from pathlib import Path

import uvicorn
from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Paths ────────────────────────────────────────────────────────────────────
SERVICE_DIR = Path(__file__).parent
MODEL_DIR   = SERVICE_DIR / "model"
STAGE1_PTH  = MODEL_DIR / "stage1_detector_v2.pth"
STAGE2_PTH  = MODEL_DIR / "student_2p5d_best.pth"
MODELING_PY = MODEL_DIR / "modeling.py"

# model/ on path so analyze_scan.py can do `from modeling import ...`
if str(MODEL_DIR) not in sys.path:
    sys.path.insert(0, str(MODEL_DIR))

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Pulmo AI Service", version="2.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

# ─── Global model state ───────────────────────────────────────────────────────
_stage1      = None
_stage2      = None
_models_lock = threading.Lock()

_download_lock   = threading.Lock()
_download_status = {"status": "idle", "progress": 0, "message": ""}

# ─── Schemas ──────────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    study_id: str
    dicom_folder: str

class ExportNodule3DRequest(BaseModel):
    study_id: str
    nodule_id: int
    center_voxel: dict
    dicom_folder: str

class GroundTruthRequest(BaseModel):
    dicom_folder: str

# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/status")
def get_status():
    downloaded = STAGE1_PTH.exists() and STAGE2_PTH.exists() and MODELING_PY.exists()
    return {
        "downloaded": downloaded,
        "model_dir": str(MODEL_DIR),
        "download_status": _download_status,
    }


@app.post("/download")
def download_model(background_tasks: BackgroundTasks):
    with _download_lock:
        if _download_status["status"] == "downloading":
            return {"message": "Already downloading", "status": _download_status}
        _download_status.update({"status": "downloading", "progress": 0, "message": "Starting..."})
    background_tasks.add_task(_run_download)
    return {"message": "Download started"}


def _run_download():
    global _download_status
    try:
        from huggingface_hub import hf_hub_download
        MODEL_DIR.mkdir(parents=True, exist_ok=True)
        files = [
            ("modeling.py",             20),
            ("config.json",             25),
            ("analyze_scan.py",         30),
            ("inference_example.py",    35),
            ("student_2p5d_best.pth",   65),
            ("stage1_detector_v2.pth",  95),
        ]
        for filename, progress in files:
            _download_status.update({
                "status": "downloading", "progress": progress,
                "message": f"Downloading {filename}...",
            })
            hf_hub_download(
                repo_id="ariyul/Pulmo", filename=filename,
                local_dir=str(MODEL_DIR), local_dir_use_symlinks=False,
            )
        _download_status.update({"status": "completed", "progress": 100, "message": "Download complete"})
    except Exception as e:
        _download_status.update({"status": "error", "progress": 0, "message": str(e)})


@app.post("/analyze")
async def analyze(request: AnalyzeRequest):
    if not STAGE1_PTH.exists() or not STAGE2_PTH.exists():
        raise HTTPException(status_code=400, detail="Models not downloaded. Call /download first.")
    try:
        import torch
        stage1, stage2 = _get_models()
        volume, dcm_files, spacing = _load_dicom_series(request.dicom_folder)
        print(f"[ANALYZE] volume={volume.shape}  spacing={spacing}", flush=True)

        # ── Lung mask (simple threshold + connected components) ────────────────
        lung_mask   = _compute_lung_mask(volume)
        lung_filled = _fill_lung_mask(volume, lung_mask)
        print(f"[ANALYZE] lung voxels={lung_filled.sum()}", flush=True)

        # ── Stage 1: find candidates with lower threshold ──────────────────────
        from modeling import find_candidates, crop_stage2_input, explain_malignancy, CONCEPT_NAMES
        cands_all = find_candidates(stage1, volume, spacing, device="cpu",
                                    peak_thresh=0.05)
        print(f"[ANALYZE] stage1 raw candidates={len(cands_all)}", flush=True)

        # ── Filter candidates to lung region ──────────────────────────────────
        # Direct membership check: candidate voxel must be inside the per-lobe
        # filled lung mask. No margin — the per-lobe fill already includes
        # vessels/nodules that appear as "holes" inside the parenchyma.
        # HU gate: nodules are soft tissue (-900 to +200 HU).
        Z, H, W = volume.shape
        cands = []
        for (z, y, x) in cands_all:
            if z < 0 or z >= Z or y < 0 or y >= H or x < 0 or x >= W:
                continue
            hu = float(volume[z, y, x])
            if hu > 200 or hu < -900:
                continue
            if lung_filled[z, y, x]:
                cands.append((z, y, x))
        print(f"[ANALYZE] candidates after lung filter={len(cands)}", flush=True)

        # ── Stage 2: classify / segment each candidate ─────────────────────────
        findings = []
        for (z, y, x) in cands:
            xin = crop_stage2_input(volume, (z, y, x))
            with torch.no_grad():
                out = stage2(xin)
            det_p = torch.softmax(out["detection"][0], 0)[1].item()
            if det_p < 0.5:
                continue
            mal_p    = torch.softmax(out["malignancy"][0], 0)[1].item()
            seg      = torch.sigmoid(out["segmentation"][0, 0]).cpu().numpy()
            concepts = out["concepts"][0].cpu().numpy()
            findings.append({
                "location_voxel": (int(z), int(y), int(x)),
                "detection_prob":  det_p,
                "malignancy_prob": mal_p,
                "prediction":      "MALIGNANT" if mal_p >= 0.5 else "BENIGN",
                "segmentation":    seg,
                "concepts":        {n: float(v) for n, v in zip(CONCEPT_NAMES, concepts)},
                "top_reasons":     explain_malignancy(stage2, out)[:3],
            })

        findings.sort(key=lambda f: -f["malignancy_prob"])
        print(f"[ANALYZE] findings after stage2={len(findings)}", flush=True)

        nodules = _build_nodule_results(findings, volume, spacing,
                                        request.dicom_folder, request.study_id)
        return {"nodules": nodules, "total_slices": len(dcm_files)}
    except Exception as e:
        import traceback; traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/export-nodule-3d")
async def export_nodule_3d(request: ExportNodule3DRequest):
    try:
        import pydicom
        folder    = Path(request.dicom_folder)
        dcm_files = sorted([f for f in os.listdir(folder) if f.lower().endswith(".dcm")])
        z = int(request.center_voxel["z"]); y = int(request.center_voxel["y"]); x = int(request.center_voxel["x"])
        z_s = max(0, z - 32); z_e = min(len(dcm_files), z + 33)
        y_s = max(0, y - 32); x_s = max(0, x - 32)
        out_dir = folder / f"nodule_{request.nodule_id}_3d"; out_dir.mkdir(exist_ok=True)
        saved = []
        for i, zi in enumerate(range(z_s, z_e)):
            if zi >= len(dcm_files): break
            dcm = pydicom.dcmread(str(folder / dcm_files[zi]))
            pix = dcm.pixel_array
            ye = min(y_s + 64, pix.shape[0]); xe = min(x_s + 64, pix.shape[1])
            cropped = pix[y_s:ye, x_s:xe]
            dcm.PixelData = cropped.tobytes(); dcm.Rows, dcm.Columns = cropped.shape
            dcm.InstanceNumber = i + 1
            fname = f"slice_{i:04d}.dcm"; dcm.save_as(str(out_dir / fname))
            saved.append(f"nodule_{request.nodule_id}_3d/{fname}")
        return {"series_path": f"/uploads/{request.study_id}/nodule_{request.nodule_id}_3d",
                "files": saved, "slice_count": len(saved)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Model loading ────────────────────────────────────────────────────────────

def _get_models():
    global _stage1, _stage2
    with _models_lock:
        if _stage1 is not None and _stage2 is not None:
            return _stage1, _stage2
        if not MODELING_PY.exists():
            raise RuntimeError("modeling.py not found — download models first")
        import importlib.util
        spec = importlib.util.spec_from_file_location("pulmo_modeling", str(MODELING_PY))
        mod  = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        sys.modules["pulmo_modeling"] = mod
        _stage1 = mod.load_stage1(str(STAGE1_PTH), device="cpu")
        _stage2 = mod.load_stage2(str(STAGE2_PTH), device="cpu")
        print("[MODELS] Stage 1 (HeatmapUNet3D) + Stage 2 (Student2p5D) loaded", flush=True)
        return _stage1, _stage2


# ─── DICOM loading ────────────────────────────────────────────────────────────

def _load_dicom_series(folder: str):
    import pydicom, re
    folder = Path(folder)
    all_fnames = [f for f in os.listdir(folder) if f.lower().endswith(".dcm")]
    if not all_fnames:
        raise ValueError(f"No DICOM files in {folder}")

    def _slice_key(fname):
        try:
            dcm = pydicom.dcmread(str(folder / fname), stop_before_pixels=True)
            if hasattr(dcm, "ImagePositionPatient"): return float(dcm.ImagePositionPatient[2])
            if hasattr(dcm, "SliceLocation"):        return float(dcm.SliceLocation)
            if hasattr(dcm, "InstanceNumber"):       return float(dcm.InstanceNumber)
        except Exception: pass
        nums = re.findall(r"\d+", fname)
        return float(nums[-1]) if nums else 0.0

    dcm_files = sorted(all_fnames, key=_slice_key)
    first     = pydicom.dcmread(str(folder / dcm_files[0]))
    H, W      = first.pixel_array.shape
    Z         = len(dcm_files)
    st        = float(getattr(first, "SliceThickness", 1.5))
    ps        = getattr(first, "PixelSpacing", [1.0, 1.0])
    spacing   = (st, float(ps[0]), float(ps[1]))
    volume    = np.zeros((Z, H, W), dtype=np.float32)
    for i, fname in enumerate(dcm_files):
        dcm = pydicom.dcmread(str(folder / fname))
        volume[i] = dcm.pixel_array.astype(np.float32) * float(getattr(dcm, "RescaleSlope", 1.0)) \
                    + float(getattr(dcm, "RescaleIntercept", -1024.0))
    return volume, dcm_files, spacing


# ─── Lung segmentation ───────────────────────────────────────────────────────

def _compute_lung_mask(volume: np.ndarray) -> np.ndarray:
    """Per-slice connected-component lung mask.
    Removes external air (border-touching) → keeps 2 largest internal regions.
    """
    from scipy.ndimage import label
    Z, H, W = volume.shape
    mask = np.zeros((Z, H, W), dtype=bool)
    for z in range(Z):
        sl      = volume[z]
        air     = sl < -400
        labeled, _ = label(air)
        if labeled.max() == 0:
            continue
        border = set()
        for edge in (labeled[0, :], labeled[-1, :], labeled[:, 0], labeled[:, -1]):
            border.update(edge.tolist())
        border.discard(0)
        internal = air.copy()
        for lbl in border:
            internal[labeled == lbl] = False
        if not internal.any():
            continue
        labeled2, _ = label(internal)
        sizes = np.bincount(labeled2.ravel()); sizes[0] = 0
        for lbl in np.argsort(sizes)[-2:]:
            if sizes[lbl] > 200:
                mask[z] |= (labeled2 == lbl)
    return mask


def _fill_lung_mask(volume: np.ndarray, lung_mask: np.ndarray) -> np.ndarray:
    """Fill each lung lobe separately to avoid including the mediastinum.
    Combined fill of both lungs makes binary_fill_holes bridge across the
    mediastinum gap, incorrectly including heart/vessels/mediastinum.
    Filling each connected component independently prevents this.
    """
    from scipy.ndimage import binary_fill_holes, label
    Z = volume.shape[0]
    filled = np.zeros_like(lung_mask)
    for z in range(Z):
        if not lung_mask[z].any():
            continue
        labeled, n = label(lung_mask[z])
        for lbl in range(1, n + 1):
            filled[z] |= binary_fill_holes(labeled == lbl)
    return filled


# ─── Post-processing: findings -> PNG masks + response dict ──────────────────

PATCH        = 64
HALF         = PATCH // 2
MIN_SIZE_MM  = 5.5   # nodules smaller than this are not actionable

_CBM_WEIGHTS = {
    "spiculation": 0.386, "margin": 0.251, "lobulation": 0.156,
    "subtlety": 0.050, "internalStructure": 0.020,
    "sphericity": -0.082, "texture": -0.198, "calcification": -0.412,
}


def _make_xai_heatmap(seg_mask, concept_scores):
    from scipy.ndimage import gaussian_filter
    total_pos = sum(abs(w) for w in _CBM_WEIGHTS.values())
    raw  = sum(_CBM_WEIGHTS.get(k, 0) * v for k, v in concept_scores.items())
    heat = float(np.clip((raw / total_pos + 1) / 2, 0, 1))
    blob = gaussian_filter(seg_mask.astype(np.float32), sigma=10)
    if blob.max() > 0: blob /= blob.max()
    if heat < 0.5:
        t = heat * 2; r, g, b = int(255 * t), 255, 0
    else:
        t = (heat - 0.5) * 2; r, g, b = 255, int(255 * (1 - t)), 0
    rgba = np.zeros((PATCH, PATCH, 4), dtype=np.uint8)
    rgba[..., 0] = r; rgba[..., 1] = g; rgba[..., 2] = b
    rgba[..., 3] = (blob * 200).astype(np.uint8)
    return rgba


def _lung_location(y, x, H, W):
    is_right = x < W / 2
    y_pct    = y / H
    if y_pct < 0.33:   lobe = "UL"
    elif y_pct < 0.66: lobe = "ML" if is_right else "UL"
    else:               lobe = "LL"
    return ("R" if is_right else "L") + lobe


def _build_nodule_results(findings, volume, spacing, dicom_folder, study_id):
    import torch
    from PIL import Image
    Z, H, W    = volume.shape
    st, sy, sx = spacing
    masks_dir  = Path(dicom_folder) / "masks"; masks_dir.mkdir(exist_ok=True)
    _, stage2  = _get_models()
    vol_norm   = np.clip(volume, -1000, 1000).astype(np.float32)
    vol_norm   = (vol_norm + 1000) / 2000
    results    = []

    for i, det in enumerate(findings):
        z, y, x  = det["location_voxel"]
        mal_prob = det["malignancy_prob"]
        risk     = "High" if mal_prob >= 0.7 else "Medium" if mal_prob >= 0.4 else "Low"
        center_seg  = det["segmentation"]
        center_mask = center_seg > 0.5
        area_px     = float(center_mask.sum())
        size_mm     = max(3.0, 2.0 * np.sqrt(area_px / np.pi) * sy)
        if size_mm < MIN_SIZE_MM:
            continue

        if area_px > 0:
            ys_l, xs_l = np.where(center_mask)
            y = int(np.clip(y + int(round(float(ys_l.mean()))) - HALF, HALF, H - HALF))
            x = int(np.clip(x + int(round(float(xs_l.mean()))) - HALF, HALF, W - HALF))

        R_mm  = size_mm / 2.0
        z_ext = max(3, int(np.ceil(R_mm / st)))
        all_z = list(range(max(0, z - z_ext), min(Z, z + z_ext + 1)))
        concept_scores = det["concepts"]
        seg_color = {"High": (220, 40, 40), "Medium": (230, 130, 30), "Low": (30, 180, 60)}[risk]
        heat_rgba = _make_xai_heatmap(center_seg, concept_scores)
        mask_paths = {}

        for zi in all_z:
            if zi == z:
                seg_prob = center_seg
            elif 3 <= zi < Z - 3 and HALF <= y < H - HALF and HALF <= x < W - HALF:
                patch = vol_norm[zi - 3: zi + 4, y - HALF: y + HALF, x - HALF: x + HALF]
                if patch.shape != (7, PATCH, PATCH): continue
                t = torch.from_numpy(patch[None]).float()
                with torch.no_grad():
                    out = stage2(t)
                seg_prob = torch.sigmoid(out["segmentation"])[0, 0].cpu().numpy()
            else:
                continue

            slice_mask = seg_prob > 0.5
            if not slice_mask.any(): continue

            seg_rgba       = np.zeros((PATCH, PATCH, 4), dtype=np.uint8)
            seg_rgba[..., :3] = seg_color
            seg_rgba[..., 3]  = np.where(slice_mask, 180, 0).astype(np.uint8)
            Image.fromarray(seg_rgba, "RGBA").save(str(masks_dir / f"nodule_{i+1}_slice_{zi}_seg.png"))

            scale = float(np.sqrt(max(0.0, 1.0 - ((abs(zi-z)*st)/R_mm)**2))) if R_mm > 0 else 1.0
            heat_copy = heat_rgba.copy()
            heat_copy[..., 3] = np.clip(heat_rgba[..., 3] * scale, 0, 255).astype(np.uint8)
            Image.fromarray(heat_copy, "RGBA").save(str(masks_dir / f"nodule_{i+1}_slice_{zi}_heat.png"))

            mask_paths[f"{zi}_seg"]  = f"masks/nodule_{i+1}_slice_{zi}_seg.png"
            mask_paths[f"{zi}_heat"] = f"masks/nodule_{i+1}_slice_{zi}_heat.png"

        results.append({
            "nodule_number":    i + 1,
            "center_voxel":     {"z": z, "y": y, "x": x},
            "size_mm":          round(size_mm, 1),
            "location":         _lung_location(y, x, H, W),
            "detection_prob":   round(det["detection_prob"], 4),
            "malignancy_prob":  round(mal_prob, 4),
            "risk_level":       risk,
            "all_slice_indices": all_z,
            "coordinates_pct":  {"x": round(x / W * 100, 2), "y": round(y / H * 100, 2)},
            "concept_scores":   {k: round(v, 4) for k, v in concept_scores.items()},
            "mask_paths":       mask_paths,
        })
    return results


# ─── Ground Truth endpoint ────────────────────────────────────────────────────

GT_CSV = SERVICE_DIR / "data" / "nodules.csv"


@app.post("/ground-truth")
def ground_truth(request: GroundTruthRequest):
    import csv, pydicom, re
    folder = Path(request.dicom_folder)
    if not folder.exists():   raise HTTPException(status_code=404, detail="DICOM folder not found")
    if not GT_CSV.exists():   raise HTTPException(status_code=404, detail="nodules.csv not found")
    dcm_files = [f for f in os.listdir(folder) if f.lower().endswith(".dcm")]
    if not dcm_files:         raise HTTPException(status_code=404, detail="No DICOM files found")

    first      = pydicom.dcmread(str(folder / dcm_files[0]), stop_before_pixels=True)
    series_uid = str(getattr(first, "SeriesInstanceUID", ""))
    gt_rows    = []
    with open(str(GT_CSV), newline="") as f:
        for row in csv.DictReader(f):
            if row["seriesuid"] == series_uid:
                gt_rows.append(row)
    if not gt_rows:
        return {"series_uid": series_uid, "ground_truth": [], "message": "No annotations for this series"}

    def _z_key(fname):
        try:
            d = pydicom.dcmread(str(folder / fname), stop_before_pixels=True)
            if hasattr(d, "ImagePositionPatient"): return float(d.ImagePositionPatient[2])
            if hasattr(d, "SliceLocation"):        return float(d.SliceLocation)
        except Exception: pass
        nums = re.findall(r"\d+", fname); return float(nums[-1]) if nums else 0.0

    sorted_files = sorted(dcm_files, key=_z_key)
    z_positions  = []
    for fname in sorted_files:
        try:
            d = pydicom.dcmread(str(folder / fname), stop_before_pixels=True)
            z_positions.append(float(d.ImagePositionPatient[2]) if hasattr(d, "ImagePositionPatient") else 0.0)
        except Exception: z_positions.append(0.0)

    ref       = pydicom.dcmread(str(folder / sorted_files[0]), stop_before_pixels=True)
    origin_x  = float(ref.ImagePositionPatient[0]); origin_y = float(ref.ImagePositionPatient[1])
    ps        = getattr(ref, "PixelSpacing", [1.0, 1.0])
    row_sp    = float(ps[0]); col_sp = float(ps[1])
    slice_t   = float(getattr(ref, "SliceThickness", 1.0))

    results = []
    for row in gt_rows:
        cx, cy, cz = float(row["coordX"]), float(row["coordY"]), float(row["coordZ"])
        diam       = float(row["diameter_mm"])
        malignancy = float(row["malignancy_mean"]) if row["malignancy_mean"] else 0.0
        si         = int(np.argmin([abs(z - cz) for z in z_positions]))
        half_z     = max(1, int(np.ceil(diam / (2.0 * slice_t))))
        px_col     = (cx - origin_x) / col_sp
        px_row     = (cy - origin_y) / row_sp

        # Read HU value at nodule center to help identify nodule type
        hu_center = None
        try:
            dcm_c = pydicom.dcmread(str(folder / sorted_files[si]))
            slope = float(getattr(dcm_c, "RescaleSlope", 1.0))
            intercept = float(getattr(dcm_c, "RescaleIntercept", -1024.0))
            r, c = int(round(px_row)), int(round(px_col))
            H_img, W_img = dcm_c.pixel_array.shape
            if 0 <= r < H_img and 0 <= c < W_img:
                hu_center = round(float(dcm_c.pixel_array[r, c]) * slope + intercept, 0)
        except Exception:
            pass

        results.append({
            "idx": int(row["lidc_nodule_idx"]), "slice_index": si,
            "slice_min": max(0, si - half_z), "slice_max": min(len(sorted_files)-1, si+half_z),
            "pixel_x": round(px_col, 1),
            "pixel_y": round(px_row, 1),
            "diameter_mm": round(diam, 1), "malignancy": round(malignancy, 2),
            "hu_center": hu_center,
            "coord_world": {"x": round(cx, 2), "y": round(cy, 2), "z": round(cz, 2)},
        })
    results.sort(key=lambda r: r["slice_index"])
    return {"series_uid": series_uid, "slice_thickness_mm": round(slice_t, 4),
            "pixel_spacing_mm": round(col_sp, 6), "ground_truth": results}


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3002)
