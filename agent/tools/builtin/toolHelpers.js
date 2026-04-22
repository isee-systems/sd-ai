/**
 * Helper utilities shared across built-in tools
 */
import logger from '../../../utilities/logger.js';

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
