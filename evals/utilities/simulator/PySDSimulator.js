/**
 * PySDSimulator - A JavaScript wrapper for the PySD simulator
 *
 * This class provides a convenient interface for loading XMILE models,
 * running simulations, and extracting time series data for specified variables.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class PySDSimulator {
    /**
     * Create a new PySD simulator instance
     * @param {string} xmileContent - XMILE model content as a string
     * @param {string} [pythonCommand='python3'] - Python command to use (python3, python, etc.)
     */
    constructor(xmileContent, pythonCommand = 'python3') {
        if (!xmileContent || typeof xmileContent !== 'string') {
            throw new Error('xmileContent must be a non-empty string');
        }

        this.xmileContent = xmileContent;
        this.pythonCommand = pythonCommand;

        // Path to the Python simulator script
        this.simulatorScript = path.join(__dirname, '../../../third-party/PySD-simulator/simulator.py');

        // Verify the simulator script exists
        if (!fs.existsSync(this.simulatorScript)) {
            throw new Error(`PySD simulator script not found: ${this.simulatorScript}`);
        }
    }

    /**
     * Get list of available variables in the model
     * @returns {Promise<string[]>} Array of variable names
     */
    async getAvailableVariables() {
        const input = {
            model_content: this.xmileContent,
            action: 'get_variables'
        };

        const result = await this._executePython(input);
        return result.variables;
    }

    /**
     * Simulate the model and return time series data for specified variables.
     * Uses the simulation specs (initial time, final time, time step) defined in the model.
     * @param {string[]} variables - Array of variable names to track
     * @returns {Promise<Object>} Object with 'time' array and arrays for each variable
     */
    async simulate(variables) {
        if (!variables || !Array.isArray(variables) || variables.length === 0) {
            throw new Error('variables must be a non-empty array');
        }

        const input = {
            model_content: this.xmileContent,
            variables: variables
        };

        const result = await this._executePython(input);
        return result.results;
    }

    /**
     * Execute the Python simulator with given input
     * @private
     * @param {Object} input - Input object to send to Python script
     * @returns {Promise<Object>} Parsed result from Python script
     */
    _executePython(input) {
        return new Promise((resolve, reject) => {
            const pythonProcess = spawn(this.pythonCommand, [this.simulatorScript]);

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`Python process exited with code ${code}\nStderr: ${stderr}\nStdout: ${stdout}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);

                    if (!result.success) {
                        reject(new Error(result.error || 'Unknown error from Python script'));
                        return;
                    }

                    resolve(result);
                } catch (e) {
                    reject(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${stdout}`));
                }
            });

            pythonProcess.on('error', (err) => {
                reject(new Error(`Failed to start Python process: ${err.message}`));
            });

            // Send input to Python script via stdin
            pythonProcess.stdin.write(JSON.stringify(input));
            pythonProcess.stdin.end();
        });
    }
}

export default PySDSimulator;
