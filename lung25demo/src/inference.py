import os
import io
import base64
import numpy as np
import torch
from PIL import Image, ImageFilter

# -----------------------------
# Grad-CAM (optional)
# -----------------------------
_GRADCAM_AVAILABLE = True
_GRADCAM_IMPORT_ERROR = None

try:
    from pytorch_grad_cam import GradCAM
    from pytorch_grad_cam.utils.image import show_cam_on_image
    from pytorch_grad_cam.utils.model_targets import BinaryClassifierOutputTarget
except Exception as e:
    _GRADCAM_AVAILABLE = False
    _GRADCAM_IMPORT_ERROR = str(e)

from .dicom_utils import load_dicom_series_hu, preprocess_slice_2p5d
from .model import build_model, gradcam_target_layers


def _series_cache_key(series_path: str):
    return series_path.replace("\\", "_").replace(":", "").replace("/", "_")


def load_or_build_cache(series_path: str, cache_dir: str | None = None):
    vol, zpos, meta = load_dicom_series_hu(series_path)
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        fp = os.path.join(cache_dir, _series_cache_key(series_path) + ".npz")
        if not os.path.isfile(fp):
            np.savez_compressed(fp, vol=vol.astype(np.float32), z_positions=zpos.astype(np.float64))
    return vol, zpos, meta


@torch.inference_mode()
def predict_series_slices(model, vol_hu: np.ndarray, device="cpu", batch_size=32):
    Z = vol_hu.shape[0]
    probs = np.zeros((Z,), dtype=np.float32)

    model.eval()
    for start in range(1, Z - 1, batch_size):
        end = min(Z - 1, start + batch_size)
        xs, idxs = [], []
        for z in range(start, end):
            x = preprocess_slice_2p5d(vol_hu, z, out_size=256)  # (3,256,256) in [0,1]
            xs.append(x)
            idxs.append(z)

        X = torch.from_numpy(np.stack(xs, axis=0)).to(device)
        logits = model(X)
        p = torch.sigmoid(logits).detach().cpu().numpy().reshape(-1)

        for i, z in enumerate(idxs):
            probs[z] = float(p[i])

    return probs


def _normalize01(cam: np.ndarray) -> np.ndarray:
    cam = np.maximum(cam, 0)
    mx = float(cam.max())
    if mx < 1e-8:
        return np.zeros_like(cam, dtype=np.float32)
    return (cam / mx).astype(np.float32)


def _hard_cut_borders(cam01: np.ndarray, top_frac=0.14, side_frac=0.04, bottom_frac=0.03) -> np.ndarray:
    H, W = cam01.shape
    top = int(top_frac * H)
    side = int(side_frac * W)
    bottom = int(bottom_frac * H)

    cam01 = cam01.copy()
    if top > 0:
        cam01[:top, :] = 0
    if side > 0:
        cam01[:, :side] = 0
        cam01[:, -side:] = 0
    if bottom > 0:
        cam01[-bottom:, :] = 0
    return cam01


def _topk_mask(cam01: np.ndarray, keep_frac: float = 0.02) -> np.ndarray:
    cam01 = np.clip(cam01, 0, 1)
    flat = cam01.reshape(-1)

    k = max(1, int(len(flat) * keep_frac))
    thr = np.partition(flat, -k)[-k]
    return (cam01 >= thr).astype(np.float32)


def _blur_cam_pil(cam01: np.ndarray, radius: float = 2.0) -> np.ndarray:
    cam_u8 = (np.clip(cam01, 0, 1) * 255).astype(np.uint8)
    pil = Image.fromarray(cam_u8)
    pil = pil.filter(ImageFilter.GaussianBlur(radius=radius))
    out = np.asarray(pil).astype(np.float32) / 255.0
    return out


def _apply_demo_pop(cam01: np.ndarray, keep_frac=0.02, gamma=0.65, blur_radius=2.0) -> np.ndarray:
    cam01 = _normalize01(cam01)
    cam01 = _blur_cam_pil(cam01, radius=blur_radius)
    cam01 = _normalize01(cam01)

    m = _topk_mask(cam01, keep_frac=keep_frac)
    cam01 = cam01 * m

    cam01 = _normalize01(cam01)
    cam01 = np.power(cam01, gamma).astype(np.float32)
    return cam01


def gradcam_overlay_for_slice(
    model,
    backbone: str,
    vol_hu: np.ndarray,
    slice_index: int,
    device="cpu",
    out_size: int = 512,
    image_weight: float = 0.35,
    top_frac: float = 0.14,
    side_frac: float = 0.04,
    bottom_frac: float = 0.03,
    keep_frac: float = 0.02,
    gamma: float = 0.65,
    blur_radius: float = 2.0,
):
    if not _GRADCAM_AVAILABLE:
        raise RuntimeError(
            "Grad-CAM paketi bulunamadı. (pytorch_grad_cam import edilemedi)\n"
            f"Hata: {_GRADCAM_IMPORT_ERROR}\n\n"
            "Çözüm (doğru venv açıkken):\n"
            "  python -m pip install grad-cam\n"
        )

    model.eval()

    x = preprocess_slice_2p5d(vol_hu, slice_index, out_size=out_size)  # (3,H,W)
    X = torch.from_numpy(x[None, ...]).to(device)

    target_layers = gradcam_target_layers(model, backbone)
    cam = GradCAM(model=model, target_layers=target_layers)

    targets = [BinaryClassifierOutputTarget(1)]
    grayscale_cam = cam(input_tensor=X, targets=targets)[0]  # (H,W)

    cam01 = _normalize01(grayscale_cam)
    cam01 = _hard_cut_borders(cam01, top_frac=top_frac, side_frac=side_frac, bottom_frac=bottom_frac)
    cam01 = _apply_demo_pop(cam01, keep_frac=keep_frac, gamma=gamma, blur_radius=blur_radius)

    base = np.clip(x.transpose(1, 2, 0), 0, 1)
    overlay = show_cam_on_image(base, cam01, use_rgb=True, image_weight=image_weight)
    return Image.fromarray(overlay), cam01


def pil_to_base64_png(pil_img: Image.Image):
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def run_inference(
    series_path: str,
    weights_path: str,
    backbone: str = "resnet18",
    cache_dir: str = "cache",
    slice_index: int | None = None,
    auto_best: bool = True,
    return_base64: bool = False,
    out_dir: str = "outputs",
    # demo knobs
    out_size: int = 512,
    image_weight: float = 0.35,
    top_frac: float = 0.14,
    side_frac: float = 0.04,
    bottom_frac: float = 0.03,
    keep_frac: float = 0.02,
    gamma: float = 0.65,
    blur_radius: float = 2.0,
):
    os.makedirs(out_dir, exist_ok=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = build_model(backbone=backbone).to(device)

    sd = torch.load(weights_path, map_location=device)
    model.load_state_dict(sd)
    model.eval()

    vol_hu, zpos, meta = load_or_build_cache(series_path, cache_dir=cache_dir)
    probs = predict_series_slices(model, vol_hu, device=device, batch_size=32)

    if auto_best or slice_index is None:
        best_z = int(np.argmax(probs))
    else:
        best_z = int(np.clip(int(slice_index), 1, vol_hu.shape[0] - 2))

    best_prob = float(probs[best_z])
    study_id = meta.get("StudyInstanceUID", None) or os.path.basename(series_path)

    finding = {
        "slice_index": best_z,
        "confidence": best_prob,
        "malignancy_prob": best_prob,
        "gradcam_enabled": bool(_GRADCAM_AVAILABLE),
    }

    # If Grad-CAM available: produce overlay + save outputs
    if _GRADCAM_AVAILABLE:
        overlay_img, cam01 = gradcam_overlay_for_slice(
            model=model,
            backbone=backbone,
            vol_hu=vol_hu,
            slice_index=best_z,
            device=device,
            out_size=out_size,
            image_weight=image_weight,
            top_frac=top_frac,
            side_frac=side_frac,
            bottom_frac=bottom_frac,
            keep_frac=keep_frac,
            gamma=gamma,
            blur_radius=blur_radius,
        )

        heatmap_path = os.path.join(out_dir, f"gradcam_z{best_z}.png")
        overlay_img.save(heatmap_path)

        cam_path = os.path.join(out_dir, f"cam_z{best_z}.png")
        Image.fromarray((np.clip(cam01, 0, 1) * 255).astype(np.uint8)).save(cam_path)

        finding["heatmap_path"] = heatmap_path
        finding["cam_path"] = cam_path

        if return_base64:
            finding["heatmap_base64_png"] = pil_to_base64_png(overlay_img)

        out = {"study_id": study_id, "findings": [finding]}
        return out, overlay_img, probs

    # If Grad-CAM missing: return a placeholder image + message
    finding["gradcam_error"] = _GRADCAM_IMPORT_ERROR or "pytorch_grad_cam not available"
    out = {"study_id": study_id, "findings": [finding]}

    placeholder = Image.new("RGB", (512, 512), color=(0, 0, 0))
    return out, placeholder, probs
