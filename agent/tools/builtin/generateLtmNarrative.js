import { z } from 'zod';
import { SDModelSchema, FeedbackContentSchema } from '../../utilities/MessageProtocol.js';
import { callLTMEngine } from '../../utilities/EngineWrapper.js';
import { createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Generate a narrative explanation of feedback loops and their influence on model behavior
 */
export function createGenerateLtmNarrativeTool(sessionManager, sessionId) {
  return {
    description: 'Generate a narrative explanation of feedback loops and their influence on model behavior (Loops That Matter analysis).',
    supportedModes: ['sfd'],
    inputSchema: z.object({
      model: SDModelSchema.describe('The model to analyze'),
      feedbackContent: FeedbackContentSchema,
      parameters: z.object({
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
        behaviorContent: z.string().optional().describe('Time series behavior data')
      }).optional()
    }),
    handler: async ({ model, feedbackContent, parameters }) => {
      try {
        const result = await callLTMEngine(model, feedbackContent, parameters);

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
