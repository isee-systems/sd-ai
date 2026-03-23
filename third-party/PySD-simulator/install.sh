#!/bin/bash

# Install script for PySD simulator
# This script installs Python dependencies required for the PySD simulator

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing PySD simulator dependencies..."

# Determine which Python command to use
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3 to use the PySD simulator."
    exit 1
fi

echo "Using Python: $PYTHON_CMD"

# Install dependencies
cd "$SCRIPT_DIR"
$PYTHON_CMD -m pip install -r requirements.txt

echo "Successfully installed PySD simulator dependencies"
