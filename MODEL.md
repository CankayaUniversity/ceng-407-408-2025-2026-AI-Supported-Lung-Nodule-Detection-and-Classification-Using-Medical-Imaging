# Pulmo — AI Model Reference

## Overview

The Pulmo pipeline is a two-stage deep learning system for pulmonary nodule detection and characterisation in chest CT scans. It is maintained as a Git submodule at `ai/Pulmo` and developed independently from the application layer.

- **GitHub Repository:** https://github.com/ariyulistanbul/Pulmo
- **HuggingFace Model:** https://huggingface.co/ariyul/Pulmo
- **Current version:** v3

---

## Architecture

### Stage 1 — HeatmapUNet3D (Nodule Centre Detector)

A lightweight 3D U-Net trained with a CenterNet-style penalty-reduced focal loss to output a voxel-level nodule-centre probability heatmap over the full CT volume. Candidate locations are extracted via peak detection on the heatmap.

- Input: full CT volume `(Z, Y, X)`, raw HU
- Output: per-voxel centre-probability heatmap `(Z, Y, X)`
- Sliding-window patch: `(64, 128, 128)` voxels

### Stage 2 — Student2p5D (Concept-Bottleneck Characteriser)

A 2.5D concept-bottleneck multi-task model distilled from a 3D teacher. For each candidate location it jointly predicts:

- **Detection** — nodule vs. non-nodule
- **Malignancy** — benign vs. malignant (via concept bottleneck)
- **8 Radiological concepts** — subtlety, internal structure, calcification, sphericity, margin, lobulation, spiculation, texture
- **Segmentation** — binary nodule mask of the central axial slice

Malignancy is computed as a linear function of the 8 concepts, making every prediction fully attributable to human-interpretable radiological features.

- Input: `(B, 7, 64, 64)` — 7 central axial slices of a 64³ patch, HU clipped to \[-1000, 1000\] and normalised to \[0, 1\]
- Output: detection logits, concept scores, malignancy logits, segmentation mask

---

## Performance

Evaluated on a patient-level 80/10/10 split of the LUNA16 dataset. Metrics are internal; the system has not been externally validated.

### Stage 2 — Patch-level test split

| Task | Metric | Score | 95% CI |
|------|--------|-------|--------|
| Detection | AUC | 0.9981 | 0.9961–0.9995 |
| Malignancy | AUC | 0.9862 | 0.9621–1.0000 |
| Segmentation | Dice | 0.8573 | 0.8447–0.8700 |

### Stage 1 — Scan-level FROC

| Metric | Value |
|--------|-------|
| CPM (mean sensitivity @ 1/8, 1/4, 1/2, 1, 2, 4, 8 FP/scan) | 0.629 |
| Sensitivity @ 16 FP/scan | 0.956 |
| Mean centre distance | 1.85 mm |

---

## Training Data

Both stages are trained on **LUNA16** (a curated subset of LIDC-IDRI, 888 CT scans).

Please cite the underlying datasets if using this work:

- Setio et al., *Validation, comparison, and combination of algorithms for automatic detection of pulmonary nodules in CT images: the LUNA16 challenge*, Medical Image Analysis, 2017.
- Armato et al., *The Lung Image Database Consortium (LIDC) and Image Database Resource Initiative (IDRI)*, Medical Physics, 2011.

---

## Disclaimer

Research use only. Not a medical device. Not validated for clinical diagnosis.
