/**
 * Helper utilities shared across built-in tools
 */

/**
 * Generate a unique request ID for async operations
 * @param {string} prefix - Prefix for the request ID (e.g., 'feedback', 'tool')
 * @returns {string} Unique request ID
 */
export function generateRequestId(prefix = 'request') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

/**
 * Create a standardized error response
 * @param {string} errorMessage - The error message to return
 * @param {Error} error - Optional error object for logging
 * @param {Object} logger - Logger instance
 * @returns {Object} Standardized error response
 */
export function createErrorResponse(errorMessage, error = null, logger = null) {
  if (error && logger) {
    logger.debug('Tool error:', error);
  }
  return {
    content: [{ type: 'text', text: errorMessage }],
    isError: true
  };
}
