# Causal Decoder Engine

This directory contains the Python implementation of the causal-decoder engine for sd-ai.

## Overview

Causal Decoder is a transformer decoder-only model fine-tuned on Qwen2.5-1.5B, an open-source small LLM with 1.5 billion parameters. The model was fine-tuned using PyTorch to extract causal relationships from text.

**Note**: This is not a chat model, so it only works properly when the input is of the form "more x leads to more y", etc. This model is in the process of development.

## Structure

- `inference.py` - Python script that runs inference using the fine-tuned model
- `requirements.txt` - Python dependencies (transformers, torch, accelerate)
- `install.sh` - Installation script for Python dependencies

## Installation

To install the required Python dependencies:

```bash
./install.sh
```

The installation process is also automatically triggered by `npm install` via the postinstall hook.

## Requirements

- Python 3.x
- Dependencies:
  - `transformers==4.57.1`
  - `torch==2.9.0`
  - `accelerate==1.11.0`

## Model

The engine uses the `dorito96/qwen2.5-1.5b_causal` model from Hugging Face, which will be automatically downloaded on first use.

## Usage

The `inference.py` script is called by the engine.js wrapper and expects a text prompt describing causal relationships. It outputs JSON with extracted relationships in the format:

```json
{
  "success": true,
  "model": {
    "relationships": [
      {"from": "variable1", "to": "variable2", "polarity": "+"}
    ]
  }
}
```
