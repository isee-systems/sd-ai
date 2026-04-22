import { z } from 'zod';
import { SDModelSchema } from '../../utilities/MessageProtocol.js';
import { callLTMEngine } from '../../utilities/EngineWrapper.js';
import { createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Generate a narrative explanation of feedback loops and their influence on model behavior
 */
export function createGenerateLtmNarrativeTool(sessionManager, sessionId) {
  return {
    description: 'Generate a narrative explanation of feedback loops and their influence on model behavior (Loops That Matter analysis).',
    inputSchema: z.object({
      model: SDModelSchema.describe('The model to analyze'),
      feedbackLoops: z.array(z.any()).describe('Feedback loop analysis data'),
      parameters: z.object({
        model: z.string().optional()
      }).optional()
    }),
    handler: async ({ model, feedbackLoops, parameters }) => {
      try {
        const result = await callLTMEngine(model, feedbackLoops, parameters);

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
