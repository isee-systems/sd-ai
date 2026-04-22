import { z } from 'zod';
import {
  createGetCurrentModelMessage,
  createUpdateModelMessage,
  createRunModelMessage,
  createGetRunInfoMessage,
  createGetVariableDataMessage
} from '../../utilities/MessageProtocol.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Get the current model from the client
 */
export function createGetCurrentModelTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Get the current model from the client. Returns the model data that is currently loaded in the client.',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('model');

        // Send request to client for current model
        await sendToClient(createGetCurrentModelMessage(sessionId, requestId));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Get current model timeout: Client did not respond within 30 seconds'));
          }, 30000);

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
        });

        const modelData = await resultPromise;

        return createSuccessResponse(modelData);
      } catch (error) {
        return createErrorResponse(`Failed to get current model: ${error.message}`, error);
      }
    }
  };
}

/**
 * Update the model in the client
 */
export function createUpdateModelTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Update the model in the client with new model data. This replaces the current model.',
    inputSchema: z.object({
      modelData: z.any().describe('The model data to update in the client')
    }),
    handler: async ({ modelData }) => {
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('model');

        // Send update request to client
        await sendToClient(createUpdateModelMessage(sessionId, requestId, modelData));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
          }, 30000);

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
        });

        const result = await resultPromise;

        return createSuccessResponse({ success: true, ...result });
      } catch (error) {
        return createErrorResponse(`Failed to update model: ${error.message}`, error);
      }
    }
  };
}

/**
 * Run the model simulation in the client
 */
export function createRunModelTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Run the model simulation in the client. Returns a runId for the completed run.',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('run');

        // Send run request to client
        await sendToClient(createRunModelMessage(sessionId, requestId));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Run model timeout: Client did not respond within 60 seconds'));
          }, 60000); // Longer timeout for model runs

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
        });

        const result = await resultPromise;

        return createSuccessResponse({
          runId: result.runId,
          success: true,
          ...result
        });
      } catch (error) {
        return createErrorResponse(`Failed to run model: ${error.message}`, error);
      }
    }
  };
}

/**
 * Get information about all simulation runs
 */
export function createGetRunInfoTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Get information about all simulation runs. Returns a list of run objects, where each run object contains an id, name, and optional metadata.',
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('runinfo');

        // Send request to client for run info
        await sendToClient(createGetRunInfoMessage(sessionId, requestId));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Get run info timeout: Client did not respond within 30 seconds'));
          }, 30000);

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
        });

        const runInfo = await resultPromise;

        return createSuccessResponse({
          runs: runInfo.runs || [],
          count: runInfo.runs?.length || 0
        });
      } catch (error) {
        return createErrorResponse(`Failed to get run info: ${error.message}`, error);
      }
    }
  };
}

/**
 * Get data for specific variables from specific runs
 */
export function createGetVariableDataTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Get data for specific variables from specific runs. Returns the time-series data for the requested variables from the requested runs. NOTE: This operation can be slow for large datasets - consider requesting only essential variables and runs. For visualization or analysis, consider requesting a small subset of key variables first.',
    inputSchema: z.object({
      variableNames: z.array(z.string()).describe('List of variable names to get data for'),
      runIds: z.array(z.string()).describe('List of run IDs to get variable data from')
    }),
    handler: async ({ variableNames, runIds }) => {
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('vardata');

        // Send request to client for variable data
        await sendToClient(createGetVariableDataMessage(sessionId, requestId, variableNames, runIds));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Get variable data timeout: Client did not respond within 30 seconds'));
          }, 30000);

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
        });

        const variableData = await resultPromise;

        return createSuccessResponse(variableData);
      } catch (error) {
        return createErrorResponse(`Failed to get variable data: ${error.message}`, error);
      }
    }
  };
}
