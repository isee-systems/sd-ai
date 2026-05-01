import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { callLTMEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId, createSuccessResponse, createErrorResponse, loadBehaviorContent } from './toolHelpers.js';

/**
 * Generate a narrative explanation of feedback loops and their influence on model behavior
 */
export function createGenerateLtmNarrativeTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Generate a narrative explanation of feedback loops and their influence on model behavior (Loops That Matter analysis).',
    supportedModes: ['sfd'],
    inputSchema: z.object({
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        runIds: z.array(z.string()).optional().describe('Run IDs to include as behavior data; defaults to the last run')
      }).optional()
    }),
    handler: async ({ parameters }) => {
      try {
        const model = sessionManager.getClientModel(sessionId);
        if (!model) {
          return createErrorResponse('No model available in session');
        }

        const sessionTempDir = sessionManager.getSessionTempDir(sessionId);
        const feedbackPath = join(sessionTempDir, 'feedback.json');
        let feedbackContent = existsSync(feedbackPath)
          ? JSON.parse(readFileSync(feedbackPath, 'utf-8')).feedbackContent
          : undefined;

        const behaviorContent = loadBehaviorContent(sessionTempDir, parameters?.runIds);
        const enrichedParameters = behaviorContent ? { ...parameters, behaviorContent } : parameters;

        if (!feedbackContent) {
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

          feedbackContent = feedbackData.feedbackContent;
        }

        const result = await callLTMEngine(model, feedbackContent, enrichedParameters);

        if (!result.success) {
          return createErrorResponse(result.error);
        }

        return createSuccessResponse({
          feedbackLoops: result.feedbackLoops,
          output: result.output
        });
      } catch (error) {
        return createErrorResponse(error.message);
      }
    }
  };
}
