import { z } from 'zod';
import { SDModelSchema, createUpdateModelMessage } from '../../utilities/MessageProtocol.js';
import { callDocumentationEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId } from './toolHelpers.js';

/**
 * Auto-generate documentation for model variables
 */
export function createGenerateDocumentationTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Auto-generate documentation for model variables including descriptions and polarity.',
    inputSchema: z.object({
      model: SDModelSchema.describe('The model to document'),
      parameters: z.object({
        model: z.string().optional()
      }).optional()
    }),
    handler: async ({ model, parameters }) => {
      try {
        const result = await callDocumentationEngine(model, parameters);

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Error: ${result.error}` }],
            isError: true
          };
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

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              model: result.model,
              supportingInfo: result.supportingInfo
            }, null, 2)
          }]
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    }
  };
}
