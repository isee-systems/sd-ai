# Behavioral Evaluation Using ISTS

This module provides tools for classifying System Dynamics model output (time series data) 
into one of 25 generic dynamic behavior patterns using the ISTS (Inductive System for Time Series) library.

## Directory Structure

```
behavioral_evaluation_using_ists/
├── README.md                 # This file
├── requirements.txt          # Python dependencies
├── build.py                  # Build script for creating executable
├── ists_demo.ipynb          # Interactive Jupyter notebook demo
│
├── src/
│   └── classify_behavior.py  # Main classification module & CLI tool
│
├── tests/
│   ├── test_classify_behavior.py  # Unit tests for Python module
│   └── test_exe.py               # Tests for standalone executable
│
├── dist_examples/            # Distributable folder with exe and examples
│   ├── README.md             # Quick-start guide for exe users
│   ├── classify_behavior.exe # Standalone executable
│   └── exe_usage_example.ipynb  # Example notebook for exe usage
│
├── ISTS/                     # ISTS library (git submodule - https://github.com/UB-IAD/ISTS)
│   ├── ists.py               # ISTS algorithm implementation
│   └── lib/                  # Training data
│
└── docs/
    ├── ISTS Read me.txt      # Original ISTS documentation
    └── genericdynamicpatterns all.pdf  # Reference for pattern types
```

## Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. (Optional) Build standalone executable:
```bash
python build.py
```

## Usage

### As a Python Module

```python
from src.classify_behavior import BehaviorClassifier
import numpy as np

# Create classifier
classifier = BehaviorClassifier()

# Generate or load your time series data
t = np.linspace(0, 10, 100)
data = 5 * np.exp(0.3 * t)  # Exponential growth

# Classify
result = classifier.classify(data)
print(f"Pattern: {result.class_name}")  # 'pexgr' (positive exponential growth)
print(f"Description: {result.class_description}")

# Test a hypothesis
confirmed, is_weak = classifier.test_hypothesis(data, 'pexgr')
print(f"Hypothesis confirmed: {confirmed}")
```

### Command Line Interface

```bash
# Basic classification
python src/classify_behavior.py data.csv

# Specify column and output format
python src/classify_behavior.py data.csv --column value --format json

# Save results to file
python src/classify_behavior.py data.csv --output results.json

# Test a hypothesis
python src/classify_behavior.py data.csv --hypothesis pexgr

# List all available patterns
python src/classify_behavior.py --list-patterns
```

### Standalone Executable

After building with `python build.py`:

```bash
# Windows
dist\classify_behavior.exe data.csv
dist\classify_behavior.exe --list-patterns
dist\classify_behavior.exe data.csv --format json

# Test the executable
python tests/test_exe.py
```

## Available Behavior Patterns

The ISTS library classifies time series into 25 generic dynamic behavior patterns:

| ID | Code   | Description                          |
|----|--------|--------------------------------------|
| 0  | zero0  | Zero/No Data                         |
| 1  | const  | Constant/Stasis                      |
| 2  | plinr  | Positive Linear Growth               |
| 3  | nlinr  | Negative Linear (Decay)              |
| 4  | nexgr  | Negative Exponential Growth          |
| 5  | sshgr  | S-Shaped Growth                      |
| 6  | pexgr  | Positive Exponential Growth          |
| 7  | gr1da  | Linear Growth with Decay (A)         |
| 8  | gr1db  | Linear Growth with Decay (B)         |
| 9  | gr2da  | Exponential Growth with Decay (A)    |
| 10 | gr2db  | Exponential Growth with Decay (B)    |
| 11 | d1peg  | Linear Decay to Positive Exp Growth  |
| 12 | d2peg  | Exp Decay to Positive Exp Growth     |
| 13 | nexdc  | Negative Exponential Decay           |
| 14 | sshdc  | S-Shaped Decay                       |
| 15 | pexdc  | Positive Exponential Decay           |
| 16 | d1gra  | Linear Decay to Growth (A)           |
| 17 | d1grb  | Linear Decay to Growth (B)           |
| 18 | d2gra  | Exp Decay to Growth (A)              |
| 19 | d2grb  | Exp Decay to Growth (B)              |
| 20 | g1ped  | Linear Growth to Exp Decay           |
| 21 | g2ped  | Exp Growth to Exp Decay              |
| 22 | oscct  | Oscillation Constant                 |
| 23 | oscgr  | Oscillation with Growth              |
| 24 | oscdc  | Oscillation with Decay               |

## Running Tests

### Unit Tests (Python Module)

```bash
# Using pytest
pytest tests/test_classify_behavior.py -v

# Or run directly
python tests/test_classify_behavior.py
```

### Executable Tests

```bash
# First build the executable
python build.py

# Then run exe tests
python tests/test_exe.py

# With verbose output
python tests/test_exe.py --verbose
```

## API Reference

### BehaviorClassifier

**`classify(data, top_n=3) -> ClassificationResult`**
- Classifies time series data into a behavior pattern
- Returns classification result with class ID, name, description, likelihood, and top matches

**`test_hypothesis(data, hypothesis_code) -> Tuple[bool, bool]`**
- Tests if data matches a hypothesized pattern
- Returns (confirmed, is_weak_match)

**`classify_multiple(datasets, top_n=3) -> Dict[str, ClassificationResult]`**
- Classifies multiple time series at once

### ClassificationResult

```python
@dataclass
class ClassificationResult:
    class_id: int           # Numeric ID (0-24)
    class_name: str         # Pattern code (e.g., 'pexgr')
    class_description: str  # Human-readable description
    likelihood: float       # Classification confidence
    is_weak_match: bool     # True if confidence is low
    top_matches: List[Dict] # Top N alternative matches
```

## References

- ISTS Library: Inductive System for Time Series classification
- Generic Dynamic Patterns: See `docs/genericdynamicpatterns all.pdf`
