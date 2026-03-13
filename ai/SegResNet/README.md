# SegResNet: 2.5D Lung Nodule Segmentation

Lung nodule segmentation on LIDC-IDRI dataset using MONAI SegResNet.

## Project Structure

```
SegResNet/
├── data/              # Dataset storage (LIDC-IDRI, processed data)
├── src/               # Source code
│   ├── prepare_lidc.py          # Download and prepare LIDC-IDRI
│   ├── build_25d_dataset.py     # Build 2.5D dataset from 3D scans
│   ├── dataset.py               # PyTorch Dataset class
│   ├── transforms.py            # Data augmentation & preprocessing
│   ├── train_segresnet.py       # Training script
│   ├── infer_segresnet.py       # Inference script
│   ├── postprocess.py           # Post-processing on predictions
│   └── extract_roi.py           # Extract ROI from masks
├── configs/           # Configuration files (JSON/YAML)
├── outputs/           # Model checkpoints and results
├── requirements.txt   # Python dependencies
└── README.md         # This file
```

## Pipeline Overview

1. **Prepare Data**: Download LIDC-IDRI and extract nodule annotations
2. **Build 2.5D Dataset**: Convert 3D volumes to 2.5D slices
3. **Train**: Train SegResNet on 2.5D slices
4. **Infer**: Run model on new scans
5. **Post-process**: Refine predictions and filter small objects
6. **Extract ROI**: Extract bounding boxes around nodules

## Setup

```bash
pip install -r requirements.txt
```

## Usage

### Training
```bash
python src/train_segresnet.py --config configs/train_config.json
```

### Inference
```bash
python src/infer_segresnet.py --model outputs/best_model.pth --input data/test_scans/
```

### Extract ROI
```bash
python src/extract_roi.py --masks outputs/predictions/ --output outputs/roi/
```

## Team
SegResNet implementation team (7 members)
