import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { callSeldonMentorEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId, createSuccessResponse, createErrorResponse, loadBehaviorContent } from './toolHelpers.js';

/**
 * Ask thoughtful questions to the user to guide their learning
 */
export function createDiscussWithMentorTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Ask thoughtful questions to the user to guide their learning and help them think through System Dynamics concepts. Use this to engage users in Socratic dialogue about their model.',
    supportedModes: ['sfd', 'cld'],
    inputSchema: z.object({
      prompt: z.string().describe('The question or guidance to provide to the user'),
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        runIds: z.array(z.string()).optional().describe('Run IDs to include as behavior data; defaults to the last run')
      }).optional()
    }),
    handler: async ({ prompt, parameters }) => {
      try {
        const model = sessionManager.getClientModel(sessionId);
        if (!model) {
          return createErrorResponse('No model available in session');
        }

        const sessionTempDir = sessionManager.getSessionTempDir(sessionId);
        const feedbackPath = join(sessionTempDir, 'feedback.json');
        const feedbackContent = existsSync(feedbackPath)
          ? JSON.parse(readFileSync(feedbackPath, 'utf-8')).feedbackContent
          : undefined;

        const behaviorContent = loadBehaviorContent(sessionTempDir, parameters?.runIds);
        const enrichedParameters = behaviorContent ? { ...parameters, behaviorContent } : parameters;

        const result = await callSeldonMentorEngine(prompt, model, feedbackContent, enrichedParameters);

        if (!result.success) {
          return createErrorResponse(result.error);
        }

        // Check if feedback information is required but not provided
        if (result.output.feedbackInformationRequired && !feedbackContent) {
          const session = sessionManager.getSession(sessionId);
          if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
          }

          const requestId = generateRequestId('feedback');

          await sendToClient(createFeedbackRequestMessage(sessionId, requestId, []));

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

          // Write feedback to disk instead of passing directly into context
          sessionManager.writeDataToDisk(sessionId, 'feedback.json', {
            feedbackContent: feedbackData.feedbackContent,
            runIds: feedbackData.runIds
          });

          const retryResult = await callSeldonMentorEngine(prompt, model, feedbackData.feedbackContent, enrichedParameters);

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
