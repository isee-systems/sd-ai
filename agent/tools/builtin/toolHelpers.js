/**
 * Helper utilities shared across built-in tools
 */
import { tool as sdkTool } from '@anthropic-ai/claude-agent-sdk';
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
  const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return {
    content: [{ type: 'text', text }],
    isError: false
  };
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
