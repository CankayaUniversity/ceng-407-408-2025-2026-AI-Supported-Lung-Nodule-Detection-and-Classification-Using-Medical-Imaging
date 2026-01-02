import os
import json
import random
import argparse
import numpy as np
import pandas as pd
from tqdm import tqdm

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, WeightedRandomSampler
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from src.dicom_utils import load_dicom_series_hu
from src.lidc_xml import parse_lidc_xml_rois, map_roi_z_to_slice_indices
from src.dataset import Slice25DDataset
from src.model import build_model


def norm_colnames(df: pd.DataFrame):
    df.columns = [c.strip() for c in df.columns]
    return df


def find_series_dirs(manifest_lidc_root: str):
    """
    Find series folders that contain .dcm and .xml in same dir.
    Returns mapping: (patient_id, series_folder) -> series_path
    """
    mapping = {}
    for root, _, files in os.walk(manifest_lidc_root):
        has_dcm = any(f.lower().endswith(".dcm") for f in files)
        has_xml = any(f.lower().endswith(".xml") for f in files)
        if not (has_dcm and has_xml):
            continue
        series_path = root
        series_folder = os.path.basename(series_path)

        parts = series_path.split(os.sep)
        patient_id = next((p for p in parts if p.startswith("LIDC-IDRI-")), None)
        if patient_id:
            mapping[(patient_id, series_folder)] = series_path
    return mapping


def series_cache_key(series_path: str):
    return series_path.replace("\\", "_").replace(":", "").replace("/", "_")


def build_cache_for_series(series_path: str, cache_dir: str):
    os.makedirs(cache_dir, exist_ok=True)
    fp = os.path.join(cache_dir, series_cache_key(series_path) + ".npz")
    if os.path.isfile(fp):
        return fp

    vol, zpos, _meta = load_dicom_series_hu(series_path)
    np.savez_compressed(fp, vol=vol.astype(np.float32), z_positions=zpos.astype(np.float64))
    return fp


def load_cached_series(series_path: str, cache_dir: str):
    fp = os.path.join(cache_dir, series_cache_key(series_path) + ".npz")
    if not os.path.isfile(fp):
        fp = build_cache_for_series(series_path, cache_dir)
    data = np.load(fp, allow_pickle=True)
    vol = data["vol"].astype(np.float32)
    zpos = data["z_positions"].astype(np.float64)
    return vol, zpos


def find_xml_in_series(series_path: str):
    """CSV xml_path bozuksa: series klasöründen .xml bul."""
    try:
        files = [f for f in os.listdir(series_path) if f.lower().endswith(".xml")]
        if not files:
            return None
        return os.path.join(series_path, files[0])
    except Exception:
        return None


def collect_positive_slices(xml_path: str, z_positions: np.ndarray, k=1):
    rois = parse_lidc_xml_rois(xml_path)
    pos = set()
    for n in rois:
        idxs = map_roi_z_to_slice_indices(n["roi_z_positions"], z_positions)
        for z in idxs:
            for dz in range(-k, k + 1):
                pos.add(int(np.clip(z + dz, 0, len(z_positions) - 1)))
    return sorted(pos)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest_root", type=str, required=True,
                    help=".../manifest-xxxx/LIDC-IDRI (folder that contains patient dirs)")
    ap.add_argument("--reader_csv", type=str, required=True, help="lidc_reader_level.csv path")
    ap.add_argument("--cache_dir", type=str, default="cache")
    ap.add_argument("--out_dir", type=str, default="outputs")

    # ATTENTION: yeni backbone seçenekleri eklendi
    ap.add_argument("--backbone", type=str, default="resnet18_ag",
                    choices=["resnet18", "resnet34", "densenet121", "resnet18_ag", "resnet34_ag"])

    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--batch_size", type=int, default=32)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--k", type=int, default=1, help="positive slice expansion ±k")
    ap.add_argument("--neg_ratio", type=float, default=1.0, help="negatives per positive (approx)")
    ap.add_argument("--seed", type=int, default=63)
    ap.add_argument("--val_size", type=float, default=0.2)
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    os.makedirs(args.out_dir, exist_ok=True)
    os.makedirs(args.cache_dir, exist_ok=True)

    df = pd.read_csv(args.reader_csv)
    df = norm_colnames(df)

    need = {"patient_id", "series_folder", "xml_path", "malignancy"}
    if not need.issubset(set(df.columns)):
        raise RuntimeError(f"reader_csv missing columns. Need={need} have={set(df.columns)}")

    # group by (patient_id, series_folder) and compute mean malignancy
    g = df.groupby(["patient_id", "series_folder"], as_index=False).agg(
        malignancy_mean=("malignancy", "mean"),
        xml_path=("xml_path", "first")
    )
    g["label"] = (g["malignancy_mean"] >= 3.0).astype(int)

    series_map = find_series_dirs(args.manifest_root)

    rows = []
    for _, r in g.iterrows():
        key = (str(r["patient_id"]).strip(), str(r["series_folder"]).strip())
        if key in series_map:
            rows.append({
                "patient_id": key[0],
                "series_folder": key[1],
                "series_path": series_map[key],
                "xml_path": str(r["xml_path"]) if "xml_path" in r else "",
                "label": int(r["label"]),
                "malignancy_mean": float(r["malignancy_mean"]),
            })

    use_df = pd.DataFrame(rows).drop_duplicates()
    if use_df.empty:
        raise RuntimeError("No (patient_id, series_folder) matched on disk. series_folder mismatch olabilir.")

    # patient-level stratified split
    patient_labels = use_df.groupby("patient_id")["label"].max().reset_index()
    tr_p, va_p = train_test_split(
        patient_labels["patient_id"].values,
        test_size=args.val_size,
        random_state=args.seed,
        stratify=patient_labels["label"].values
    )
    tr_set = set(tr_p.tolist())
    va_set = set(va_p.tolist())

    train_series = use_df[use_df.patient_id.isin(tr_set)].reset_index(drop=True)
    val_series = use_df[use_df.patient_id.isin(va_set)].reset_index(drop=True)

    print("[i] series:", len(use_df), "| train series:", len(train_series), "| val series:", len(val_series))
    print("[i] label dist train:\n", train_series["label"].value_counts())
    print("[i] label dist val:\n", val_series["label"].value_counts())

    # build slice items
    def build_items(series_df):
        items = []
        missing_xml_pos = 0
        roi_empty_pos = 0
        pos_series_seen = 0

        for _, r in tqdm(series_df.iterrows(), total=len(series_df), desc="build_items"):
            series_path = r["series_path"]
            patient_id = r["patient_id"]
            series_id = f"{patient_id}::{r['series_folder']}"
            label = int(r["label"])

            # cache & load
            vol, zpos = load_cached_series(series_path, args.cache_dir)
            Z = vol.shape[0]
            if Z < 3:
                continue

            xml_path = str(r.get("xml_path", "")).strip()

            # CSV xml_path bozuksa series içinden XML bul
            if (not xml_path) or (not os.path.isfile(xml_path)):
                xml2 = find_xml_in_series(series_path)
                if xml2:
                    xml_path = xml2

            pos_slices = []
            if label == 1:
                pos_series_seen += 1
                if (not xml_path) or (not os.path.isfile(xml_path)):
                    missing_xml_pos += 1
                    continue
                pos_slices = collect_positive_slices(xml_path, zpos, k=args.k)
                if len(pos_slices) == 0:
                    roi_empty_pos += 1
                    continue

            pos_set = set(pos_slices)

            # negatives from same series not in pos_set (avoid borders for 2.5D)
            candidates = [z for z in range(1, Z - 1) if z not in pos_set]
            random.shuffle(candidates)

            if label == 1:
                n_pos = len(pos_slices)
                n_neg = int(max(1, round(n_pos * args.neg_ratio)))
                neg_slices = candidates[:n_neg]

                for z in pos_slices:
                    if 1 <= z <= Z - 2:
                        items.append({
                            "series_path": series_path, "z": int(z), "y": 1,
                            "patient_id": patient_id, "series_id": series_id
                        })
                for z in neg_slices:
                    items.append({
                        "series_path": series_path, "z": int(z), "y": 0,
                        "patient_id": patient_id, "series_id": series_id
                    })
            else:
                n_neg = min(40, len(candidates))
                for z in candidates[:n_neg]:
                    items.append({
                        "series_path": series_path, "z": int(z), "y": 0,
                        "patient_id": patient_id, "series_id": series_id
                    })

        print(f"[debug] positive series seen: {pos_series_seen} | missing xml: {missing_xml_pos} | roi_empty: {roi_empty_pos}")
        return items

    train_items = build_items(train_series)
    val_items = build_items(val_series)

    train_pos = sum(1 for it in train_items if it["y"] == 1)
    train_neg = sum(1 for it in train_items if it["y"] == 0)
    val_pos = sum(1 for it in val_items if it["y"] == 1)
    val_neg = sum(1 for it in val_items if it["y"] == 0)

    print("[i] slice items train:", len(train_items), "val:", len(val_items))
    print("[i] train pos:", train_pos, "| train neg:", train_neg)
    print("[i] val pos:", val_pos, "| val neg:", val_neg)

    if train_pos == 0:
        raise RuntimeError("No positive slices found. XML parsing / xml_path / ROI mapping issue persists.")

    # sampler
    ys = np.array([it["y"] for it in train_items], dtype=np.int64)
    n_pos = int((ys == 1).sum())
    n_neg = int((ys == 0).sum())
    w_pos = n_neg / max(1, n_pos)

    weights = np.where(ys == 1, w_pos, 1.0).astype(np.float32)
    sampler = WeightedRandomSampler(weights=weights, num_samples=len(weights), replacement=True)

    train_ds = Slice25DDataset(train_items, cache_dir=args.cache_dir, train=True)
    val_ds = Slice25DDataset(val_items, cache_dir=args.cache_dir, train=False)

    train_dl = DataLoader(train_ds, batch_size=args.batch_size, sampler=sampler, num_workers=2)
    val_dl = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False, num_workers=2)

    device = "cuda" if torch.cuda.is_available() else "cpu"

    # ATTENTION: build_model signature'ı (backbone,in_ch) ise kırılmasın diye güvenli çağrı
    # Senin model.py'de build_model(backbone="...", in_ch=3) var.
    model = build_model(args.backbone, in_ch=3).to(device)

    # y shape / loss uyumu: BCEWithLogitsLoss input ve target aynı shape olmalı
    pos_weight = torch.tensor([w_pos], dtype=torch.float32, device=device)
    criterion = nn.BCEWithLogitsLoss(pos_weight=pos_weight)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    best_auc = -1.0
    best_path = os.path.join(args.out_dir, f"best_{args.backbone}.pt")
    patience = 4
    bad = 0

    def eval_epoch():
        model.eval()
        losses = []
        y_true = []
        y_score = []
        correct = 0
        total = 0
        with torch.no_grad():
            for X, y, _meta in val_dl:
                X = X.to(device)

                # target float + shape fix: (B,1)
                y = y.to(device).float()
                if y.ndim == 1:
                    y = y.unsqueeze(1)

                logits = model(X)
                if logits.ndim == 1:
                    logits = logits.unsqueeze(1)

                loss = criterion(logits, y)
                losses.append(float(loss.item()))

                p = torch.sigmoid(logits).detach().cpu().numpy().reshape(-1)
                yt = y.detach().cpu().numpy().reshape(-1)
                y_score.extend(p.tolist())
                y_true.extend(yt.tolist())

                pred = (p >= 0.5).astype(np.int64)
                correct += int((pred == yt.astype(np.int64)).sum())
                total += int(len(yt))

        acc = correct / max(1, total)
        auc = roc_auc_score(y_true, y_score) if len(set(y_true)) > 1 else 0.5
        return float(np.mean(losses)), float(acc), float(auc)

    history = []
    print(f"[i] backbone={args.backbone} | device={device}")
    print(f"[i] model_class={model.__class__.__name__}")

    for ep in range(1, args.epochs + 1):
        model.train()
        tr_losses = []
        pbar = tqdm(train_dl, desc=f"epoch {ep}/{args.epochs} [train]", leave=False)
        for X, y, _meta in pbar:
            X = X.to(device)

            # target float + shape fix: (B,1)
            y = y.to(device).float()
            if y.ndim == 1:
                y = y.unsqueeze(1)

            opt.zero_grad()

            logits = model(X)
            if logits.ndim == 1:
                logits = logits.unsqueeze(1)

            loss = criterion(logits, y)
            loss.backward()
            opt.step()

            tr_losses.append(float(loss.item()))
            pbar.set_postfix(loss=f"{tr_losses[-1]:.4f}")

        v_loss, v_acc, v_auc = eval_epoch()
        tr_loss = float(np.mean(tr_losses)) if tr_losses else 0.0

        row = {"epoch": ep, "train_loss": tr_loss, "val_loss": v_loss, "val_acc": v_acc, "val_auc": v_auc}
        history.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)

        if v_auc > best_auc + 1e-4:
            best_auc = v_auc
            torch.save(model.state_dict(), best_path)
            bad = 0
        else:
            bad += 1
            if bad >= patience:
                print(f"[i] Early stopping at epoch {ep}. best_auc={best_auc:.4f}")
                break

    hist_path = os.path.join(args.out_dir, f"history_{args.backbone}.json")
    with open(hist_path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2, ensure_ascii=False)

    print(f"[✓] best model saved: {best_path}")
    print(f"[✓] history saved: {hist_path}")
    print(f"[FINAL] best_auc={best_auc:.4f}", flush=True)


if __name__ == "__main__":
    main()
