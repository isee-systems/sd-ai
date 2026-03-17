#!/bin/bash

# Master installation script for all third-party components
# This script iterates through all subdirectories and runs their install.sh scripts

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing third-party components..."
echo ""

# Track overall success
FAILED_COMPONENTS=()

# Iterate through all subdirectories that have an install.sh script
for component_dir in "$SCRIPT_DIR"/*/; do
    # Remove trailing slash and get component name
    component_name=$(basename "$component_dir")
    install_script="$component_dir/install.sh"

    if [ -f "$install_script" ] && [ -x "$install_script" ]; then
        echo "================================================"
        echo "Installing: $component_name"
        echo "================================================"

        if bash "$install_script"; then
            echo "✓ Successfully installed $component_name"
            echo ""
        else
            echo "✗ Failed to install $component_name"
            echo ""
            FAILED_COMPONENTS+=("$component_name")
        fi
    fi
done

echo "================================================"
echo "Installation Summary"
echo "================================================"

if [ ${#FAILED_COMPONENTS[@]} -eq 0 ]; then
    echo "✓ All third-party components installed successfully!"
    exit 0
else
    echo "✗ Failed to install the following components:"
    for component in "${FAILED_COMPONENTS[@]}"; do
        echo "  - $component"
    done
    echo ""
    echo "Note: Some components may have failed due to missing dependencies."
    echo "Check the output above for details."
    exit 0  # Don't fail npm install if third-party components fail
fi
