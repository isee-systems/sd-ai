"""
PySD Simulator Wrapper

This module provides a wrapper around the PySD library for loading and simulating
XMILE models. It handles model loading, simulation execution, and data extraction
for specified variables over time.
"""

import sys
import json
import pysd
import tempfile
import os
from typing import List, Dict


class PySDSimulator:
    """
    Wrapper class for PySD library that provides simplified interface for
    loading XMILE models, running simulations, and extracting time series data.
    """

    def __init__(self, model_content: str):
        """
        Initialize the simulator with an XMILE model.

        Args:
            model_content: XMILE model content as a string

        Raises:
            Exception: If the model fails to load
        """
        self.model_content = model_content
        self.model = None
        self.temp_file = None
        self._load_model()

    def _load_model(self):
        """Load the XMILE model using PySD."""
        try:
            # Create a temporary file for the XMILE content
            self.temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.xmile', delete=False)
            self.temp_file.write(self.model_content)
            self.temp_file.close()

            # Load the model from the temporary file
            self.model = pysd.read_xmile(self.temp_file.name)
        except Exception as e:
            if self.temp_file:
                try:
                    os.unlink(self.temp_file.name)
                except:
                    pass
            raise Exception(f"Failed to load XMILE model: {str(e)}")

    def __del__(self):
        """Clean up temporary file when object is destroyed."""
        if self.temp_file:
            try:
                os.unlink(self.temp_file.name)
            except:
                pass

    def simulate(self, variables: List[str]) -> Dict[str, List[float]]:
        """
        Simulate the model and return time series data for specified variables.
        Uses the time specs (initial time, final time, time step) defined in the model.

        Args:
            variables: List of variable names to track during simulation

        Returns:
            Dictionary mapping variable names to lists of values over time.
            Includes 'time' key with the time steps.

        Raises:
            Exception: If simulation fails
        """
        if self.model is None:
            raise Exception("Model not loaded. Cannot simulate.")

        try:
            # Determine which columns to return
            # PySD expects return_columns to be a list of variable names
            return_columns = variables.copy()

            # Run simulation with model's default time specs
            results = self.model.run(return_columns=return_columns)

            # Convert results to dictionary format
            output = {}

            # Add time as a variable
            output['time'] = results.index.tolist()

            # Add each requested variable
            for var in variables:
                if var in results.columns:
                    output[var] = results[var].tolist()
                else:
                    # Try to find the variable with different naming conventions
                    found = False
                    for col in results.columns:
                        if col.lower() == var.lower() or col.replace('_', ' ').lower() == var.lower():
                            output[var] = results[col].tolist()
                            found = True
                            break
                    if not found:
                        raise Exception(f"Variable '{var}' not found in simulation results. Available variables: {list(results.columns)}")

            return output

        except Exception as e:
            raise Exception(f"Simulation failed: {str(e)}")

    def get_available_variables(self) -> List[str]:
        """
        Get list of all available variables in the model.

        Returns:
            List of variable names that can be used in simulation
        """
        if self.model is None:
            raise Exception("Model not loaded.")

        try:
            # PySD models have a doc DataFrame with 'Real Name' column
            return list(self.model.doc['Real Name'])
        except Exception as e:
            # Fallback: run a quick simulation and get column names
            try:
                results = self.model.run()
                return list(results.columns)
            except:
                raise Exception(f"Failed to get available variables: {str(e)}")

    def reset(self):
        """Reset the model to initial conditions."""
        if self.model is not None:
            self._load_model()


def main():
    """
    CLI interface for the PySD simulator.
    Expects JSON input via stdin with the following structure:
    {
        "model_content": "<xmile>...</xmile>",
        "variables": ["var1", "var2"]
    }
    """
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())

        # Extract parameters
        model_content = input_data.get('model_content')
        variables = input_data.get('variables', [])

        if not model_content:
            raise ValueError("model_content is required")

        if input_data.get('action') == 'get_variables':
            # Just get available variables
            simulator = PySDSimulator(model_content)
            variables = simulator.get_available_variables()
            print(json.dumps({"success": True, "variables": variables}))
        else:
            # Run simulation
            if not variables:
                raise ValueError("variables list is required for simulation")

            simulator = PySDSimulator(model_content)
            results = simulator.simulate(variables=variables)

            print(json.dumps({"success": True, "results": results}))

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
