import { z } from 'zod';
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Request feedback loop analysis data from the client
 */
export function createGetFeedbackInformationTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Request feedback loop analysis data from the client and cache it for use by other tools. MUST be called before using discuss_model_with_seldon or generate_ltm_narrative. Provide a list of run IDs to get feedback for.',
    supportedModes: ['sfd', 'cld'],
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

        const { filePath } = sessionManager.writeDataToDisk(sessionId, 'feedback.json', {
          feedbackContent: feedbackData.feedbackContent,
          runIds: feedbackData.runIds
        });

        return createSuccessResponse({
          message: 'Feedback information cached. Other tools will load it automatically — you do not need to read this file.',
          filePath,
          runIds: feedbackData.runIds
        });
      } catch (error) {
        return createErrorResponse(`Failed to get feedback information: ${error.message}`, error);
      }
    }
  };
}
