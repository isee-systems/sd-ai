import { z } from 'zod';
import { createUpdateModelMessage } from '../../utilities/MessageProtocol.js';
import { callDocumentationEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';
import config from '../../../config.js';

/**
 * Auto-generate documentation for model variables
 */
export function createGenerateDocumentationTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Auto-generate documentation for model variables including descriptions and polarity.',
    supportedModes: ['sfd', 'cld'],
    maxModelTokens: config.agentMaxTokensForEngines,
    inputSchema: z.object({
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM')
      }).optional()
    }),
    handler: async ({ parameters }) => {
      try {
        const model = sessionManager.getClientModel(sessionId);
        if (!model) {
          return createErrorResponse('No model available in session');
        }

        const result = await callDocumentationEngine(model, parameters);

        if (!result.success) {
          return createErrorResponse(result.error);
        }

        // Automatically push the generated model to the client
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('model');
        await sendToClient(createUpdateModelMessage(sessionId, requestId, result.model));

        // Wait for client confirmation
        const updatePromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
          }, 30000);

          if (!session.pendingModelRequests) {
            session.pendingModelRequests = new Map();
          }
          session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
        });

        await updatePromise;

        const { modelPath, message } = sessionManager.updateClientModel(sessionId, result.model);

        return createSuccessResponse({
          message: `Documentation generated and pushed to client. ${message}`,
          modelPath,
          supportingInfo: result.supportingInfo,
          pushedToClient: true
        });
      } catch (error) {
        return createErrorResponse(error.message);
      }
    }
  };
}
