"""
Module: transforms.py
Purpose: Data augmentation and preprocessing transforms
         Applied during training to increase data diversity
         Applied during inference for normalization

Typical transforms:
- Normalization (Hounsfield Unit normalization for CT)
- Resizing
- Rotation, flipping (data augmentation)
- Elastic deformation
"""

import numpy as np
from typing import Tuple


class NormalizeHU:
    """
    Normalize CT image to Hounsfield Unit (HU) range.
    
    Typical ranges:
    - Lung: -1000 to -400 HU
    - Tissue: -400 to 0 HU
    - Soft tissue: 0 to 50 HU
    """
    
    def __init__(self, hu_min: int = -1500, hu_max: int = 500):
        """
        Args:
            hu_min: Minimum HU value to clip
            hu_max: Maximum HU value to clip
        """
        self.hu_min = hu_min
        self.hu_max = hu_max
    
    def __call__(self, image: np.ndarray) -> np.ndarray:
        """Normalize image to HU range."""
        # TODO: Implement HU normalization
        # Clipping: np.clip(image, self.hu_min, self.hu_max)
        # Scaling: (image - min) / (max - min)
        return image


class ResizeImage:
    """Resize image to fixed size."""
    
    def __init__(self, size: Tuple[int, int] = (512, 512)):
        """
        Args:
            size: Target image size (height, width)
        """
        self.size = size
    
    def __call__(self, image: np.ndarray) -> np.ndarray:
        """Resize image using interpolation."""
        # TODO: Use cv2.resize or scipy.ndimage.zoom
        return image


class RandomFlip:
    """Random horizontal/vertical flip for augmentation."""
    
    def __init__(self, p: float = 0.5):
        """
        Args:
            p: Probability of flip
        """
        self.p = p
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple:
        """Apply random flip to both image and mask."""
        # TODO: Apply flip consistently to image and mask
        return image, mask


class RandomRotate:
    """Random rotation for augmentation."""
    
    def __init__(self, angle_range: Tuple[float, float] = (-15, 15)):
        """
        Args:
            angle_range: Min/max rotation angles in degrees
        """
        self.angle_range = angle_range
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple:
        """Apply random rotation to both image and mask."""
        # TODO: Use scipy.ndimage.rotate
        return image, mask


class Compose:
    """Compose multiple transforms."""
    
    def __init__(self, transforms: list):
        """
        Args:
            transforms: List of transforms to apply in order
        """
        self.transforms = transforms
    
    def __call__(self, image: np.ndarray, mask: np.ndarray) -> Tuple:
        """Apply all transforms sequentially."""
        for transform in self.transforms:
            image, mask = transform(image, mask)
        return image, mask


def get_train_transforms() -> Compose:
    """Get transforms for training (with augmentation)."""
    # TODO: Compose augmentation transforms
    return Compose([
        NormalizeHU(),
        ResizeImage((512, 512)),
        RandomFlip(p=0.5),
        RandomRotate(angle_range=(-15, 15)),
    ])


def get_val_transforms() -> Compose:
    """Get transforms for validation/test (no augmentation)."""
    # TODO: Compose preprocessing-only transforms
    return Compose([
        NormalizeHU(),
        ResizeImage((512, 512)),
    ])
