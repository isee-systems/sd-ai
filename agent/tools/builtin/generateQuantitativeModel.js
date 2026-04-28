import { z } from 'zod';
import { SDModelSchema, createUpdateModelMessage } from '../../utilities/MessageProtocol.js';
import { callQuantitativeEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';
import config from '../../../config.js';

/**
 * Generate a Stock Flow Diagram (SFD) model with equations and quantitative structure
 */
export function createGenerateQuantitativeModelTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Generate a Stock Flow Diagram (SFD) model with equations and quantitative structure. Use this for building computational models that can be simulated. Automatically pushes the generated model to the client.',
    supportedModes: ['sfd'],
    maxModelTokens: config.agentMaxTokensForEngines,
    inputSchema: z.object({
      prompt: z.string().describe('Description of the model to generate'),
      currentModel: SDModelSchema.optional().describe('Existing model to build upon'),
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        supportsArrays: z.boolean().optional().describe('Whether client supports arrayed models'),
        supportsModules: z.boolean().optional().describe('Whether client supports modules')
      }).optional()
    }),
    handler: async ({ prompt, currentModel, parameters }) => {
      try {
        const result = await callQuantitativeEngine(prompt, currentModel, parameters);

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

        const { modelPath, message } = sessionManager.writeModelToDisk(sessionId, result.model);

        return createSuccessResponse({
          message: `Model generated and pushed to client. ${message}`,
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
