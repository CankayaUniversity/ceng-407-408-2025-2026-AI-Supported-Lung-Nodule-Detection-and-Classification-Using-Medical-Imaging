import os
import numpy as np
import pydicom
import cv2

def list_dicom_files(series_dir: str):
    out = []
    for root, _, files in os.walk(series_dir):
        for f in files:
            if f.lower().endswith(".dcm"):
                out.append(os.path.join(root, f))
    return out

def _safe_int(x, default=0):
    try:
        return int(x)
    except Exception:
        return default

def load_dicom_series_hu(series_dir: str):
    """
    Returns:
      vol: (Z,H,W) float32 in HU
      z_positions: (Z,) float64 (ImagePositionPatient[2] if available else SliceLocation else InstanceNumber)
      meta: dict with some DICOM fields
    """
    files = list_dicom_files(series_dir)
    if not files:
        raise FileNotFoundError(f"No DICOM files found in: {series_dir}")

    headers = []
    for fp in files:
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

    # sort by InstanceNumber primarily; fallback by z if needed
    headers.sort(key=lambda t: (t[1], 0 if t[2] is None else t[2]))

    imgs = []
    z_positions = []
    first_ds = None

    for fp, inst, z in headers:
        try:
            ds = pydicom.dcmread(fp, force=True)
            if first_ds is None:
                first_ds = ds

            arr = ds.pixel_array.astype(np.int16)
            slope = float(getattr(ds, "RescaleSlope", 1.0))
            intercept = float(getattr(ds, "RescaleIntercept", 0.0))
            hu = arr.astype(np.float32) * slope + intercept
            imgs.append(hu)

            # if z missing, use inst as proxy
            if z is None:
                z_positions.append(float(inst))
            else:
                z_positions.append(float(z))
        except Exception:
            continue

    if not imgs:
        raise RuntimeError(f"Could not read pixel data from: {series_dir}")

    vol = np.stack(imgs, axis=0).astype(np.float32)
    z_positions = np.array(z_positions, dtype=np.float64)

    meta = {}
    if first_ds is not None:
        meta = {
            "Rows": int(getattr(first_ds, "Rows", vol.shape[1])),
            "Columns": int(getattr(first_ds, "Columns", vol.shape[2])),
            "PixelSpacing": getattr(first_ds, "PixelSpacing", None),
            "SliceThickness": getattr(first_ds, "SliceThickness", None),
            "StudyInstanceUID": getattr(first_ds, "StudyInstanceUID", None),
            "SeriesInstanceUID": getattr(first_ds, "SeriesInstanceUID", None),
        }
    return vol, z_positions, meta

def hu_to_uint8(img_hu: np.ndarray, hu_min=-1000.0, hu_max=400.0):
    x = np.clip(img_hu, hu_min, hu_max)
    x = (x - hu_min) / (hu_max - hu_min + 1e-8)
    x = (x * 255.0).astype(np.uint8)
    return x

def preprocess_slice_2p5d(vol_hu: np.ndarray, z: int, out_size=256,
                          hu_min=-1000.0, hu_max=400.0):
    """
    vol_hu: (Z,H,W)
    return: (3,out_size,out_size) float32 in [0,1]
    """
    Z, H, W = vol_hu.shape
    z = int(np.clip(z, 1, Z-2))

    stack = np.stack([vol_hu[z-1], vol_hu[z], vol_hu[z+1]], axis=0)  # (3,H,W)
    stack = np.clip(stack, hu_min, hu_max)
    stack = (stack - hu_min) / (hu_max - hu_min + 1e-8)  # [0,1]

    # resize each channel
    resized = []
    for c in range(3):
        ch = stack[c]
        ch_rs = cv2.resize(ch, (out_size, out_size), interpolation=cv2.INTER_AREA)
        resized.append(ch_rs)
    x = np.stack(resized, axis=0).astype(np.float32)
    return x
