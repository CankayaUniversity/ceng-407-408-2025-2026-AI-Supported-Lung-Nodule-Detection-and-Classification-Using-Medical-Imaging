"""
Module: postprocess.py
Purpose: Post-processing utilities for lung nodule segmentation predictions.

This module provides practical tools to refine raw model predictions:
1. Binary thresholding (convert probability map to binary mask)
2. Connected component analysis (find individual nodules)
3. Size filtering (remove very small false positives)
4. Morphological operations (clean up noisy masks)

Why post-processing helps:
- Model outputs probability [0, 1] → need binary decision
- Small artifacts are often false positives → filter them
- Morphological closing fills small holes in nodules
- Morphological opening removes thin spurious connections
"""

import logging
from typing import Tuple, List

import numpy as np
from scipy import ndimage
from scipy.ndimage import label, binary_closing, binary_opening, binary_fill_holes

logger = logging.getLogger(__name__)


class BinaryThreshold:
    """Convert probability predictions to binary mask using threshold."""
    
    def __init__(self, threshold: float = 0.5):
        """
        Args:
            threshold: Probability threshold (0 to 1)
        """
        if not 0 <= threshold <= 1:
            raise ValueError(f"Threshold must be in [0, 1], got {threshold}")
        
        self.threshold = threshold
    
    def __call__(self, probability_map: np.ndarray) -> np.ndarray:
        """
        Apply threshold to probability map.
        
        Args:
            probability_map: Float array with values in [0, 1]
            
        Returns:
            Binary mask (0 or 1)
        """
        binary_mask = (probability_map > self.threshold).astype(np.uint8)
        
        num_positive = (binary_mask > 0).sum()
        total_voxels = binary_mask.size
        
        logger.info(f"Thresholded at {self.threshold}: "
                   f"{num_positive}/{total_voxels} voxels positive "
                   f"({100*num_positive/total_voxels:.2f}%)")
        
        return binary_mask


class ConnectedComponentFilter:
    """
    Find and filter connected components by size.
    
    Purpose: Remove small spurious regions (false positives)
    that are unlikely to be real nodules.
    """
    
    def __init__(self, min_size: int = 50, max_components: int = None):
        """
        Args:
            min_size: Minimum voxel count to keep a component
            max_components: If set, keep only top N largest components
        """
        self.min_size = min_size
        self.max_components = max_components
    
    def __call__(self, binary_mask: np.ndarray) -> Tuple[np.ndarray, dict]:
        """
        Filter components by size.
        
        Args:
            binary_mask: Binary segmentation (0 or 1)
            
        Returns:
            Tuple of (filtered_mask, statistics_dict)
        """
        logger.info(f"Connected component analysis (min_size={self.min_size})...")
        
        # Label connected components
        labeled_array, num_components = label(binary_mask)
        
        logger.info(f"  Found {num_components} connected components")
        
        if num_components == 0:
            logger.warning("  No components found!")
            return np.zeros_like(binary_mask), {'num_components': 0, 'kept': 0}
        
        # Get component sizes
        component_sizes = np.bincount(labeled_array.ravel())
        component_sizes[0] = 0  # Ignore background (label 0)
        
        # Find components larger than min_size
        valid_labels = np.where(component_sizes >= self.min_size)[0]
        
        logger.info(f"  Components above threshold: {len(valid_labels)}")
        
        # If max_components specified, keep only the largest ones
        if self.max_components and len(valid_labels) > self.max_components:
            # Get top N by size
            sizes = component_sizes[valid_labels]
            top_indices = np.argsort(-sizes)[:self.max_components]
            valid_labels = valid_labels[top_indices]
            
            logger.info(f"  Kept only top {self.max_components} largest components")
        
        # Create filtered mask
        filtered_mask = np.zeros_like(binary_mask)
        for label_id in valid_labels:
            filtered_mask[labeled_array == label_id] = 1
        
        stats = {
            'num_components_original': num_components,
            'num_components_kept': len(valid_labels),
            'num_voxels_original': binary_mask.sum(),
            'num_voxels_kept': filtered_mask.sum(),
        }
        
        logger.info(f"  Kept {stats['num_components_kept']} components, "
                   f"{stats['num_voxels_kept']} voxels")
        
        return filtered_mask, stats


class MorphologicalCleanup:
    """
    Apply morphological operations to clean up masks.
    
    Operations:
    - Closing: fills small holes within nodules
    - Opening: removes thin false-positive regions
    - Fill holes: ensures solid nodule regions
    """
    
    def __init__(self, kernel_size: int = 3, operation: str = 'closing'):
        """
        Args:
            kernel_size: Size of morphological kernel (odd number)
            operation: 'closing', 'opening', 'both', or 'none'
        """
        if kernel_size % 2 == 0:
            raise ValueError(f"Kernel size must be odd, got {kernel_size}")
        
        if operation not in ['closing', 'opening', 'both', 'none']:
            raise ValueError(f"Unknown operation: {operation}")
        
        self.kernel_size = kernel_size
        self.operation = operation
    
    def _get_kernel(self) -> np.ndarray:
        """Create circular morphological kernel."""
        # Create square kernel
        kernel = np.zeros((self.kernel_size, self.kernel_size), dtype=bool)
        center = self.kernel_size // 2
        radius = center
        
        # Fill circle
        for i in range(self.kernel_size):
            for j in range(self.kernel_size):
                if (i - center)**2 + (j - center)**2 <= radius**2:
                    kernel[i, j] = 1
        
        return kernel
    
    def __call__(self, binary_mask: np.ndarray) -> np.ndarray:
        """
        Apply morphological cleanup.
        
        Args:
            binary_mask: Binary input mask (0 or 1)
            
        Returns:
            Cleaned mask
        """
        if self.operation == 'none':
            return binary_mask
        
        logger.info(f"Applying morphological {self.operation} (kernel={self.kernel_size})...")
        
        kernel = self._get_kernel()
        cleaned = binary_mask.copy()
        
        if self.operation in ['closing', 'both']:
            # Closing: fills small holes (dilate then erode)
            # Purpose: make nodules more solid, reduce internal holes
            cleaned = binary_closing(cleaned, structure=kernel)
        
        if self.operation in ['opening', 'both']:
            # Opening: removes thin regions (erode then dilate)
            # Purpose: remove thin false positive connections
            cleaned = binary_opening(cleaned, structure=kernel)
        
        # Fill remaining holes
        cleaned = binary_fill_holes(cleaned).astype(np.uint8)
        
        changed_voxels = (cleaned != binary_mask).sum()
        logger.info(f"  Modified {changed_voxels} voxels")
        
        return cleaned


class PostProcessor:
    """
    Complete post-processing pipeline.
    
    Combines multiple post-processing steps in sequence:
    1. Thresholding
    2. Connected component filtering
    3. Morphological cleanup
    """
    
    def __init__(self, threshold: float = 0.5,
                 min_component_size: int = 50,
                 morph_operation: str = 'closing',
                 morph_kernel_size: int = 3):
        """
        Args:
            threshold: Binary threshold
            min_component_size: Minimum voxels per component
            morph_operation: 'closing', 'opening', 'both', or 'none'
            morph_kernel_size: Morphological kernel size
        """
        self.threshold = BinaryThreshold(threshold)
        self.cc_filter = ConnectedComponentFilter(min_component_size)
        self.morph = MorphologicalCleanup(morph_kernel_size, morph_operation)
    
    def __call__(self, probability_map: np.ndarray) -> np.ndarray:
        """
        Run full post-processing pipeline.
        
        Args:
            probability_map: Float predictions [0, 1]
            
        Returns:
            Cleaned binary mask
        """
        logger.info("Starting post-processing pipeline...")
        logger.info("="*50)
        
        # Step 1: Thresholding
        binary = self.threshold(probability_map)
        
        # Step 2: Connected component filtering
        filtered, stats = self.cc_filter(binary)
        
        # Step 3: Morphological cleanup
        cleaned = self.morph(filtered)
        
        logger.info("="*50)
        logger.info("Post-processing complete")
        
        return cleaned


def extract_largest_component(binary_mask: np.ndarray) -> np.ndarray:
    """
    Extract only the largest connected component.
    
    Useful if only one nodule is expected per scan.
    
    Args:
        binary_mask: Binary mask
        
    Returns:
        Mask with only largest component
    """
    logger.info("Extracting largest connected component...")
    
    labeled_array, num_components = label(binary_mask)
    
    if num_components == 0:
        logger.warning("No components found!")
        return np.zeros_like(binary_mask)
    
    # Get component sizes
    component_sizes = np.bincount(labeled_array.ravel())
    largest_label = np.argmax(component_sizes[1:]) + 1  # Skip background
    
    largest_mask = (labeled_array == largest_label).astype(np.uint8)
    largest_size = component_sizes[largest_label]
    
    logger.info(f"  Largest component: {largest_size} voxels")
    
    return largest_mask


def get_postprocessor(strategy: str = 'standard') -> PostProcessor:
    """
    Create post-processor with pre-configured settings.
    
    Args:
        strategy: 'light', 'standard', or 'aggressive'
        
    Returns:
        PostProcessor instance
    """
    if strategy == 'light':
        # Minimal post-processing
        return PostProcessor(
            threshold=0.5,
            min_component_size=10,
            morph_operation='none'
        )
    
    elif strategy == 'standard':
        # Balanced post-processing
        return PostProcessor(
            threshold=0.5,
            min_component_size=50,
            morph_operation='closing',
            morph_kernel_size=3
        )
    
    elif strategy == 'aggressive':
        # Heavy post-processing
        return PostProcessor(
            threshold=0.5,
            min_component_size=100,
            morph_operation='both',
            morph_kernel_size=5
        )
    
    else:
        raise ValueError(f"Unknown strategy: {strategy}")


# ============================================================================
# Example usage
# ============================================================================

if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO)
    
    # Create dummy prediction
    prob_map = np.random.rand(100, 256, 256).astype(np.float32)
    
    # Create post-processor
    postprocessor = get_postprocessor('standard')
    
    # Process
    cleaned_mask = postprocessor(prob_map)
    
    print(f"Output shape: {cleaned_mask.shape}")
    print(f"Output dtype: {cleaned_mask.dtype}")
    print(f"Positive voxels: {(cleaned_mask > 0).sum()}")
