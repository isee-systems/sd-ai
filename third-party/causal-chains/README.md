# Causal Chains Engine

This directory contains the Go implementation of the causal-chains engine for sd-ai.

## Structure

- `main.go` - Entry point for the causal-chains binary
- `causal/` - Core causal chain generation logic
- `llm/` - LLM provider abstraction
- `sdjson/` - System Dynamics JSON format definitions
- `install.sh` - Build script that compiles the binary

## Building

To build the causal-chains engine:

```bash
./install.sh
```

This will compile the Go code and place the `causal-chains` binary in `engines/causal-chains/`.

The build process is also automatically triggered by `npm install` via the postinstall hook.

## Requirements

- Go 1.24.0 or later
- Dependencies are managed via `go.mod`
