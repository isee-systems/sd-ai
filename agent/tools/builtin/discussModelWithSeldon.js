import { z } from 'zod';
import { SDModelSchema, createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { callSeldonEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId } from './toolHelpers.js';

/**
 * Have an expert-level discussion about the model using System Dynamics terminology
 */
export function createDiscussModelWithSeldonTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Have an expert-level discussion about the model using System Dynamics terminology. Use this for technical analysis and SD theory discussions.',
    inputSchema: z.object({
      prompt: z.string().describe('Question or topic for discussion'),
      model: SDModelSchema.describe('The model to discuss'),
      feedbackLoops: z.array(z.any()).optional().describe('Feedback loop analysis data'),
      parameters: z.object({
        model: z.string().optional(),
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        behaviorContent: z.string().optional().describe('Time series behavior data')
      }).optional()
    }),
    handler: async ({ prompt, model, feedbackLoops, parameters }) => {
      try {
        const result = await callSeldonEngine(prompt, model, feedbackLoops, parameters);

        if (!result.success) {
          return {
            content: [{ type: 'text', text: `Error: ${result.error}` }],
            isError: true
          };
        }

        // Check if feedback information is required but not provided
        if (result.output.feedbackInformationRequired && !feedbackLoops) {
          // Get feedback information from client
          const session = sessionManager.getSession(sessionId);
          if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
          }

          const requestId = generateRequestId('feedback');

          // Send request to client for feedback data (empty array means all runs)
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

          // Retry the call with feedback information
          const retryResult = await callSeldonEngine(prompt, model, feedbackData.feedbackContent.loops, parameters);

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
