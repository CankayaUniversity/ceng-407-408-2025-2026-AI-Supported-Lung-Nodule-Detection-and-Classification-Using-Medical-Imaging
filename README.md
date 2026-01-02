

<img alt="LUNGXAI LOGO" src="https://github.com/user-attachments/assets/31a38582-d823-4d31-a14e-3df083df65ea" />

# AI-Supported Lung Nodule Detection and Classification Using Medical Imaging

---

## Team Members

- Can Berk Meşe — 202111045  
- Orkun Oğuztürk — 202111078  
- Barbaros Murat Dönmez — 202011019  
- Ömer Faruk Şahin — 202111073  
- Arda Kaan Bakır — 202111064  
- Furkan Çoban — 202011204
- Elif Güngör — 202111077  

---

## Supervisor

Dr. Öğr. Üyesi Doç. Dr. Ayşe Nurdan SARAN  
Department of Computer Engineering  
Çankaya University

---

## Course Information

- **CENG 407 – Software Development Project I**  
- **Fall 2025–2026**

---

## Abstract

This project aims to develop an AI-supported medical imaging system capable of detecting and classifying lung nodules in CT scans.  
The proposed system leverages deep learning models, particularly convolutional neural networks (CNNs), combined with Explainable AI (XAI) techniques to improve interpretability and clinical trust.

The ultimate goal is to assist radiologists in early lung cancer detection and enhance diagnostic accuracy through a transparent, efficient, and user-friendly tool.

---

## Structural Overview of the Repository

```
UI/                     # Frontend interface
backend/                # Backend services & API
ai/                     # AI & ML components (Git submodule)
└── Pulmo/               # Lung AI pipeline (submodule)
.gitmodules              # Git submodule configuration
Literature Review.docx
README.md
package.json
```

> **Important:**  
> The `ai/Pulmo` directory is a **Git submodule** and must be initialized after cloning.

---

## AI Module (Pulmo)

- `Pulmo` contains the AI-driven deep learning pipeline for lung nodule analysis.
- It is developed and versioned independently from the main repository.
- This design enables clean experimentation, reproducibility, and minimal coupling with UI and backend components.

---

## Clone (First Time)

```bash
git clone --recurse-submodules https://github.com/CankayaUniversity/ceng-407-408-2025-2026-AI-Supported-Lung-Nodule-Detection-and-Classification-Using-Medical-Imaging.git
```

---

## If You Already Cloned the Repository

```bash
git submodule update --init --recursive
```

---

## Pulling Updates

One-line version:

```bash
git pull && git submodule update --init --recursive
```
Step-by-step commands:
```bash
git pull
git submodule update --init --recursive
```

---

## Submodule Rules

- The `ai/Pulmo` directory is managed strictly as a Git submodule.
- Do not manually copy files into or out of the submodule.
- All AI-related development must be performed inside the `Pulmo` repository.

---

## Disclaimer

This project is developed for academic and research purposes only  
and is not intended for clinical use.

---

## License

See individual module licenses for details.
