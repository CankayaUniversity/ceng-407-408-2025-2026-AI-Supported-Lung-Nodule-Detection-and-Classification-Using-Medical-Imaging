
<img alt="LUNGXAI LOGO" src="https://github.com/user-attachments/assets/31a38582-d823-4d31-a14e-3df083df65ea" />

# AI-Supported Lung Nodule Detection and Classification Using Medical Imaging

---

## Team Members

| Name | Student ID |
|------|------------|
| Can Berk Meşe | 202111045 |
| Orkun Oğuztürk | 202111078 |
| Barbaros Murat Dönmez | 202011019 |
| Ömer Faruk Şahin | 202111073 |
| Arda Kaan Bakır | 202111064 |
| Ariyul İstanbul | 202011204 |
| Elif Güngör | 202111077 |

**Supervisor:** Dr. Öğr. Üyesi Doç. Dr. Ayşe Nurdan SARAN — Çankaya University, Computer Engineering

**Course:** CENG 407 (Fall 2025–2026) · CENG 408 (Spring 2025–2026)

---

## Abstract

This project presents an AI-supported medical imaging system for detecting and classifying pulmonary nodules in chest CT scans. The system integrates a two-stage deep learning pipeline with Explainable AI (XAI) techniques to provide clinically interpretable results alongside automated detections.

The pipeline chains a 3D nodule-centre detector (Stage 1) with a 2.5D concept-bottleneck multi-task characteriser (Stage 2) that jointly predicts detection confidence, malignancy probability, eight radiological concepts, and a per-nodule segmentation mask. Because malignancy is predicted solely from the eight concepts, every decision is fully attributable to human-interpretable radiological features.

---

## Project Reports

| Report | Description |
|--------|-------------|
| [CENG408 Final Report](docs/reports/CENG408_FinalReport.pdf) | Full project final report (CENG 408) |
| [Final Report](docs/reports/Final_Report.pdf) | Project final report |
| [Testing & Validation Report](docs/reports/Testing_Validation_Report.pdf) | System testing and validation results |
| [Methodology](docs/reports/methodology.pdf) | Research methodology document |
| [Literature Review](docs/reports/Literature_Review.docx) | Literature review (Word document) |

---

## Repository Structure

```
pulmo-app/
├── ai/                          # AI models & ML components
│   ├── Pulmo/                   # Two-stage pipeline (Git submodule)
│   └── models/                  # Model checkpoints
│       ├── segresnet_25d_best_.pt   # Best SegResNet checkpoint
│       ├── segresnet_25d_adam.pt    # Adam SegResNet checkpoint
│       └── ogrenci_model_25D_full.pt  # Classifier model
├── backend/                     # Node.js API + Python AI service
│   ├── ai_service/              # FastAPI inference service (Pulmo)
│   ├── ai_analysis.py           # SegResNet analysis pipeline
│   └── run_analysis.py          # Analysis entry point
├── UI/                          # React frontend (Vite)
├── docs/                        # Project documentation
│   ├── reports/                 # University reports (PDF/Word)
│   ├── AUDIT_FINAL_REPORT.md
│   ├── PIPELINE_IMPROVEMENTS_SUMMARY.md
│   ├── PIPELINE_REVIEW.md
│   ├── UI_Setup.md
│   └── NLP_TRAINING.md
├── research/                    # Research scripts, notebooks, experiments
│   ├── notebooks/               # Jupyter notebooks (LIDC preprocessing, training)
│   ├── scripts/                 # Audit and analysis scripts
│   ├── figures/                 # Alignment audit visualisations
│   ├── data/                    # CT segment mappings
│   └── gradcam/                 # GradCAM experiments
├── patches/                     # Git patches
├── README.md
├── MODEL.md                     # Model ownership & development policy
└── start.bat                    # One-click startup (all three services)
```

---

## AI Module (Pulmo)

The **Pulmo** submodule contains the complete deep learning pipeline, developed and versioned independently.

| Resource | Link |
|----------|------|
| GitHub Repository | [ariyulistanbul/Pulmo](https://github.com/ariyulistanbul/Pulmo) |
| HuggingFace Model | [ariyul/Pulmo](https://huggingface.co/ariyul/Pulmo) |
| Location in repo | `ai/Pulmo` (Git submodule) |

### Pipeline

| Stage | Model | Task |
|-------|-------|------|
| Stage 1 | HeatmapUNet3D | Detect nodule centres (3D sliding-window heatmap over full CT) |
| Stage 2 | Student2p5D | Detection · Malignancy · 8 radiological concepts · Segmentation mask |

### Performance (Internal Test — LUNA16)

| Task | Metric | Score |
|------|--------|-------|
| Stage 2 Detection | AUC | 0.9981 |
| Stage 2 Malignancy | AUC | 0.9862 |
| Stage 2 Segmentation | Dice | 0.8573 |
| Stage 1 CPM | mean sensitivity | 0.629 |
| Stage 1 Sensitivity @ 16 FP/scan | — | 0.956 |

---

## Documentation

| Document | Description |
|----------|-------------|
| [docs/MODEL.md](docs/MODEL.md) | Model ownership & development policy |
| [docs/AUDIT_FINAL_REPORT.md](docs/AUDIT_FINAL_REPORT.md) | LIDC-IDRI alignment audit |
| [docs/PIPELINE_IMPROVEMENTS_SUMMARY.md](docs/PIPELINE_IMPROVEMENTS_SUMMARY.md) | Pipeline improvement history |
| [docs/PIPELINE_REVIEW.md](docs/PIPELINE_REVIEW.md) | Pipeline review notes |
| [docs/UI_Setup.md](docs/UI_Setup.md) | UI setup instructions |

---

## Quick Start

### Clone

This repository uses a **Git submodule** (`ai/Pulmo`). A plain `git clone` will leave the submodule folder empty — you must use one of the methods below.

#### Option A — Clone everything at once (recommended)

```bash
git clone --recurse-submodules https://github.com/CankayaUniversity/ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging.git
```

#### Option B — Already cloned without `--recurse-submodules`?

```bash
git submodule update --init --recursive
```

This fetches the Pulmo submodule from:
```
https://github.com/ariyulistanbul/Pulmo.git
```

#### Pulling Updates

When the main repo has new commits:

```bash
git pull
git submodule update --recursive
```

Or in one command:

```bash
git pull && git submodule update --recursive
```

> **Note:** If someone updates the Pulmo submodule pointer, `git submodule update --recursive` will check out the new commit. Never commit inside `ai/Pulmo` directly — all model development happens in the [Pulmo repository](https://github.com/ariyulistanbul/Pulmo).

### First Time — Run Setup

```bash
setup.bat
```

`setup.bat` automatically:
- Checks Node.js and Python are installed
- Runs `npm install` for backend and UI (skips if already done)
- Installs all Python packages (`backend/requirements.txt`, `ai_service/requirements.txt`)
- Creates `backend/.env` from `.env.example` if missing (with a prompt to configure `DB_SERVER`)
- Launches the application via `start.bat`

If any step fails a popup appears with the error and manual fix instructions.

### Subsequent Runs

```bash
start.bat
```

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3001 |
| AI Service (Pulmo) | http://localhost:3002 |
| Frontend | http://localhost:5173 |

### First Run: Download Pulmo Model

Once the application is running, navigate to the New Study page and click **Download Pulmo** in the AI Analysis section.

```
http://localhost:5173/new-study
```

---

## Installation Options

There are two ways to install and run the project after cloning:

### Option 1 — Automatic (recommended)

```bash
setup.bat
```

Handles everything in one step: checks prerequisites, installs all dependencies, configures `.env`, and launches the application. A popup appears if any step fails, with instructions for manual resolution.

### Option 2 — Manual

Follow the step-by-step instructions in **[docs/UI_Setup.md](docs/UI_Setup.md)**:

- Install Node.js and Python dependencies
- Configure `backend/.env`
- Set up the SQL Server database

Once setup is complete, launch the application with:

```bash
start.bat
```

---

> **Disclaimer:** This project is for academic and research purposes only. Not intended for clinical diagnosis or medical use.
