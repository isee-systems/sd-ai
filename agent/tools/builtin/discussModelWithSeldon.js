import { z } from 'zod';
import { SDModelSchema, FeedbackContentSchema, createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { callSeldonEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Have an expert-level discussion about the model using System Dynamics terminology
 */
export function createDiscussModelWithSeldonTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Have an expert-level discussion about the model using System Dynamics terminology. Use this for technical analysis and SD theory discussions.',
    supportedModes: ['sfd', 'cld'],
    inputSchema: z.object({
      prompt: z.string().describe('Question or topic for discussion'),
      model: SDModelSchema.describe('The model to discuss'),
      feedbackContent: FeedbackContentSchema.optional(),
      parameters: z.object({
        model: z.string().optional(),
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        behaviorContent: z.string().optional().describe('Time series behavior data')
      }).optional()
    }),
    handler: async ({ prompt, model, feedbackContent, parameters }) => {
      try {
        const result = await callSeldonEngine(prompt, model, feedbackContent, parameters);

        if (!result.success) {
          return createErrorResponse(result.error);
        }

        // Check if feedback information is required but not provided
        if (result.output.feedbackInformationRequired && !feedbackContent) {
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
          const retryResult = await callSeldonEngine(prompt, model, feedbackData.feedbackContent, parameters);

          if (!retryResult.success) {
            return createErrorResponse(retryResult.error);
          }

          return createSuccessResponse(retryResult.output);
        }

        return createSuccessResponse(result.output);
      } catch (error) {
        return createErrorResponse(error.message);
      }
    }
  };
}
