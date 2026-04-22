import { z } from 'zod';
import { SDModelSchema } from '../../utilities/MessageProtocol.js';
import { callSeldonMentorEngine } from '../../utilities/EngineWrapper.js';
import { createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * Ask thoughtful questions to the user to guide their learning
 */
export function createDiscussWithMentorTool(sessionManager, sessionId) {
  return {
    description: 'Ask thoughtful questions to the user to guide their learning and help them think through System Dynamics concepts. Use this to engage users in Socratic dialogue about their model.',
    inputSchema: z.object({
      prompt: z.string().describe('The question or guidance to provide to the user'),
      model: SDModelSchema.describe('The model being discussed'),
      parameters: z.object({
        model: z.string().optional(),
        problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
        backgroundKnowledge: z.string().optional().describe('Background information for LLM')
      }).optional()
    }),
    handler: async ({ prompt, model, parameters }) => {
      try {
        const result = await callSeldonMentorEngine(prompt, model, parameters);

        if (!result.success) {
          return createErrorResponse(result.error);
        }

        return createSuccessResponse(result.output);
      } catch (error) {
        return createErrorResponse(error.message);
      }
    }
  };
}
