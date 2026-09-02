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

// Ceiling on what we buffer from a single Python run. Real simulation output is a few MB at
// most; anything beyond this is a runaway model, and letting it accumulate crashes the caller
// long before the data could be useful.
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 4 * 1024 * 1024;

// Error messages embed the process output, so cap what goes into them.
const MAX_ERROR_OUTPUT_CHARS = 8 * 1024;

function truncateForError(output) {
    if (output.length <= MAX_ERROR_OUTPUT_CHARS) {
        return output;
    }
    return `${output.slice(0, MAX_ERROR_OUTPUT_CHARS)}... [truncated, ${output.length} chars total]`;
}

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

            // Buffer the raw chunks rather than concatenating them into a string as they
            // arrive: a runaway model blew past V8's maximum string length and crashed the
            // whole eval run with "RangeError: Invalid string length". Holding Buffers also
            // keeps multi-byte UTF-8 characters intact across chunk boundaries.
            const stdoutChunks = [];
            const stderrChunks = [];
            let stdoutBytes = 0;
            let stderrBytes = 0;
            let settled = false;

            const settle = (error, value) => {
                if (settled) {
                    return;
                }
                settled = true;
                // Release whatever we buffered; on the overflow path this can be hundreds of MB.
                stdoutChunks.length = 0;
                stderrChunks.length = 0;
                if (error) {
                    reject(error);
                } else {
                    resolve(value);
                }
            };

            pythonProcess.stdout.on('data', (data) => {
                if (settled) {
                    return;
                }

                stdoutBytes += data.length;
                if (stdoutBytes > MAX_STDOUT_BYTES) {
                    pythonProcess.kill('SIGKILL');
                    settle(new Error(
                        `Python process produced more than ${MAX_STDOUT_BYTES} bytes of output before it finished. ` +
                        `This usually means the model has a runaway simulation spec (a tiny dt or an enormous stop time).`
                    ));
                    return;
                }

                stdoutChunks.push(data);
            });

            pythonProcess.stderr.on('data', (data) => {
                if (settled || stderrBytes > MAX_STDERR_BYTES) {
                    return;
                }
                // stderr is only ever used for diagnostics, so drop the overflow and let the
                // process run instead of killing it over chatty warnings.
                stderrBytes += data.length;
                stderrChunks.push(data);
            });

            pythonProcess.on('close', (code) => {
                if (settled) {
                    return;
                }

                const stdout = Buffer.concat(stdoutChunks).toString('utf8');
                const stderr = Buffer.concat(stderrChunks).toString('utf8');

                if (code !== 0) {
                    settle(new Error(`Python process exited with code ${code}\nStderr: ${truncateForError(stderr)}\nStdout: ${truncateForError(stdout)}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);

                    if (!result.success) {
                        settle(new Error(result.error || 'Unknown error from Python script'));
                        return;
                    }

                    settle(null, result);
                } catch (e) {
                    settle(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${truncateForError(stdout)}`));
                }
            });

            pythonProcess.on('error', (err) => {
                settle(new Error(`Failed to start Python process: ${err.message}`));
            });

            // Killing the process on overflow (or a Python crash) can tear the pipe down while
            // we are still writing the model, which surfaces here as EPIPE. That is expected,
            // and the real failure is already reported through the handlers above.
            pythonProcess.stdin.on('error', () => {});

            // Send input to Python script via stdin
            pythonProcess.stdin.write(JSON.stringify(input));
            pythonProcess.stdin.end();
        });
    }
}

export default PySDSimulator;
