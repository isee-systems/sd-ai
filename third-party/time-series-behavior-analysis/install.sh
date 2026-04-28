#!/bin/bash

# Install script for time-series-behavior-analysis
# This script installs Python dependencies required for the time series behavior analysis module

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing time-series-behavior-analysis dependencies..."

# Determine which Python command to use
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3 to use the time-series-behavior-analysis module."
    exit 1
fi

echo "Using Python: $PYTHON_CMD"

# Install dependencies
cd "$SCRIPT_DIR"
$PYTHON_CMD -m pip install --user -r requirements.txt

echo "Successfully installed time-series-behavior-analysis dependencies"
