import { z } from 'zod';
import { createUpdateModelMessage, UpdateModelResponseSchema } from '../../utilities/MessageProtocol.js';
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
      difficulty: z.enum(["normal", "hard"]).describe("The expected difficulty of this task"),
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
      }).optional()
    }),
    handler: async ({ prompt, difficulty, parameters }) => {
      try {
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const underlyingModel = difficulty === 'normal' ? config.buildDefaultModel : config.agentToolHighEffortBuildDefaultModel;
        const currentModel = sessionManager.getClientModel(sessionId);

        const sessionCapabilities = {
          supportsArrays: session.supportsArrays,
          supportsModules: session.supportsModules,
          supportsSubTypes: session.supportsSubTypes
        };
        const mergedParameters = { ...sessionCapabilities, ...parameters, underlyingModel, clientId: session.clientId };

        const result = await callQuantitativeEngine(prompt, currentModel, mergedParameters);

        if (!result.success) {
          return createErrorResponse(result.error);
        }

        // Automatically push the generated model to the client
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

        const clientResult = await updatePromise;
        const parsed = UpdateModelResponseSchema.parse(clientResult);

        const { modelPath, message, issues } = sessionManager.updateClientModel(sessionId, parsed);

        return createSuccessResponse({
          message: `Model generated and pushed to client. ${message}`,
          modelPath,
          supportingInfo: result.supportingInfo,
          pushedToClient: true,
          ...(issues && { issues })
        });
      } catch (error) {
        return createErrorResponse(error.message);
      }
    }
  };
}
