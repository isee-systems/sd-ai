import { z } from 'zod';
import { SDModelSchema, createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { callSeldonILEEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId } from './toolHelpers.js';

/**
 * Have a user-friendly discussion about the model without jargon, with ability to compare runs
 */
export function createDiscussModelAcrossRunsTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Have a user-friendly discussion about the model without jargon, with the ability to compare and explain differences between simulation runs. Use this to understand what causes behavioral differences across runs - analyzing how different scenarios or parameter changes produce different outcomes by examining the underlying feedback loop dynamics.',
    inputSchema: z.object({
      prompt: z.string().describe('Question or topic for discussion'),
      model: SDModelSchema.describe('The model to discuss'),
      runName: z.string().optional().describe('Simulation run ID for context'),
      feedbackContent: z.object({}).passthrough().optional().describe('Feedback loop analysis data'),
      parameters: z.object({
        model: z.string().optional(),
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        behaviorContent: z.string().optional().describe('Time series behavior data')
      }).optional()
    }),
    handler: async ({ prompt, model, runName, feedbackContent, parameters }) => {
      try {
        // Add feedbackContent to parameters if provided
        const engineParams = {
          ...parameters,
          ...(feedbackContent && { feedbackContent })
        };

        const result = await callSeldonILEEngine(prompt, model, runName, engineParams);

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Error: ${result.error}` }],
            isError: true
          };
        }

        // Check if feedback information is required but not provided
        if (result.output.feedbackInformationRequired && !feedbackContent) {
          // Get comparative feedback information from client (all runs)
          const session = sessionManager.getSession(sessionId);
          if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
          }

          const requestId = generateRequestId('feedback');

          // Send request to client for comparative feedback data (empty array means all runs)
          await sendToClient(createFeedbackRequestMessage(sessionId, requestId, []));

          // Create pending request that will be resolved when client responds
          const resultPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('Feedback request timeout: Client did not respond within 30 seconds'));
            }, 30000);

            if (!session.pendingFeedbackRequests) {
              session.pendingFeedbackRequests = new Map();
            }
            session.pendingFeedbackRequests.set(requestId, { resolve, reject, timeout });
          });

          const feedbackData = await resultPromise;

          // Retry the call with comparative feedback information
          const retryParams = {
            ...parameters,
            feedbackContent: feedbackData.feedbackContent
          };

          const retryResult = await callSeldonILEEngine(prompt, model, runName, retryParams);

          if (!retryResult.success) {
            return {
              content: [{ type: 'text', text: `Error: ${retryResult.error}` }],
              isError: true
            };
          }

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(retryResult.output, null, 2)
            }]
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result.output, null, 2)
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
