
<img alt="LUNGXAI LOGO" src="https://github.com/user-attachments/assets/31a38582-d823-4d31-a14e-3df083df65ea" />

# AI-Supported Lung Nodule Detection and Classification Using Medical Imaging

---

## Team Members

- Can Berk Meşe — 202111045
- Orkun Oğuztürk — 202111078
- Barbaros Murat Dönmez — 202011019
- Ömer Faruk Şahin — 202111073
- Arda Kaan Bakır — 202111064
- Ariyul İstanbul — 202011204
- Elif Güngör — 202111077

---

## Supervisor

Dr. Öğr. Üyesi Doç. Dr. Ayşe Nurdan SARAN
Department of Computer Engineering
Çankaya University

---

## Course Information

- CENG 407 – Software Development Project I — Fall 2025–2026
- CENG 408 – Software Development Project II — Spring 2025–2026

---

## Abstract

This project presents an AI-supported medical imaging system for detecting and classifying pulmonary nodules in chest CT scans. The system integrates a two-stage deep learning pipeline with Explainable AI (XAI) techniques to provide clinically interpretable results alongside automated detections.

The pipeline chains a 3D nodule-centre detector (Stage 1) with a 2.5D concept-bottleneck multi-task characteriser (Stage 2) that jointly predicts detection confidence, malignancy probability, eight radiological concepts, and a per-nodule segmentation mask. Because malignancy is predicted solely from the eight concepts, every decision is fully attributable to human-interpretable radiological features.

The goal is to assist radiologists in early lung cancer screening and improve diagnostic confidence through a transparent, efficient, and user-friendly clinical decision support tool.

---

## Repository Structure

```
UI/                     # React frontend (Vite)
backend/                # Node.js API server + Python AI service
ai/                     # AI & ML components
└── Pulmo/              # Two-stage lung nodule pipeline (Git submodule)
```

> **Note:** The `ai/Pulmo` directory is a Git submodule and must be initialised after cloning.

---

## AI Module (Pulmo)

The **Pulmo** submodule contains the complete deep learning pipeline for lung nodule detection and classification, developed and versioned independently from the application layer.

### Pipeline Overview

| Stage | Model | Task |
|-------|-------|------|
| Stage 1 | HeatmapUNet3D | Detect nodule centres in the full CT volume via a 3D sliding-window heatmap |
| Stage 2 | Student2p5D | Per-candidate characterisation: detection, malignancy, 8 radiological concepts, segmentation |

### Performance (Internal Held-Out Test Split — LUNA16)

**Stage 2 — Characterisation (patch level)**

| Task | Metric | Score |
|------|--------|-------|
| Detection | AUC | 0.9981 \[95% CI 0.9961–0.9995\] |
| Malignancy | AUC | 0.9862 \[95% CI 0.9621–1.0000\] |
| Segmentation | Dice | 0.8573 \[95% CI 0.8447–0.8700\] |

**Stage 1 — Detection (scan level, FROC)**

| Metric | Value |
|--------|-------|
| CPM (mean sensitivity @ 1/8…8 FP/scan) | 0.629 |
| Sensitivity @ 16 FP/scan | 0.956 |
| Mean centre distance | 1.85 mm |

> Patient-level 80/10/10 split of LUNA16. Metrics are internal; the system has not been externally validated.

### Submodule Reference

- **Repository:** https://github.com/ariyulistanbul/Pulmo
- **Location:** `ai/Pulmo`

---

## Build & Run (Quick Start)

### Clone (First Time)

```bash
git clone --recurse-submodules https://github.com/CankayaUniversity/ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging.git
```

### If You Already Cloned the Repository

```bash
git submodule update --init --recursive
```

### Pulling Updates

```bash
git pull && git submodule update --init --recursive
```

### Running the Application

```bash
start.bat
```

This starts all three services:

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3001 |
| AI Service | http://localhost:3002 |
| Frontend | http://localhost:5173 |

For detailed UI setup instructions, see [UI_Setup.md](UI_Setup.md).

---

## Disclaimer

This project is developed for academic and research purposes only and is not intended for clinical diagnosis or medical use.

---

## License

See individual module licenses for details.
