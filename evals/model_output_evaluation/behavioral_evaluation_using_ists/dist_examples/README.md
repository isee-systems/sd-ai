# Behavioral Classifier - Standalone Distribution

This folder contains the standalone executable for classifying time series data into 
behavioral patterns, along with an example notebook showing how to use it.

## Contents

- **classify_behavior.exe** - Standalone executable (no Python installation required)
- **exe_usage_example.ipynb** - Jupyter notebook demonstrating usage

## Quick Start

### List Available Patterns

```bash
classify_behavior.exe --list-patterns
```

### Classify from CSV File

```bash
# Create a CSV file with time series data
classify_behavior.exe data.csv --format json
```

### Classify from JSON Input

```bash
# Pass JSON array directly
classify_behavior.exe "[1, 2, 4, 8, 16, 32]" --format json
```

### Test a Hypothesis

```bash
classify_behavior.exe data.csv --hypothesis pexgr --format json
```

## Input Formats

### CSV File
```csv
time,value
0,1.0
1,2.0
2,4.0
3,8.0
```

### JSON Array (inline or file)
```json
[1.0, 2.0, 4.0, 8.0, 16.0]
```

## Output Formats

Use `--format` to specify output format:
- `json` - Machine-readable JSON (recommended for programmatic use)
- `text` - Human-readable text (default)
- `csv` - CSV format

## Common Options

| Option | Description |
|--------|-------------|
| `--format {json,text,csv}` | Output format |
| `--hypothesis CODE` | Test if data matches a specific pattern |
| `--top N` | Show top N pattern matches (default: 3) |
| `--column NAME` | Column to use from CSV (default: auto-detect) |
| `--output FILE` | Save results to file |
| `--list-patterns` | List all 25 available behavior patterns |
| `--version` | Show version |
| `--help` | Show help |

## Example JSON Output

```json
{
    "class_id": 6,
    "class_name": "pexgr",
    "class_description": "Positive Exponential Growth",
    "likelihood": 0.95,
    "is_weak_match": false,
    "top_matches": [
        {"class_name": "pexgr", "likelihood": 0.95},
        {"class_name": "plinr", "likelihood": 0.03},
        {"class_name": "sshgr", "likelihood": 0.01}
    ]
}
```

## Requirements

- **Windows** - The executable example is built for Windows
- **No Python required** - Everything is bundled in the executable

## For Full Documentation

See the main project README at the root of the `behavioral_evaluation_using_ists` folder.
