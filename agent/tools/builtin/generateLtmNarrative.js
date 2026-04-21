import { z } from 'zod';
import { SDModelSchema } from '../../utilities/MessageProtocol.js';
import { callLTMEngine } from '../../utilities/EngineWrapper.js';

/**
 * Generate a narrative explanation of feedback loops and their influence on model behavior
 */
export function createGenerateLtmNarrativeTool() {
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
          return {
            content: [{ type: 'text', text: `Error: ${result.error}` }],
            isError: true
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              feedbackLoops: result.feedbackLoops,
              output: result.output
            }, null, 2)
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
