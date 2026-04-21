import { z } from 'zod';
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { generateRequestId } from './toolHelpers.js';
import logger from '../../../utilities/logger.js';

/**
 * Request feedback loop analysis data from the client
 */
export function createGetFeedbackInformationTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Request feedback loop analysis data from the client. MUST be called before using discuss_model_with_seldon or generate_ltm_narrative to ensure feedback information is available. Provide a list of run IDs to get feedback for.',
    inputSchema: z.object({
      runIds: z.array(z.string()).describe('List of simulation run IDs to get feedback for')
    }),
    handler: async ({ runIds }) => {
      try {
        // Create a promise that will be resolved when client responds
        const session = sessionManager.getSession(sessionId);
        if (!session) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        const requestId = generateRequestId('feedback');

        // Send request to client for feedback data
        await sendToClient(createFeedbackRequestMessage(sessionId, requestId, runIds));

        // Create pending request that will be resolved when client responds
        const resultPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Feedback request timeout: Client did not respond within 30 seconds'));
          }, 30000);

          // Store the resolver in session so it can be called when client responds
          if (!session.pendingFeedbackRequests) {
            session.pendingFeedbackRequests = new Map();
          }
          session.pendingFeedbackRequests.set(requestId, { resolve, reject, timeout });
        });

        const feedbackData = await resultPromise;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              feedbackContent: feedbackData.feedbackContent,
              runIds: feedbackData.runIds
            }, null, 2)
          }]
        };
      } catch (error) {
        logger.error('get_feedback_information error:', error);
        return {
          content: [{ type: 'text', text: `Failed to get feedback information: ${error.message}` }],
          isError: true
        };
      }
    }
  };
}
