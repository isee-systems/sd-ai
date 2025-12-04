"""
Behavioral Evaluation Using ISTS

This package provides tools for classifying System Dynamics model output
(time series data) into generic dynamic behavior patterns.
"""

from .classify_behavior import (
    BehaviorClassifier,
    ClassificationResult,
    PATTERN_DESCRIPTIONS,
    load_csv_data,
    load_json_data,
    format_output
)

__version__ = "1.0.0"
__all__ = [
    "BehaviorClassifier",
    "ClassificationResult", 
    "PATTERN_DESCRIPTIONS",
    "load_csv_data",
    "load_json_data",
    "format_output"
]
