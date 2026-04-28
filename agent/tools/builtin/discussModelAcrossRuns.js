import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createFeedbackRequestMessage } from '../../utilities/MessageProtocol.js';
import { callSeldonILEEngine } from '../../utilities/EngineWrapper.js';
import { generateRequestId, createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Have a user-friendly discussion about the model without jargon, with ability to compare runs
 */
export function createDiscussModelAcrossRunsTool(sessionManager, sessionId, sendToClient) {
  return {
    description: 'Have a user-friendly discussion about the model without jargon, with the ability to compare and explain differences between simulation runs. Use this to understand what causes behavioral differences across runs - analyzing how different scenarios or parameter changes produce different outcomes by examining the underlying feedback loop dynamics.',
    supportedModes: ['sfd'],
    inputSchema: z.object({
      prompt: z.string().describe('Question or topic for discussion'),
      runName: z.string().optional().describe('Simulation run identifier of the most recent run matching the way the behavioral content is being passed to this too.'),
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        behaviorContent: z.string().optional().describe('Time series behavior data')
      }).optional()
    }),
    handler: async ({ prompt, runName, parameters }) => {
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

        // Add feedbackContent to parameters if available
        const engineParams = {
          ...parameters,
          ...(feedbackContent && { feedbackContent })
        };

        const result = await callSeldonILEEngine(prompt, model, runName, engineParams);

        if (!result.success) {
          return createErrorResponse(result.error);
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