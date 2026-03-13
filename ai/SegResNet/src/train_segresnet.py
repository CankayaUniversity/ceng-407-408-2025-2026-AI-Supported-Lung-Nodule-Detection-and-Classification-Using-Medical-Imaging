"""
Module: train_segresnet.py
Purpose: Training script for 2.5D MONAI SegResNet model.

This module handles:
1. Model creation (SegResNet optimized for 2.5D)
2. Loss function setup (Dice + BCE)
3. Training/validation loops
4. Checkpoint management
5. Metric tracking

2.5D Input Notes:
- Input: 5 channels (5-slice stack)
- SegResNet expects: (B, C, H, W)
- Output: (B, 1, H, W) - binary nodule segmentation

Model Architecture:
- in_channels = 5 (our 2.5D stack)
- out_channels = 1 (binary segmentation)
- spatial_dims = 2 (2D convolutions for 2.5D slices)

Typical usage:
    python train_segresnet.py --config configs/train_config.yaml
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import yaml

import torch
import torch.nn as nn
from torch.optim import Adam
from torch.optim.lr_scheduler import ReduceLROnPlateau

from monai.networks.nets import SegResNet
from monai.losses import DiceLoss

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SegmentationModel(nn.Module):
    """
    Wrapper for SegResNet with combined loss.
    
    Loss = α * DiceLoss + (1-α) * BCELoss
    """
    
    def __init__(self, in_channels: int = 5, out_channels: int = 1):
        """
        Args:
            in_channels: Number of input channels (5 for 2.5D)
            out_channels: Number of output channels (1 for binary segmentation)
        """
        super().__init__()
        
        # MONAI SegResNet: optimized medical segmentation architecture
        # spatial_dims=2 means 2D convolutions (suitable for 2.5D slices)
        self.net = SegResNet(
            spatial_dims=2,
            init_filters=8,
            in_channels=in_channels,
            out_channels=out_channels,
            dropout_prob=0.2,
        )
        
        logger.info(f"SegResNet created:")
        logger.info(f"  Input channels: {in_channels}")
        logger.info(f"  Output channels: {out_channels}")
        logger.info(f"  Architecture: 2D convolutions (2.5D compatible)")
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass.
        
        Args:
            x: Input tensor (B, 5, H, W) - batch of 2.5D stacks
            
        Returns:
            Output tensor (B, 1, H, W) - probability maps
        """
        return self.net(x)


def create_loss_fn(device: str, dice_weight: float = 0.5) -> nn.Module:
    """
    Create combined loss function.
    
    Loss = dice_weight * DiceLoss + (1 - dice_weight) * BCELoss
    
    Args:
        device: Device to move loss to
        dice_weight: Weight for Dice loss
        
    Returns:
        Combined loss module
    """
    dice_loss = DiceLoss(sigmoid=True, reduction='mean')
    bce_loss = nn.BCEWithLogitsLoss(reduction='mean')
    
    class CombinedLoss(nn.Module):
        def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
            dice = dice_loss(pred, target)
            bce = bce_loss(pred, target)
            return dice_weight * dice + (1 - dice_weight) * bce
    
    return CombinedLoss().to(device)


def compute_dice_score(pred: torch.Tensor, target: torch.Tensor, 
                      threshold: float = 0.5) -> float:
    """
    Compute Dice metric.
    
    Args:
        pred: Predictions (B, 1, H, W)
        target: Ground truth (B, 1, H, W)
        threshold: Binary threshold for predictions
        
    Returns:
        Dice score [0, 1]
    """
    # Apply sigmoid and threshold
    pred = torch.sigmoid(pred)
    pred_binary = (pred > threshold).float()
    
    # Dice = 2 * |X∩Y| / (|X| + |Y|)
    intersection = (pred_binary * target).sum().item()
    union = pred_binary.sum().item() + target.sum().item()
    
    if union == 0:
        return 1.0 if intersection == 0 else 0.0
    
    return 2.0 * intersection / union


def train_one_epoch(model: nn.Module, train_loader, loss_fn: nn.Module,
                   optimizer, device: str) -> Tuple[float, float]:
    """
    Train model for one epoch.
    
    Args:
        model: SegResNet model
        train_loader: Training DataLoader
        loss_fn: Loss function
        optimizer: Optimizer
        device: Device (cuda/cpu)
        
    Returns:
        Tuple of (avg_loss, avg_dice)
    """
    model.train()
    
    total_loss = 0.0
    total_dice = 0.0
    num_batches = 0
    
    for batch_idx, (images, masks) in enumerate(train_loader):
        images = images.to(device)
        masks = masks.to(device)
        
        # Forward pass
        optimizer.zero_grad()
        outputs = model(images)
        loss = loss_fn(outputs, masks)
        
        # Backward pass
        loss.backward()
        optimizer.step()
        
        # Metrics
        total_loss += loss.item()
        dice = compute_dice_score(outputs, masks)
        total_dice += dice
        num_batches += 1
        
        # Log progress
        if (batch_idx + 1) % max(1, len(train_loader) // 5) == 0:
            logger.info(f"  Batch {batch_idx+1}/{len(train_loader)} - "
                       f"Loss: {loss.item():.4f}, Dice: {dice:.4f}")
    
    avg_loss = total_loss / num_batches
    avg_dice = total_dice / num_batches
    
    return avg_loss, avg_dice


def validate(model: nn.Module, val_loader, loss_fn: nn.Module,
            device: str) -> Tuple[float, float]:
    """
    Validate model.
    
    Args:
        model: SegResNet model
        val_loader: Validation DataLoader
        loss_fn: Loss function
        device: Device (cuda/cpu)
        
    Returns:
        Tuple of (avg_loss, avg_dice)
    """
    model.eval()
    
    total_loss = 0.0
    total_dice = 0.0
    num_batches = 0
    
    with torch.no_grad():
        for images, masks in val_loader:
            images = images.to(device)
            masks = masks.to(device)
            
            # Forward pass
            outputs = model(images)
            loss = loss_fn(outputs, masks)
            
            # Metrics
            total_loss += loss.item()
            dice = compute_dice_score(outputs, masks)
            total_dice += dice
            num_batches += 1
    
    avg_loss = total_loss / num_batches
    avg_dice = total_dice / num_batches
    
    return avg_loss, avg_dice


def save_checkpoint(model: nn.Module, optimizer, epoch: int,
                   metrics: Dict, checkpoint_dir: str):
    """Save model checkpoint."""
    checkpoint_dir = Path(checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    
    checkpoint = {
        'epoch': epoch,
        'model_state_dict': model.state_dict(),
        'optimizer_state_dict': optimizer.state_dict(),
        'metrics': metrics,
    }
    
    filepath = checkpoint_dir / f'checkpoint_epoch_{epoch:03d}.pth'
    torch.save(checkpoint, filepath)
    logger.info(f"Saved checkpoint: {filepath}")


def main():
    """Main training execution."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Train SegResNet for lung nodule segmentation")
    parser.add_argument('--config', type=str, required=True,
                       help='Path to training config YAML file')
    parser.add_argument('--resume', type=str, default=None,
                       help='Path to checkpoint to resume from')
    
    args = parser.parse_args()
    
    # Load config
    with open(args.config, 'r') as f:
        config = yaml.safe_load(f)
    
    logger.info("="*60)
    logger.info("SegResNet Training")
    logger.info("="*60)
    logger.info(f"Config: {args.config}\n")
    
    # Setup device
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    logger.info(f"Device: {device}\n")
    
    # Create model
    model = SegmentationModel(
        in_channels=config['model']['in_channels'],
        out_channels=config['model']['out_channels']
    )
    model.to(device)
    
    # Setup loss and optimizer
    loss_fn = create_loss_fn(device, dice_weight=0.5)
    optimizer = Adam(model.parameters(), lr=config['training']['learning_rate'])
    scheduler = ReduceLROnPlateau(optimizer, mode='max', factor=0.5, patience=5, verbose=True)
    
    logger.info(f"Learning rate: {config['training']['learning_rate']}")
    logger.info(f"Batch size: {config['training']['batch_size']}")
    logger.info(f"Epochs: {config['training']['num_epochs']}\n")
    
    # Load data
    from dataset import LIDC25DDataset
    from transforms import get_train_transforms, get_val_transforms
    from torch.utils.data import DataLoader
    
    logger.info(f"Loading training data from {config['data']['train_dir']}")
    logger.info(f"Loading validation data from {config['data']['val_dir']}")
    
    train_dataset = LIDC25DDataset(config['data']['train_dir'], transform=get_train_transforms())
    val_dataset = LIDC25DDataset(config['data']['val_dir'], transform=get_val_transforms())
    
    train_loader = DataLoader(
        train_dataset,
        batch_size=config['training']['batch_size'],
        shuffle=True,
        num_workers=config['dataloader']['num_workers'],
        pin_memory=config['dataloader']['pin_memory']
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=config['training']['batch_size'],
        shuffle=False,
        num_workers=config['dataloader']['num_workers'],
        pin_memory=config['dataloader']['pin_memory']
    )
    
    logger.info(f"Train samples: {len(train_dataset)}, Val samples: {len(val_dataset)}")
    
    # Training loop
    best_dice = 0.0
    checkpoint_dir = config['training']['checkpoint_dir']
    
    for epoch in range(config['training']['num_epochs']):
        logger.info(f"\nEpoch {epoch+1}/{config['training']['num_epochs']}")
        
        train_loss, train_dice = train_one_epoch(model, train_loader, loss_fn, optimizer, device)
        val_loss, val_dice = validate(model, val_loader, loss_fn, device)
        
        logger.info(f"Train Loss: {train_loss:.4f}, Train Dice: {train_dice:.4f}")
        logger.info(f"Val Loss: {val_loss:.4f}, Val Dice: {val_dice:.4f}")
        
        if val_dice > best_dice:
            best_dice = val_dice
            logger.info(f"✓ Best model updated (Dice: {best_dice:.4f})")
            save_checkpoint(model, optimizer, epoch, {'val_dice': val_dice}, checkpoint_dir)
        
        scheduler.step(val_dice)
        
        logger.info("Placeholder: Data loading and training loop to be implemented")
    
    logger.info("\n" + "="*60)
    logger.info(f"Training complete. Best Dice: {best_dice:.4f}")
    logger.info("="*60)


if __name__ == "__main__":
    main()
