#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v docker &> /dev/null; then
    echo "docker not found on PATH; cannot build simlin-agent image."
    echo "Install Docker (or Podman aliased as docker) to enable the simlin-agent engine."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "docker is installed but the daemon is not reachable; cannot build simlin-agent image."
    echo "Start the Docker/Podman daemon to enable the simlin-agent engine."
    exit 1
fi

docker build -t sd-ai-simlin-agent "$SCRIPT_DIR"
