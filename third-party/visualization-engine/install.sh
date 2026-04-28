#!/bin/bash

# Install script for visualization-engine
# Installs Python dependencies required by VisualizationEngine.js (matplotlib, numpy)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing visualization-engine dependencies..."

if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3 to use the visualization engine."
    exit 1
fi

echo "Using Python: $PYTHON_CMD"

cd "$SCRIPT_DIR"
$PYTHON_CMD -m pip install --user -r requirements.txt

echo "Successfully installed visualization-engine dependencies"
