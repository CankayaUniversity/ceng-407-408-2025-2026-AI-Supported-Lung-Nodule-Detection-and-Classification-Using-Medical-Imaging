# =========================
# INDEX CONTRACT (BUNU SAKLA)
# =========================
# slice_probs[i]  <->  dicom_files_sorted[i]  <->  cam_z{i}.png
# UI hangi slice'ı gösteriyorsa (i), her şey o i üzerinden okunacak.
# Sıralama asla "dosya adına göre" varsayılmayacak; inference'ın ürettiği dicom_files_sorted listesi referans.

import os
import json
import numpy as np
import torch
from typing import Optional, Dict, Any, List, Tuple
from PIL import Image

from .dicom_utils import load_dicom_series_hu
from .model import build_model
from .inference import predict_series_slices, gradcam_overlay_for_slice  # mevcut fonksiyonlarını kullanıyoruz


# -------------------------
# Helpers
# -------------------------

def _series_cache_key(series_path: str) -> str:
    return series_path.replace("\\", "_").replace(":", "").replace("/", "_")


def _sorted_dicom_files_by_inference(series_dir: str) -> List[str]:
    """
    IMPORTANT:
    UI'nin sırası = inference sırası olsun diye,
    DICOM sıralamasını load_dicom_series_hu içindeki mantıkla AYNI yapıyoruz.
    load_dicom_series_hu zaten dosyaları okuyup InstanceNumber ağırlıklı sıralıyor.
    Burada sadece "o sıralı fp listesini" geri çıkarmak için küçük bir tekrar yapıyoruz.

    Eğer istersen bunu load_dicom_series_hu içine meta olarak da ekleyebiliriz,
    ama şimdilik en risksiz yöntem: aynı sorting mantığını burada yeniden kullanmak.
    """
    import pydicom

    def _safe_int(x, default=0):
        try:
            return int(x)
        except Exception:
            return default

    # tüm dicomları topla
    dcm_files = []
    for root, _, files in os.walk(series_dir):
        for f in files:
            if f.lower().endswith(".dcm"):
                dcm_files.append(os.path.join(root, f))
    if not dcm_files:
        raise FileNotFoundError(f"No DICOM files found in: {series_dir}")

    headers = []
    for fp in dcm_files:
        try:
            ds = pydicom.dcmread(fp, force=True, stop_before_pixels=True)
            inst = _safe_int(getattr(ds, "InstanceNumber", 0), 0)
            ipp = getattr(ds, "ImagePositionPatient", None)
            z = None
            if ipp is not None and len(ipp) >= 3:
                try:
                    z = float(ipp[2])
                except Exception:
                    z = None
            if z is None:
                sl = getattr(ds, "SliceLocation", None)
                try:
                    z = float(sl) if sl is not None else None
                except Exception:
                    z = None
            headers.append((fp, inst, z))
        except Exception:
            continue

    # InstanceNumber primary, z secondary (load_dicom_series_hu ile aynı)
    headers.sort(key=lambda t: (t[1], 0 if t[2] is None else t[2]))
    sorted_files = [fp for fp, _, _ in headers]
    return sorted_files


def _ensure_dir(p: str):
    os.makedirs(p, exist_ok=True)


def _write_json(path: str, obj: Dict[str, Any]):
    _ensure_dir(os.path.dirname(path) or ".")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _load_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# -------------------------
# Main: Offline inference -> JSON contract
# -------------------------

@torch.inference_mode()
def run_inference_offline(
    series_dir: str,
    weights_path: str,
    backbone: str = "resnet18",
    out_dir: str = "outputs",
    json_name: str = "result.json",
    cam_mode: str = "on_demand",  # "on_demand" | "precomputed"
    cam_dirname: str = "cam",     # out_dir/cam/
    cam_pattern: str = "cam_z{index}.png",
    precompute_cam: bool = False, # istersen cam_mode="precomputed" iken otomatik üretir
    device: Optional[str] = None,
    batch_size: int = 32,
) -> str:
    """
    Produces:
      - outputs/<series_key>/result.json
      - optionally outputs/<series_key>/cam/cam_z{index}.png (precomputed)

    Returns:
      path to written JSON
    """

    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    # 1) Model yükle
    if not os.path.isfile(weights_path):
        raise FileNotFoundError(f"Weights not found: {weights_path}")

    model = build_model(backbone=backbone).to(device)
    sd = torch.load(weights_path, map_location=device)
    model.load_state_dict(sd)
    model.eval()

    # 2) DICOM vol + meta
    vol_hu, zpos, meta = load_dicom_series_hu(series_dir)
    Z = int(vol_hu.shape[0])
    if Z < 3:
        raise RuntimeError(f"Series has too few slices (Z={Z}). Need at least 3 for 2.5D.")

    # 3) DICOM dosyalarını inference sırası ile çıkar (UI index contract için)
    dicom_files_sorted = _sorted_dicom_files_by_inference(series_dir)
    # Güvenlik: vol_hu Z ile file sayısı uyuşmalı (okunamayan ds varsa sapabilir)
    # Bu nadiren olur ama olursa UI contract bozulur. En iyisi burada fail etmek.
    if len(dicom_files_sorted) != Z:
        raise RuntimeError(
            f"DICOM file count ({len(dicom_files_sorted)}) != volume slices ({Z}). "
            f"Some DICOMs may have failed to read. Fix series or adjust loader to keep alignment."
        )

    # 4) probs üret
    probs = predict_series_slices(model, vol_hu, device=device, batch_size=batch_size).astype(np.float32)
    best_idx = int(np.argmax(probs))
    best_prob = float(probs[best_idx])

    # 5) JSON contract
    series_key = _series_cache_key(series_dir)
    series_out_dir = os.path.join(out_dir, series_key)
    _ensure_dir(series_out_dir)

    cam_dir = os.path.join(series_out_dir, cam_dirname)
    if cam_mode not in ["on_demand", "precomputed"]:
        raise ValueError("cam_mode must be 'on_demand' or 'precomputed'.")

    result = {
        "schema_version": "1.0",
        "series_path": os.path.abspath(series_dir),
        "study_instance_uid": meta.get("StudyInstanceUID", None),
        "series_instance_uid": meta.get("SeriesInstanceUID", None),

        # core contract
        "dicom_files_sorted": [os.path.abspath(p) for p in dicom_files_sorted],
        "slice_probs": [float(x) for x in probs.tolist()],
        "num_slices": int(Z),

        # navigation
        "best_slice_index": best_idx,
        "best_prob": best_prob,

        # CAM contract
        "cam_mode": cam_mode,
        "cam_cache_dir": os.path.abspath(cam_dir),
        "cam_pattern": cam_pattern,

        # model info (nice-to-have)
        "model_backbone": backbone,
        "weights_path": os.path.abspath(weights_path),
    }

    json_path = os.path.join(series_out_dir, json_name)
    _write_json(json_path, result)

    # 6) İstersen precompute CAM
    if cam_mode == "precomputed" and precompute_cam:
        _ensure_dir(cam_dir)
        for i in range(Z):
            # 2.5D için borderlar (0 ve Z-1) zaten clipleniyor, ama UI genelde görsün diye üretilebilir.
            # Biz yine de 1..Z-2 aralığı için üretelim; borderlarda boş bırakırız.
            if i == 0 or i == Z - 1:
                continue
            get_or_build_cam_for_index(
                json_path=json_path,
                index=i,
                device=device,
                out_size=512,
                image_weight=0.35,
            )

    return json_path


# -------------------------
# On-demand CAM builder (UI toggle)
# -------------------------
def get_or_build_cam_for_index(
    json_path: str,
    index: int,
    device: Optional[str] = None,
    out_size: int = 512,
    image_weight: float = 0.35,
) -> str:
    # Grad-CAM için gradient şart
    if device is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"

    data = _load_json(json_path)

    series_dir = data["series_path"]
    weights_path = data["weights_path"]
    backbone = data.get("model_backbone", "resnet18")
    cam_dir = data["cam_cache_dir"]
    cam_pattern = data.get("cam_pattern", "cam_z{index}.png")

    _ensure_dir(cam_dir)

    Z = int(data["num_slices"])
    idx = int(np.clip(int(index), 1, Z - 2))
    cam_path = os.path.join(cam_dir, cam_pattern.format(index=idx))

    if os.path.isfile(cam_path):
        return cam_path

    # Model yükle
    model = build_model(backbone=backbone).to(device)
    sd = torch.load(weights_path, map_location=device)
    model.load_state_dict(sd)
    model.eval()

    # Vol yükle
    vol_hu, _zpos, _meta = load_dicom_series_hu(series_dir)

    # ✅ Grad-CAM için grad aç
    with torch.enable_grad():
        _overlay_img, cam01 = gradcam_overlay_for_slice(
            model=model,
            backbone=backbone,
            vol_hu=vol_hu,
            slice_index=idx,
            device=device,
            out_size=out_size,
            image_weight=image_weight,
        )

    Image.fromarray((np.clip(cam01, 0, 1) * 255).astype(np.uint8)).save(cam_path)
    return cam_path
