"""
Module: infer_segresnet.py
Purpose: Run inference with trained 2.5D SegResNet on CT volumes.

Inference Pipeline for 2.5D:
1. Load 3D CT volume and trained model
2. For each valid center slice k (k=2 to depth-2):
   - Extract 5-slice stack [k-2, k-1, k, k+1, k+2]
   - Pass through model
   - Collect prediction for center slice
3. Reconstruct full 3D prediction volume
4. Apply post-processing (optional)
5. Save results

Memory Efficiency:
- Process one slice at a time (never hold full 3D in memory)
- Load volume once, iterate through slices
- Output size matches input size

Typical usage:
    python infer_segresnet.py --model outputs/checkpoints/best_model.pth \\
                              --input data/input_volumes/ \\
                              --output outputs/predictions/
"""

import os
import sys
import logging
from pathlib import Path
from typing import Tuple, Optional

import numpy as np
import torch
import argparse

import torch.nn as nn
from monai.networks.nets import SegResNet

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SegResNetInference:
    """Inference engine for 2.5D SegResNet."""
    
    def __init__(self, model_path: str, device: str = 'cuda'):
        """
        Initialize inference engine.
        
        Args:
            model_path: Path to trained model checkpoint (.pth)
            device: Device to run on ('cuda' or 'cpu')
        """
        self.device = torch.device(device)
        self.model = self._load_model(model_path)
        self.stack_size = 5  # 2.5D: 5 slices
        self.half_stack = self.stack_size // 2  # 2 slices on each side
        
        logger.info(f"SegResNetInference initialized on {self.device}")
    
    def _load_model(self, model_path: str) -> nn.Module:
        """
        Load trained SegResNet model from checkpoint.
        
        Args:
            model_path: Path to .pth checkpoint
            
        Returns:
            Model in eval mode
        """
        logger.info(f"Loading model from {model_path}...")
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model not found: {model_path}")
        
        # Create model architecture
        model = SegResNet(
            spatial_dims=2,
            init_filters=8,
            in_channels=5,      # 2.5D input: 5 channels
            out_channels=1,     # Binary segmentation
            dropout_prob=0.2,
        )
        
        # Load checkpoint
        checkpoint = torch.load(model_path, map_location=self.device)
        
        # Handle both full checkpoint and state_dict
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            model.load_state_dict(checkpoint['model_state_dict'])
            logger.info(f"  Checkpoint epoch: {checkpoint.get('epoch', 'unknown')}")
        else:
            model.load_state_dict(checkpoint)
        
        model.to(self.device)
        model.eval()
        
        logger.info("✓ Model loaded successfully")
        return model
    
    def load_volume(self, volume_path: str) -> np.ndarray:
        """
        Load 3D CT volume from .npy file.
        
        Args:
            volume_path: Path to .npy volume file
            
        Returns:
            3D numpy array (D, H, W)
        """
        logger.info(f"Loading volume from {volume_path}...")
        
        if not os.path.exists(volume_path):
            raise FileNotFoundError(f"Volume not found: {volume_path}")
        
        volume = np.load(volume_path)
        
        if volume.ndim != 3:
            raise ValueError(f"Expected 3D volume, got shape {volume.shape}")
        
        logger.info(f"  Shape: {volume.shape}, dtype: {volume.dtype}")
        
        return volume
    
    def infer_volume(self, volume: np.ndarray) -> np.ndarray:
        """
        Run inference on a 3D volume.
        
        2.5D inference:
        - For each valid center slice k (k=2 to depth-2):
          - Extract 5-slice stack centered at k
          - Run model forward pass
          - Store prediction for center slice k
        - Reconstruct full-depth prediction volume
        
        Boundaries:
        - Slices 0 and 1: Cannot form 5-slice stack (need k-2)
        - Slices depth-2 and depth-1: Cannot form 5-slice stack (need k+2)
        - These slices are filled with zeros (background)
        
        Args:
            volume: 3D CT volume (D, H, W)
            
        Returns:
            3D prediction volume (D, H, W) with values [0, 1]
        """
        depth, height, width = volume.shape
        
        logger.info(f"Running inference on volume {volume.shape}...")
        logger.info(f"  Valid center slices: {self.half_stack} to {depth - self.half_stack - 1}")
        
        # Initialize output prediction volume
        predictions = np.zeros((depth, height, width), dtype=np.float32)
        
        self.model.eval()
        
        with torch.no_grad():
            for k in range(self.half_stack, depth - self.half_stack):
                # Extract 2.5D stack: [k-2, k-1, k, k+1, k+2]
                stack_indices = list(range(k - self.half_stack, k + self.half_stack + 1))
                stack = np.stack([volume[i] for i in stack_indices], axis=0)  # (5, H, W)
                
                # Convert to tensor and add batch dimension
                stack_tensor = torch.from_numpy(stack).float().unsqueeze(0)  # (1, 5, H, W)
                stack_tensor = stack_tensor.to(self.device)
                
                # Forward pass
                output = self.model(stack_tensor)  # (1, 1, H, W)
                
                # Apply sigmoid to get probability [0, 1]
                pred_prob = torch.sigmoid(output).squeeze(0).squeeze(0)  # (H, W)
                
                # Move to CPU and convert to numpy
                pred_np = pred_prob.cpu().numpy()
                
                # Store prediction for center slice
                predictions[k] = pred_np
                
                # Progress logging
                if (k - self.half_stack) % max(1, (depth - 2*self.half_stack) // 5) == 0:
                    avg_pred = pred_np.mean()
                    logger.info(f"  Processed slice {k}/{depth-1} - "
                               f"Avg prediction: {avg_pred:.4f}")
        
        logger.info("✓ Inference complete")
        
        return predictions
    
    def infer_from_file(self, volume_path: str) -> np.ndarray:
        """
        Load volume from file and run inference.
        
        Args:
            volume_path: Path to .npy volume
            
        Returns:
            3D prediction volume
        """
        volume = self.load_volume(volume_path)
        predictions = self.infer_volume(volume)
        return predictions


def save_predictions(predictions: np.ndarray, patient_id: str,
                    output_dir: str, format: str = 'npy') -> str:
    """
    Save predictions to disk.
    
    Args:
        predictions: 3D prediction volume (D, H, W)
        patient_id: Patient identifier
        output_dir: Output directory
        format: 'npy' or 'nii.gz'
        
    Returns:
        Path to saved file
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    filename = f"{patient_id}_prediction"
    
    if format == 'niy.gz' or format == 'nii.gz':
        import SimpleITK as sitk
        filepath = output_path / f"{filename}.nii.gz"
        
        # Convert to SimpleITK image
        image = sitk.GetImageFromArray(predictions)
        sitk.WriteImage(image, str(filepath))
        
    else:  # .npy
        filepath = output_path / f"{filename}.npy"
        np.save(str(filepath), predictions)
    
    logger.info(f"Saved predictions: {filepath}")
    return str(filepath)


def apply_threshold(predictions: np.ndarray, threshold: float = 0.5) -> np.ndarray:
    """
    Apply binary threshold to predictions.
    
    Args:
        predictions: Continuous prediction volume [0, 1]
        threshold: Threshold value
        
    Returns:
        Binary mask (0 or 1)
    """
    binary_mask = (predictions > threshold).astype(np.uint8)
    
    num_positive = (binary_mask > 0).sum()
    logger.info(f"Binary mask: {num_positive} positive voxels "
               f"({100*num_positive/binary_mask.size:.2f}%)")
    
    return binary_mask


def main():
    """Main inference execution."""
    parser = argparse.ArgumentParser(
        description="Run 2.5D SegResNet inference on CT volumes"
    )
    parser.add_argument(
        '--model',
        type=str,
        required=True,
        help='Path to trained model checkpoint (.pth)'
    )
    parser.add_argument(
        '--input',
        type=str,
        required=True,
        help='Input volume file or directory of .npy files'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='outputs/predictions',
        help='Output directory for predictions'
    )
    parser.add_argument(
        '--device',
        type=str,
        default='cuda',
        help='Device: cuda or cpu'
    )
    parser.add_argument(
        '--threshold',
        type=float,
        default=0.5,
        help='Binary threshold for final mask'
    )
    parser.add_argument(
        '--format',
        type=str,
        default='npy',
        help='Output format: npy or nii.gz'
    )
    
    args = parser.parse_args()
    
    logger.info("="*60)
    logger.info("SegResNet Inference")
    logger.info("="*60 + "\n")
    
    # Check device availability
    if args.device == 'cuda' and not torch.cuda.is_available():
        logger.warning("CUDA not available, falling back to CPU")
        args.device = 'cuda'
    
    # Initialize inference engine
    try:
        inference = SegResNetInference(args.model, device=args.device)
    except Exception as e:
        logger.error(f"Failed to initialize inference: {e}")
        return 1
    
    input_path = Path(args.input)
    
    if input_path.is_file():
        # Single file inference
        logger.info(f"Processing single file: {input_path}")
        
        try:
            # Extract patient ID from filename
            patient_id = input_path.stem
            
            # Run inference
            predictions = inference.infer_from_file(str(input_path))
            
            # Apply threshold if requested
            binary_mask = apply_threshold(predictions, args.threshold)
            
            # Save predictions (continuous)
            save_predictions(predictions, f"{patient_id}_prob", args.output, args.format)
            
            # Save binary mask
            save_predictions(binary_mask, f"{patient_id}_mask", args.output, 'npy')
            
            logger.info(f"✓ Inference complete for {patient_id}\n")
            
        except Exception as e:
            logger.error(f"Failed to process {input_path}: {e}")
            return 1
    
    elif input_path.is_dir():
        # Batch inference on directory
        volume_files = sorted(input_path.glob('*_image.npy'))
        
        if not volume_files:
            logger.error(f"No *_image.npy files found in {input_path}")
            return 1
        
        logger.info(f"Processing {len(volume_files)} volumes...\n")
        
        successful = 0
        failed = 0
        
        for volume_file in volume_files:
            try:
                # Extract patient ID
                patient_id = volume_file.stem.replace('_image', '')
                
                logger.info(f"\n[{successful+failed+1}/{len(volume_files)}] {patient_id}")
                
                # Run inference
                predictions = inference.infer_from_file(str(volume_file))
                
                # Apply threshold
                binary_mask = apply_threshold(predictions, args.threshold)
                
                # Save outputs
                save_predictions(predictions, f"{patient_id}_prob", args.output, args.format)
                save_predictions(binary_mask, f"{patient_id}_mask", args.output, 'npy')
                
                successful += 1
                
            except Exception as e:
                logger.error(f"Failed to process {patient_id}: {e}")
                failed += 1
                continue
        
        logger.info("\n" + "="*60)
        logger.info(f"Batch inference complete: {successful} successful, {failed} failed")
        logger.info("="*60)
        
        return 0 if failed == 0 else 1
    
    else:
        logger.error(f"Invalid input path: {input_path}")
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
