import { z } from 'zod';
import { SDModelSchema, createUpdateModelMessage } from '../../utilities/MessageProtocol.js';
import { callQualitativeEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId } from './toolHelpers.js';

/**
 * Generate a Causal Loop Diagram (CLD) showing feedback loops and causal relationships
 */
export function createGenerateQualitativeModelTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Generate a Causal Loop Diagram (CLD) showing feedback loops and causal relationships. Use this for conceptual models focusing on system structure. Automatically pushes the generated model to the client.',
    inputSchema: z.object({
      prompt: z.string().describe('Description of the model to generate'),
      currentModel: SDModelSchema.optional().describe('Existing model to build upon'),
      parameters: z.object({
        model: z.string().optional(),
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM')
      }).optional()
    }),
    handler: async ({ prompt, currentModel, parameters }) => {
      try {
        const result = await callQualitativeEngine(prompt, currentModel, parameters);

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

        // Build response
        const responseText = JSON.stringify({
          model: result.model,
          supportingInfo: result.supportingInfo,
          pushedToClient: true
        }, null, 2);

        return {
          content: [{
            type: 'text',
            text: responseText
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
