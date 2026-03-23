#!/bin/bash

# Install script for causal-chains engine
# This script builds the causal-chains Go binary in the third-party directory

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building causal-chains engine..."

# Check if go is installed
if ! command -v go &> /dev/null; then
    echo "Error: Go toolchain not found. Please install Go to build causal-chains engine."
    exit 1
fi

# Build the binary in the third-party directory
cd "$SCRIPT_DIR"
echo "Running: go build -o \"$SCRIPT_DIR/causal-chains\" main.go"
go build -o "$SCRIPT_DIR/causal-chains" main.go

echo "Successfully built causal-chains binary at $SCRIPT_DIR/causal-chains"
