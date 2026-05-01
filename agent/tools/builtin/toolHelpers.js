/**
 * Helper utilities shared across built-in tools
 */
import { tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../../../utilities/logger.js';

/**
 * Wrapper for the SDK tool() function for use with Claude Agent SDK
 * Note: inputSchema should be a Zod schema
 * @param {Object} config - Tool configuration
 * @param {string} config.name - Tool name
 * @param {string} config.description - Tool description
 * @param {Object} config.inputSchema - Zod schema for input validation
 * @param {Function} config.execute - Tool execution function
 * @returns {Object} SDK tool instance
 */
export function tool({ name, description, inputSchema, execute }) {
  return sdkTool(name, description, inputSchema, execute);
}

/**
 * Generate a unique request ID for async operations
 * @param {string} prefix - Prefix for the request ID (e.g., 'feedback', 'tool')
 * @returns {string} Unique request ID
 */
export function generateRequestId(prefix = 'request') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Create a standardized success response
 * @param {string|Object} result - The result to return (string or object to be stringified)
 * @returns {Object} Standardized success response
 */
export function createSuccessResponse(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);
  return {
    content: [{ type: 'text', text }],
    isError: false
  };
}

/**
 * Load behavior content from the most recent variable_data JSON file in the session temp dir,
 * filtered to the given run IDs (or the last run ID in the file if none specified).
 * Returns undefined if no variable_data file exists.
 * @param {string} sessionTempDir - Path to the session temp directory
 * @param {string[]} [runIds] - Optional run IDs to include; defaults to the last run in the file
 * @returns {string|undefined} JSON string of filtered run data, or undefined
 */
export function loadBehaviorContent(sessionTempDir, runIds) {
  if (!existsSync(sessionTempDir)) return undefined;

  const files = readdirSync(sessionTempDir)
    .filter(f => f.startsWith('variable_data_') && f.endsWith('.json'))
    .sort();

  if (files.length === 0) return undefined;

  const latest = JSON.parse(readFileSync(join(sessionTempDir, files[files.length - 1]), 'utf-8'));
  const allRunIds = Object.keys(latest);
  if (allRunIds.length === 0) return undefined;

  const selected = (runIds && runIds.length > 0)
    ? runIds.filter(id => id in latest)
    : [allRunIds[allRunIds.length - 1]];

  if (selected.length === 1) return JSON.stringify(latest[selected[0]]);

  const filtered = Object.fromEntries(selected.map(id => [id, latest[id]]));
  return JSON.stringify(filtered);
}

/**
 * Create a standardized error response
 * @param {string} errorMessage - The error message to return
 * @param {Error} error - Optional error object for logging
 * @returns {Object} Standardized error response
 */
export function createErrorResponse(errorMessage, error = null) {
  if (error) {
    logger.debug('Tool error:', error);
  }
  return {
    content: [{ type: 'text', text: errorMessage }],
    isError: true
  };
}
