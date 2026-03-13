"""
Module: dataset.py
Purpose: PyTorch Dataset class for 2.5D lung nodule segmentation.
         Load pre-processed 2.5D samples from .npz files.
         Apply optional transforms during training/validation.

Data format:
- Each sample is a .npz file containing:
  - 'image': 5-channel stack (5, H, W)
  - 'mask': center slice binary mask (1, H, W) or (H, W)

Example usage:
    from dataset import LIDC25DDataset
    from torch.utils.data import DataLoader
    
    dataset = LIDC25DDataset('data/lidc_25d', split='train', transform=train_transforms)
    loader = DataLoader(dataset, batch_size=16, shuffle=True, num_workers=4)
    
    for images, masks in loader:
        print(images.shape)  # (16, 5, 512, 512)
        print(masks.shape)   # (16, 1, 512, 512)
"""

import os
import json
import logging
from pathlib import Path
from typing import Tuple, Callable, Optional, List

import numpy as np
import torch
from torch.utils.data import Dataset

logger = logging.getLogger(__name__)


class LIDC25DDataset(Dataset):
    """
    PyTorch Dataset for LIDC 2.5D lung nodule segmentation.
    
    Loads pre-processed 2.5D samples (.npz format) and applies optional transforms.
    
    Attributes:
        data_dir: Directory containing .npz files
        metadata_file: JSON file with sample metadata
        transform: Optional callable for data augmentation/preprocessing
        sample_files: List of .npz file paths
    """
    
    def __init__(self, data_dir: str, metadata_file: Optional[str] = None,
                 transform: Optional[Callable] = None):
        """
        Initialize LIDC 2.5D dataset.
        
        Args:
            data_dir: Directory containing 2.5D .npz samples
            metadata_file: Path to metadata.json (optional for logging)
            transform: Optional transform callable (image, mask) → (image, mask)
            
        Raises:
            ValueError: If data directory is empty
        """
        self.data_dir = Path(data_dir)
        self.transform = transform
        
        # Find all .npz files
        self.sample_files = sorted(self.data_dir.glob('*.npz'))
        
        if not self.sample_files:
            raise ValueError(f"No .npz samples found in {data_dir}")
        
        logger.info(f"LIDC25DDataset initialized:")
        logger.info(f"  Directory: {self.data_dir}")
        logger.info(f"  Samples: {len(self.sample_files)}")
        
        # Load metadata if provided
        self.metadata = None
        if metadata_file and os.path.exists(metadata_file):
            with open(metadata_file, 'r') as f:
                self.metadata = json.load(f)
                logger.info(f"  Metadata: {metadata_file}")
    
    def __len__(self) -> int:
        """Return total number of samples."""
        return len(self.sample_files)
    
    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Get a single 2.5D sample.
        
        Args:
            idx: Index of sample
            
        Returns:
            Tuple of (image_tensor, mask_tensor)
            - image_tensor: shape (5, H, W), normalized float32
            - mask_tensor: shape (1, H, W), binary uint8
        """
        sample_file = self.sample_files[idx]
        
        try:
            # Load .npz file
            with np.load(sample_file, allow_pickle=False) as data:
                image = data['image'].astype(np.float32)    # (5, H, W)
                mask = data['mask'].astype(np.float32)      # (1, H, W) or (H, W)
            
            # Ensure mask is (1, H, W)
            if mask.ndim == 2:
                mask = np.expand_dims(mask, axis=0)
            
            # Apply transforms if provided
            if self.transform:
                image, mask = self.transform(image, mask)
            
            # Convert to tensors
            image_tensor = torch.from_numpy(image)
            mask_tensor = torch.from_numpy(mask)
            
            return image_tensor, mask_tensor
            
        except Exception as e:
            logger.error(f"Failed to load {sample_file}: {e}")
            raise


class DatasetSummary:
    """Helper class to summarize dataset statistics."""
    
    @staticmethod
    def analyze(dataset: LIDC25DDataset, sample_size: int = 100):
        """
        Analyze dataset statistics.
        
        Args:
            dataset: LIDC25DDataset instance
            sample_size: Number of samples to analyze
        """
        logger.info("\nDataset Analysis:")
        logger.info(f"  Total samples: {len(dataset)}")
        
        # Sample statistics
        num_samples = min(sample_size, len(dataset))
        image_min, image_max = float('inf'), float('-inf')
        num_with_nodule = 0
        
        for i in range(num_samples):
            image, mask = dataset[i]
            image_min = min(image_min, image.min().item())
            image_max = max(image_max, image.max().item())
            
            if mask.max() > 0:
                num_with_nodule += 1
        
        logger.info(f"  Image range: [{image_min:.2f}, {image_max:.2f}]")
        logger.info(f"  Nodule prevalence: {num_with_nodule}/{num_samples} "
                   f"({100*num_with_nodule/num_samples:.1f}%)")


def create_data_loaders(data_dir: str, batch_size: int = 16, 
                       num_workers: int = 4,
                       train_transform: Optional[Callable] = None,
                       val_transform: Optional[Callable] = None) -> dict:
    """
    Create PyTorch DataLoaders for training and validation.
    
    Assumes data_dir contains subdirectories 'train' and 'val' with .npz files.
    
    Args:
        data_dir: Root data directory
        batch_size: Batch size for loaders
        num_workers: Number of worker processes
        train_transform: Transform for training data
        val_transform: Transform for validation data
        
    Returns:
        Dictionary with 'train' and 'val' DataLoaders
    """
    from torch.utils.data import DataLoader
    
    loaders = {}
    
    # Training data
    train_dir = Path(data_dir) / 'train'
    if train_dir.exists():
        train_dataset = LIDC25DDataset(str(train_dir), transform=train_transform)
        loaders['train'] = DataLoader(
            train_dataset,
            batch_size=batch_size,
            shuffle=True,
            num_workers=num_workers,
            pin_memory=True
        )
        logger.info(f"Train loader: {len(train_dataset)} samples")
    
    # Validation data
    val_dir = Path(data_dir) / 'val'
    if val_dir.exists():
        val_dataset = LIDC25DDataset(str(val_dir), transform=val_transform)
        loaders['val'] = DataLoader(
            val_dataset,
            batch_size=batch_size,
            shuffle=False,
            num_workers=num_workers,
            pin_memory=True
        )
        logger.info(f"Val loader: {len(val_dataset)} samples")
    
    return loaders
