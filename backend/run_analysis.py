#!/usr/bin/env python3
"""
Wrapper script for AI analysis to be called from Node.js backend.
Takes command-line arguments and outputs JSON result to stdout.
"""

import sys
import json
import os
from ai_analysis import analyze_dicom_study


def main():
    """
    Expected command line arguments:
    1. study_dir: Directory containing DICOM files (e.g., backend/uploads/STD-123)
    2. model_path: Path to model checkpoint (e.g., backend/models/segresnet_25d_best_.pt)
    3. output_dir: Directory to save overlays (optional)
    4. top_k: Number of candidates to keep (optional, default 10)
    """
    if len(sys.argv) < 3:
        error_result = {
            'success': False,
            'error': 'Invalid arguments. Expected: study_dir model_path [output_dir] [top_k]'
        }
        print(json.dumps(error_result))
        sys.exit(1)
    
    study_dir = sys.argv[1]
    model_path = sys.argv[2]
    output_dir = sys.argv[3] if len(sys.argv) > 3 else None
    top_k = int(sys.argv[4]) if len(sys.argv) > 4 else 10
    
    # Validate paths
    if not os.path.isdir(study_dir):
        error_result = {
            'success': False,
            'error': f'Study directory not found: {study_dir}'
        }
        print(json.dumps(error_result))
        sys.exit(1)
    
    if not os.path.isfile(model_path):
        error_result = {
            'success': False,
            'error': f'Model checkpoint not found: {model_path}'
        }
        print(json.dumps(error_result))
        sys.exit(1)
    
    # Run analysis
    results = analyze_dicom_study(
        study_dir=study_dir,
        model_path=model_path,
        output_dir=output_dir,
        top_k=top_k,
        threshold=0.10
    )
    
    # Output JSON to stdout
    print(json.dumps(results))


if __name__ == '__main__':
    main()
