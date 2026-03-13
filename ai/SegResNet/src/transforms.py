"""
Module: transforms.py
Purpose: Data augmentation and preprocessing transforms for 2.5D lung nodule segmentation.

Transforms handle:
1. Intensity normalization (HU windowing for CT)
2. Minimal medical-appropriate augmentation
3. Conversion to PyTorch tensors

Design philosophy:
- Keep augmentations light and medically sound
- Avoid extreme transformations that change lesion appearance
- Normalize based on typical CT intensities
"""

import numpy as np
import torch
from typing import Tuple
import logging

logger = logging.getLogger(__name__)


class CTNormalize:
    """
    Normalize CT intensity values.
    
    HU (Hounsfield Unit) ranges:
    - Air: -1000 HU
    - Lung: -1000 to -400 HU (focus area)
    - Fat: -100 to -50 HU
    - Soft tissue: 10 to 60 HU
    - Bone: 300+ HU
    
    This normalizer clips and scales to [-1, 1] range suitable for neural networks.
    """
    
    def __init__(self, hu_min: float = -1200, hu_max: float = 200):
        """
        Args:
            hu_min: Minimum HU value to consider (below = air)
            hu_max: Maximum HU value to consider (above = bone/very dense)
        """
        self.hu_min = hu_min
        self.hu_max = hu_max
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Normalize image intensity, leave mask unchanged.
        
        Args:
            image: (5, H, W) float32
            mask: (1, H, W) or (H, W) float32
            
        Returns:
            (normalized_image, mask_unchanged)
        """
        # Clip to HU range
        image = np.clip(image, self.hu_min, self.hu_max)
        
        # Normalize to [-1, 1]
        image = 2 * (image - self.hu_min) / (self.hu_max - self.hu_min) - 1.0
        
        return image, mask


class RandomFlip:
    """
    Random horizontal flip for data augmentation.
    
    Applied equally to image and mask to maintain correspondence.
    Medical note: Horizontal flip is appropriate for symmetric anatomy.
    """
    
    def __init__(self, p: float = 0.5, axis: int = 2):
        """
        Args:
            p: Probability of flip
            axis: Axis to flip along (2 = horizontal, 1 = vertical)
        """
        self.p = p
        self.axis = axis
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Apply random flip to both image and mask."""
        if np.random.rand() < self.p:
            image = np.flip(image, axis=self.axis).copy()
            mask = np.flip(mask, axis=self.axis).copy()
        
        return image, mask


class RandomRotate:
    """
    Random rotation for data augmentation.
    
    Medical note: Small rotations preserve anatomy while augmenting dataset.
    Uses nearest-neighbor for masks to preserve binary values.
    """
    
    def __init__(self, angle_range: Tuple[float, float] = (-15, 15), p: float = 0.5):
        """
        Args:
            angle_range: (min_angle, max_angle) in degrees
            p: Probability of rotation
        """
        self.angle_range = angle_range
        self.p = p
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Apply random rotation to both image and mask."""
        from scipy.ndimage import rotate
        
        if np.random.rand() < self.p:
            # Random angle within range
            angle = np.random.uniform(self.angle_range[0], self.angle_range[1])
            
            # Rotate each channel independently
            for c in range(image.shape[0]):
                image[c] = rotate(image[c], angle, reshape=False, order=1)
            
            # Rotate mask with order=0 (nearest neighbor) to keep binary
            mask_2d = mask[0] if mask.shape[0] == 1 else mask
            mask_2d = rotate(mask_2d, angle, reshape=False, order=0)
            mask = np.expand_dims(mask_2d, axis=0) if mask.shape[0] == 1 else mask_2d
        
        return image, mask


class RandomGamma:
    """
    Random gamma adjustment for intensity variation.
    
    Medical note: Simulates varying image brightness/contrast
    due to different scanner settings or calibrations.
    """
    
    def __init__(self, gamma_range: Tuple[float, float] = (0.8, 1.2), p: float = 0.5):
        """
        Args:
            gamma_range: (min_gamma, max_gamma)
            p: Probability of adjustment
        """
        self.gamma_range = gamma_range
        self.p = p
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Apply random gamma adjustment to image only."""
        if np.random.rand() < self.p:
            gamma = np.random.uniform(self.gamma_range[0], self.gamma_range[1])
            
            # Normalize to [0, 1] for gamma correction, then back
            image_min = image.min()
            image_max = image.max()
            
            if image_max > image_min:
                image_norm = (image - image_min) / (image_max - image_min)
                image_norm = np.power(image_norm, gamma)
                image = image_norm * (image_max - image_min) + image_min
        
        return image, mask


class ToTensor:
    """
    Convert numpy arrays to PyTorch tensors.
    
    Final transform in pipeline.
    """
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Convert to tensors.
        
        Args:
            image: (5, H, W) float32
            mask: (1, H, W) float32
            
        Returns:
            (image_tensor, mask_tensor)
        """
        image = torch.from_numpy(image).float()
        mask = torch.from_numpy(mask).float()
        
        return image, mask


class Compose:
    """Compose multiple transforms sequentially."""
    
    def __init__(self, transforms: list):
        """
        Args:
            transforms: List of transform objects
        """
        self.transforms = transforms
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple:
        """Apply all transforms in sequence."""
        for transform in self.transforms:
            image, mask = transform(image, mask)
        
        return image, mask


# ============================================================================
# Pre-built transform pipelines
# ============================================================================

def get_train_transforms() -> Compose:
    """
    Get transforms for training (includes augmentation).
    
    Pipeline:
    1. Normalize HU intensity
    2. Random flips (horizontal/vertical)
    3. Random rotation (mild)
    4. Random gamma adjustment (brightness/contrast)
    5. Convert to tensors
    """
    return Compose([
        CTNormalize(hu_min=-1200, hu_max=200),
        RandomFlip(p=0.5, axis=2),           # Horizontal flip
        RandomFlip(p=0.3, axis=1),           # Vertical flip (less aggressive)
        RandomRotate(angle_range=(-10, 10), p=0.5),
        RandomGamma(gamma_range=(0.9, 1.1), p=0.5),
        ToTensor(),
    ])


def get_val_transforms() -> Compose:
    """
    Get transforms for validation/test (no augmentation).
    
    Pipeline:
    1. Normalize HU intensity
    2. Convert to tensors
    """
    return Compose([
        CTNormalize(hu_min=-1200, hu_max=200),
        ToTensor(),
    ])
