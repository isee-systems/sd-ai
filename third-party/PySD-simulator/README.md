# PySD Simulator Wrapper

This directory contains a Python wrapper for the PySD library, which is used to load and simulate System Dynamics models in XMILE format.

## Installation

Run the installation script to install the required dependencies:

```bash
./install.sh
```

This will install PySD and its dependencies using pip.

## Usage

The `simulator.py` module provides a `PySDSimulator` class that wraps the PySD library with a simplified interface.

### Python API

```python
from simulator import PySDSimulator

# Load a model from XMILE content string
xmile_content = """
<xmile version="1.0">
  <!-- your XMILE model here -->
</xmile>
"""

simulator = PySDSimulator(xmile_content)

# Get available variables
variables = simulator.get_available_variables()

# Run simulation (uses time specs from model)
results = simulator.simulate(['population', 'births', 'deaths'])

# results is a dictionary with 'time' and each variable as keys
print(results['time'])
print(results['population'])
```

### CLI Interface

The simulator can also be used via command line by passing JSON input with XMILE content:

```bash
echo '{
  "model_content": "<xmile>...</xmile>",
  "variables": ["population", "births"]
}' | python3 simulator.py
```

To get available variables:

```bash
echo '{
  "model_content": "<xmile>...</xmile>",
  "action": "get_variables"
}' | python3 simulator.py
```

## Dependencies

- pysd (v3.14.0)

## About PySD

PySD is a Python library for simulating System Dynamics models. It can read models in XMILE format and other formats, and provides a programmatic interface for running simulations and analyzing results.
