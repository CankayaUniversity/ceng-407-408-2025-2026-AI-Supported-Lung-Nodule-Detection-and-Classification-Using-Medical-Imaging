
# LIDC-IDRI Series-level Malignancy Classification  
## 2.5D Slice Inference with Grad-CAM

## Overview

This project implements a **series-level lung nodule malignancy classification pipeline**
using the **LIDC-IDRI** dataset.
Although the ground-truth labels are defined at the **CT series level**, the model performs
**slice-level inference** using **2.5D contextual input** (`z-1, z, z+1`) and provides
**visual explanations** via **Grad-CAM** on full DICOM slices.

The project is developed as a **graduation project demo**, focusing on methodology,
robust data handling, and interpretability rather than clinical deployment.

---

## Problem Definition

Given a CT series from the LIDC-IDRI dataset:

- Assign a **series-level malignancy label** based on radiologist annotations
- Train a neural network using **slice-level samples** derived from that series
- Perform **slice-level malignancy prediction** using local 2.5D context
- Visualize model attention using **Grad-CAM** overlays on original CT slices

While the supervision signal is defined at the **series level**, slice-level predictions
are used for localization and interpretability.

---

## Dataset

- **Dataset**: LIDC-IDRI  
- **Source**: The Cancer Imaging Archive (TCIA)  
- **Official dataset page**:  
  https://wiki.cancerimagingarchive.net/display/Public/LIDC-IDRI

---

## Labeling Strategy (Series-level)

Series-level labels are derived from radiologist annotations extracted from LIDC XML files.

- Malignancy scores are collected per annotated nodule
- Scores are aggregated at the series level
- A series is labeled as:
  - **Malignant (1)** if mean malignancy ≥ 3
  - **Benign (0)** otherwise

### Label Generation Repository

Label extraction and aggregation are implemented in a **separate repository** to keep
data processing isolated from model training and inference.

- Outputs:
  - `lidc_reader_level.csv`
  - `lidc_nodule_labels.csv`

Repository link (to be added):
> _TBD_

---

## Slice-level Sample Construction

Slice-level samples are generated only for training and inference:

- **Positive slices**:
  - Slices corresponding to annotated nodules
  - Expanded by ±k neighboring slices
- **Negative slices**:
  - Random slices from the same series not overlapping nodules

This enables slice-level learning under series-level supervision.

---

## Input Representation (2.5D)

Each input sample consists of three consecutive CT slices:

```
[z-1, z, z+1] → (3, 256, 256)
```

Preprocessing:
- DICOM sorting by instance number
- HU conversion and windowing [-1000, 400]
- Normalization to [0, 1]
- Resizing to 256×256

---

## Model Architecture

- Backbone: ResNet18 / ResNet34 / DenseNet121
- Input channels: 3
- Output: Binary malignancy probability
- Loss: BCEWithLogitsLoss with class weighting
- Sampling: WeightedRandomSampler

---

## Explainability (Grad-CAM)

Grad-CAM is applied to visualize model attention:

- Computed from final convolutional layers
- Overlaid on original CT slices
- Used for qualitative inspection of predictions

---

## Inference Pipeline

1. Load DICOM series
2. Compute slice-level malignancy probabilities
3. Select slice (automatic or manual)
4. Generate Grad-CAM overlay
5. Output image + JSON result

---

## HuggingFace Demo

An interactive demo will be hosted on HuggingFace Spaces.

Demo link (to be added):
> _TBD_

---

## Project Structure

```
lung25demo/
├── cache/
├── logs/
├── outputs/
├── src/
├── venv/
├── .gitignore
├── calistir.txt
├── dataset_root.txt
├── requirements.txt
├── README.md
├── app.py
├── app_offline.py
├── train.py
├── run_train.ps1
├── run_app.ps1
├── run_app_offline.ps1
├── setup_venv.ps1

```

---

## Usage

### Setup Venv
```
.\setup_venv.ps1
```

### Activate Venv
```
.\venv\Scripts\Activate.ps1
```

### Training
```
.\run_train.ps1
```

### Demo
```
.\run_app.ps1
```

#### Offline Demo (for Teammates)
An offline demo app is available for teammates, featuring
slice-level inference and optional Grad-CAM visualization.
```
.\run_app_offline.ps1
```

---

## Disclaimer

This project is intended for **educational and research purposes only**
and must not be used for clinical decision-making.

---

## License

MIT License
