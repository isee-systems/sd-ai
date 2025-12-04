"""
Behavioral Classification Tool for System Dynamics Model Output

This module provides functionality to classify time series data into one of 25
generic dynamic behavior patterns using the ISTS (Inductive System for Time Series) library.

Usage:
    As a module:
        from classify_behavior import BehaviorClassifier
        classifier = BehaviorClassifier()
        result = classifier.classify(time_series_data)
    
    As a command-line tool:
        python classify_behavior.py input.csv --output results.json
        python classify_behavior.py input.csv --column "value" --format json
"""

import argparse
import json
import sys
import os
import csv
from typing import List, Dict, Any, Optional, Union, Tuple
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np

# Add ISTS library to path - handle both normal and PyInstaller frozen cases
def _setup_ists_path():
    """Configure path to find ISTS library."""
    if getattr(sys, 'frozen', False):
        # Running as compiled executable
        base_path = Path(sys._MEIPASS)
        ists_path = base_path / "ISTS-1.0"
    else:
        # Running as script
        _current_dir = Path(__file__).parent.resolve()
        ists_path = _current_dir.parent / "ISTS-1.0"
    
    if str(ists_path) not in sys.path:
        sys.path.insert(0, str(ists_path))
    
    return ists_path

_ists_path = _setup_ists_path()

from ists import ists as ISTS


@dataclass
class ClassificationResult:
    """Result of a behavior classification."""
    class_id: int
    class_name: str
    class_description: str
    likelihood: float
    is_weak_match: bool
    top_matches: List[Dict[str, Any]]


# Pattern descriptions for all 25 behavior modes
PATTERN_DESCRIPTIONS = {
    0: "Zero/No Data",
    1: "Constant/Stasis",
    2: "Positive Linear Growth",
    3: "Negative Linear (Decay)",
    4: "Negative Exponential Growth",
    5: "S-Shaped Growth",
    6: "Positive Exponential Growth",
    7: "Linear Growth with Decay (A)",
    8: "Linear Growth with Decay (B)",
    9: "Exponential Growth with Decay (A)",
    10: "Exponential Growth with Decay (B)",
    11: "Linear Decay to Positive Exp Growth",
    12: "Exp Decay to Positive Exp Growth",
    13: "Negative Exponential Decay",
    14: "S-Shaped Decay",
    15: "Positive Exponential Decay",
    16: "Linear Decay to Growth (A)",
    17: "Linear Decay to Growth (B)",
    18: "Exp Decay to Growth (A)",
    19: "Exp Decay to Growth (B)",
    20: "Linear Growth to Exp Decay",
    21: "Exp Growth to Exp Decay",
    22: "Oscillation Constant",
    23: "Oscillation with Growth",
    24: "Oscillation with Decay"
}


class BehaviorClassifier:
    """
    Classifier for time series behavior patterns.
    
    Uses the ISTS library to classify time series data into one of 25
    generic dynamic behavior patterns commonly found in System Dynamics models.
    """
    
    def __init__(self):
        """Initialize the classifier with ISTS instance."""
        self._ists = ISTS()
    
    @property
    def pattern_codes(self) -> List[str]:
        """Get list of all pattern codes."""
        return self._ists.IDS.copy()
    
    @property
    def pattern_descriptions(self) -> Dict[int, str]:
        """Get dictionary of pattern descriptions."""
        return PATTERN_DESCRIPTIONS.copy()
    
    def classify(self, 
                 data: Union[List[float], np.ndarray],
                 top_n: int = 3) -> ClassificationResult:
        """
        Classify a time series into a behavior pattern.
        
        Args:
            data: Time series data (list or numpy array of floats)
            top_n: Number of top matches to include in results
            
        Returns:
            ClassificationResult with classification details
            
        Raises:
            ValueError: If data is empty or invalid
        """
        # Validate input
        if data is None or len(data) == 0:
            raise ValueError("Data cannot be empty")
        
        # Convert to numpy array if needed
        if isinstance(data, list):
            data = np.array(data, dtype=float)
        
        if len(data) < 10:
            raise ValueError("Data must have at least 10 points for reliable classification")
        
        # Get classification
        class_id = self._ists.GetClassId(data)
        class_name = self._ists.getClassNameById(class_id)
        likelihood_table = self._ists.class_likelihood_all(data)
        
        # Determine if match is weak
        is_weak = bool(max(likelihood_table) <= -2)
        
        # Get top N matches
        sorted_indices = np.argsort(likelihood_table)[::-1][:top_n]
        top_matches = []
        for idx in sorted_indices:
            top_matches.append({
                "class_id": int(idx),
                "class_name": self._ists.getClassNameById(idx),
                "class_description": PATTERN_DESCRIPTIONS.get(idx, "Unknown"),
                "likelihood": float(likelihood_table[idx])
            })
        
        return ClassificationResult(
            class_id=int(class_id),
            class_name=class_name,
            class_description=PATTERN_DESCRIPTIONS.get(class_id, "Unknown"),
            likelihood=float(likelihood_table[class_id]),
            is_weak_match=is_weak,
            top_matches=top_matches
        )
    
    def test_hypothesis(self, 
                        data: Union[List[float], np.ndarray],
                        hypothesis_code: str) -> Tuple[bool, bool]:
        """
        Test if data matches a hypothesized behavior pattern.
        
        Args:
            data: Time series data
            hypothesis_code: The pattern code to test (e.g., 'pexgr', 'oscct')
            
        Returns:
            Tuple of (hypothesis_confirmed, is_weak_match)
            
        Raises:
            ValueError: If hypothesis_code is not valid
        """
        if hypothesis_code not in self._ists.IDS:
            valid_codes = ", ".join(self._ists.IDS)
            raise ValueError(f"Invalid hypothesis code '{hypothesis_code}'. Valid codes: {valid_codes}")
        
        if isinstance(data, list):
            data = np.array(data, dtype=float)
        
        result, table, weak = self._ists.TestDataClass(data, hypothesis_code)
        return bool(result), bool(weak)
    
    def classify_multiple(self, 
                          datasets: Dict[str, Union[List[float], np.ndarray]],
                          top_n: int = 3) -> Dict[str, ClassificationResult]:
        """
        Classify multiple time series.
        
        Args:
            datasets: Dictionary mapping names to time series data
            top_n: Number of top matches to include in each result
            
        Returns:
            Dictionary mapping names to ClassificationResults
        """
        results = {}
        for name, data in datasets.items():
            try:
                results[name] = self.classify(data, top_n)
            except ValueError as e:
                print(f"Warning: Could not classify '{name}': {e}", file=sys.stderr)
        return results


def load_csv_data(filepath: str, 
                  column: Optional[str] = None,
                  skip_header: bool = True) -> np.ndarray:
    """
    Load time series data from a CSV file.
    
    Args:
        filepath: Path to the CSV file
        column: Column name or index to use (default: first numeric column)
        skip_header: Whether the file has a header row
        
    Returns:
        Numpy array of the time series data
    """
    data = []
    
    with open(filepath, 'r', newline='') as f:
        reader = csv.reader(f)
        
        if skip_header:
            header = next(reader, None)
            if column and header:
                try:
                    col_idx = int(column)
                except ValueError:
                    col_idx = header.index(column) if column in header else 0
            else:
                col_idx = 0
        else:
            col_idx = int(column) if column else 0
        
        for row in reader:
            if row and len(row) > col_idx:
                try:
                    data.append(float(row[col_idx]))
                except ValueError:
                    continue
    
    return np.array(data)


def load_json_data(filepath: str, key: Optional[str] = None) -> np.ndarray:
    """
    Load time series data from a JSON file.
    
    Args:
        filepath: Path to the JSON file
        key: Key to access data if JSON is an object (default: use root if array)
        
    Returns:
        Numpy array of the time series data
    """
    with open(filepath, 'r') as f:
        data = json.load(f)
    
    if key:
        data = data[key]
    
    if isinstance(data, dict):
        # Try common keys
        for k in ['data', 'values', 'timeseries', 'series', 'y']:
            if k in data:
                data = data[k]
                break
    
    return np.array(data, dtype=float)


def format_output(result: ClassificationResult, format_type: str = "text") -> str:
    """Format classification result for output."""
    if format_type == "json":
        return json.dumps(asdict(result), indent=2)
    elif format_type == "csv":
        return f"{result.class_id},{result.class_name},{result.class_description},{result.likelihood},{result.is_weak_match}"
    else:  # text
        lines = [
            "=" * 60,
            "BEHAVIOR CLASSIFICATION RESULT",
            "=" * 60,
            f"Class ID:          {result.class_id}",
            f"Class Name:        {result.class_name}",
            f"Description:       {result.class_description}",
            f"Likelihood:        {result.likelihood:.4f}",
            f"Weak Match:        {'Yes' if result.is_weak_match else 'No'}",
            "",
            "Top Matches:",
        ]
        for i, match in enumerate(result.top_matches, 1):
            lines.append(f"  {i}. {match['class_name']} ({match['class_description']}) - {match['likelihood']:.4f}")
        lines.append("=" * 60)
        return "\n".join(lines)


def main():
    """Main entry point for command-line usage."""
    parser = argparse.ArgumentParser(
        description="Classify time series behavior patterns for System Dynamics model output",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s data.csv
  %(prog)s data.csv --column value --format json
  %(prog)s data.json --output results.json
  %(prog)s data.csv --hypothesis pexgr
  %(prog)s --list-patterns

Pattern Codes:
  const  - Constant/Stasis
  plinr  - Positive Linear Growth
  pexgr  - Positive Exponential Growth
  sshgr  - S-Shaped Growth
  nexdc  - Negative Exponential Decay
  oscct  - Oscillation Constant
  (use --list-patterns for full list)
        """
    )
    
    parser.add_argument("input", nargs="?", help="Input file (CSV or JSON)")
    parser.add_argument("-c", "--column", help="Column name or index for CSV files")
    parser.add_argument("-o", "--output", help="Output file path")
    parser.add_argument("-f", "--format", choices=["text", "json", "csv"], 
                        default="text", help="Output format (default: text)")
    parser.add_argument("--hypothesis", help="Test if data matches a specific pattern code")
    parser.add_argument("--top", type=int, default=3, help="Number of top matches to show")
    parser.add_argument("--list-patterns", action="store_true", 
                        help="List all available pattern codes")
    parser.add_argument("--version", action="version", version="%(prog)s 1.0.0")
    
    args = parser.parse_args()
    
    # List patterns and exit
    if args.list_patterns:
        classifier = BehaviorClassifier()
        print("\nAvailable Behavior Pattern Codes:")
        print("=" * 60)
        print(f"{'ID':<4} {'Code':<8} {'Description':<40}")
        print("-" * 60)
        for i, code in enumerate(classifier.pattern_codes):
            desc = PATTERN_DESCRIPTIONS.get(i, "Unknown")
            print(f"{i:<4} {code:<8} {desc:<40}")
        print("=" * 60)
        return 0
    
    # Require input file for classification
    if not args.input:
        parser.error("Input file is required (use --list-patterns to see available patterns)")
    
    # Load data
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1
    
    try:
        if input_path.suffix.lower() == ".json":
            data = load_json_data(str(input_path))
        else:
            data = load_csv_data(str(input_path), args.column)
    except Exception as e:
        print(f"Error loading data: {e}", file=sys.stderr)
        return 1
    
    if len(data) == 0:
        print("Error: No valid data found in input file", file=sys.stderr)
        return 1
    
    # Create classifier
    try:
        classifier = BehaviorClassifier()
    except Exception as e:
        print(f"Error initializing classifier: {e}", file=sys.stderr)
        return 1
    
    # Test hypothesis or classify
    if args.hypothesis:
        try:
            confirmed, is_weak = classifier.test_hypothesis(data, args.hypothesis)
            if args.format == "json":
                output = json.dumps({
                    "hypothesis": args.hypothesis,
                    "confirmed": confirmed,
                    "is_weak_match": is_weak
                }, indent=2)
            else:
                status = "CONFIRMED" if confirmed else "REJECTED"
                weak_note = " (weak match)" if is_weak else ""
                output = f"Hypothesis '{args.hypothesis}': {status}{weak_note}"
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 1
    else:
        try:
            result = classifier.classify(data, args.top)
            output = format_output(result, args.format)
        except ValueError as e:
            print(f"Error classifying data: {e}", file=sys.stderr)
            return 1
    
    # Output results
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output)
        print(f"Results written to: {args.output}")
    else:
        print(output)
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
