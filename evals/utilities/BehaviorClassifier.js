/**
 * Behavior Classifier Utility
 *
 * This module provides a JavaScript wrapper for the time-series-behavior-analysis
 * Python tool. It allows classification of time series data into behavioral patterns
 * such as exponential growth, s-curve, oscillation, etc.
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Classifies the behavioral pattern of a time series
 * @param {Array<number>} timeSeriesData - The time series data to classify
 * @param {Object} options - Optional configuration
 * @param {string} options.pythonCommand - Python command to use (default: 'python3')
 * @param {number} options.topN - Number of top matches to return (default: 5)
 * @returns {Promise<Object>} Classification result with best_label, probabilities, etc.
 */
const classifyTimeSeries = (timeSeriesData, options = {}) => {
    return new Promise((resolve, reject) => {
        if (!timeSeriesData || !Array.isArray(timeSeriesData) || timeSeriesData.length === 0) {
            reject(new Error('timeSeriesData must be a non-empty array'));
            return;
        }

        const pythonCommand = options.pythonCommand || 'python3';
        const topN = options.topN || 5;

        // Path to the Python classifier script
        const scriptPath = path.join(__dirname, '../../third-party/time-series-behavior-analysis/classify_behavior.py');

        // Create a temporary CSV file
        const tempFile = path.join(tmpdir(), `timeseries_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.csv`);

        try {
            // Write time series data to CSV - single column with header, no time dimension
            const csvContent = 'value\n' + timeSeriesData.join('\n');
            writeFileSync(tempFile, csvContent);

            // Spawn Python process
            const pythonProcess = spawn(pythonCommand, [
                scriptPath,
                tempFile,
                '--format', 'json',
                '--top', topN.toString()
            ]);

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            pythonProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            pythonProcess.on('close', (code) => {
                // Clean up temp file
                try {
                    unlinkSync(tempFile);
                } catch (e) {
                    // Ignore cleanup errors
                }

                if (code !== 0) {
                    reject(new Error(`Python process exited with code ${code}\nStderr: ${stderr}\nStdout: ${stdout}`));
                    return;
                }

                try {
                    const result = JSON.parse(stdout);
                    resolve(result);
                } catch (e) {
                    reject(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${stdout}`));
                }
            });

            pythonProcess.on('error', (err) => {
                // Clean up temp file
                try {
                    unlinkSync(tempFile);
                } catch (e) {
                    // Ignore cleanup errors
                }
                reject(new Error(`Failed to start Python process: ${err.message}`));
            });

        } catch (error) {
            // Clean up temp file if it was created
            try {
                unlinkSync(tempFile);
            } catch (e) {
                // Ignore cleanup errors
            }
            reject(error);
        }
    });
};

/**
 * Checks if a time series matches an expected behavioral pattern
 * @param {Array<number>} timeSeriesData - The time series data to check
 * @param {string} expectedPattern - The expected pattern label (e.g., 'exponential_growth')
 * @param {Object} options - Optional configuration
 * @param {number} options.minConfidence - Minimum confidence threshold (0-1, default: 0.5)
 * @param {string} options.pythonCommand - Python command to use (default: 'python3')
 * @returns {Promise<Object>} Object with { matches: boolean, confidence: number, detected: string, details: Object }
 */
const checkPattern = async (timeSeriesData, expectedPattern, options = {}) => {
    const minConfidence = options.minConfidence || 0.5;

    try {
        const result = await classifyTimeSeries(timeSeriesData, options);

        const detectedPattern = result.best_label;
        const confidence = result.probabilities[detectedPattern] || 0;

        const matches = (detectedPattern === expectedPattern) && (confidence >= minConfidence);

        return {
            matches,
            confidence,
            detected: detectedPattern,
            expected: expectedPattern,
            details: result
        };
    } catch (error) {
        throw new Error(`Pattern check failed: ${error.message}`);
    }
};

/**
 * Gets a human-readable description of a behavioral pattern
 * @param {string} pattern - The pattern label
 * @returns {string} Description of the pattern
 */
const getPatternDescription = (pattern) => {
    const descriptions = {
        "stable": "Constant/Stasis - no significant change over time",
        "inactive": "Zero/Inactive - values near zero throughout",
        "linear_growth": "Linear Growth - steady positive increase",
        "linear_decline": "Linear Decline - steady negative decrease",
        "linear_flat": "Linear Flat - near-constant with slight linear trend",
        "accelerating_growth": "Accelerating Growth - increasing rate of growth",
        "accelerating_decline": "Accelerating Decline - increasing rate of decline",
        "inflecting_growth": "Inflecting Growth - cubic curve trending upward",
        "inflecting_decline": "Inflecting Decline - cubic curve trending downward",
        "exponential_growth": "Exponential Growth - rapid accelerating increase",
        "exponential_decline": "Exponential Decline/Decay - rapid decelerating decrease",
        "s_curve_growth": "S-Curve Growth - sigmoid/logistic growth to plateau",
        "s_curve_decline": "S-Curve Decline - sigmoid/logistic decay to floor",
        "peak": "Peak/Bump Up - rises to maximum then falls",
        "dip": "Dip/Bump Down - falls to minimum then rises",
        "step_up": "Step Up - abrupt increase to new level",
        "step_down": "Step Down - abrupt decrease to new level",
        "oscillating": "Oscillation - periodic fluctuation",
        "oscillating_trending_up": "Oscillation with Growth - periodic fluctuation with upward trend",
        "oscillating_trending_down": "Oscillation with Decay - periodic fluctuation with downward trend",
        "dampening": "Dampening Oscillation - decreasing amplitude waves",
        "dampening_trending_up": "Dampening with Growth - dampening oscillation with upward trend",
        "dampening_trending_down": "Dampening with Decay - dampening oscillation with downward trend",
        "overshoot_up": "Overshoot Up - rises past target then settles back",
        "overshoot_down": "Overshoot Down - falls past target then settles back"
    };

    return descriptions[pattern] || "Unknown pattern";
};

/**
 * BehaviorClassifier object containing all behavior classification utilities
 */
const BehaviorClassifier = {
    classifyTimeSeries,
    checkPattern,
    getPatternDescription
};

export default BehaviorClassifier;
