#!/bin/bash

# Master installation script for all third-party components
# This script iterates through all subdirectories and runs their install.sh scripts
#
# Set SKIP_THIRD_PARTY_COMPONENTS to a comma-separated list of component names to skip.
# Example: SKIP_THIRD_PARTY_COMPONENTS=causal-decoder,PySD-simulator,time-series-behavior-analysis npm install

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing third-party components..."
echo ""

# Track overall success
FAILED_COMPONENTS=()

should_skip() {
    local name="$1"
    IFS=',' read -ra SKIP_LIST <<< "${SKIP_THIRD_PARTY_COMPONENTS:-}"
    for skip in "${SKIP_LIST[@]}"; do
        if [ "$skip" = "$name" ]; then
            return 0
        fi
    done
    return 1
}

# Iterate through all subdirectories that have an install.sh script
for component_dir in "$SCRIPT_DIR"/*/; do
    # Remove trailing slash and get component name
    component_name=$(basename "$component_dir")
    install_script="$component_dir/install.sh"

    if [ -f "$install_script" ] && [ -x "$install_script" ]; then
        if should_skip "$component_name"; then
            echo "================================================"
            echo "Skipping: $component_name"
            echo "================================================"
            echo ""
            continue
        fi

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
