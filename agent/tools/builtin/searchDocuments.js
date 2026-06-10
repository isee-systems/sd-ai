import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './toolHelpers.js';

/**
 * search_documents — universal RAG retrieval tool.
 *
 * Available on every agent route. Performs semantic search over the chunks of
 * large attached files (the "vector tier"); small files are not chunked and
 * should be read in full from their path instead (see the Attached Files
 * section of the system prompt).
 *
 * The per-worker RagStore is hung off the SessionManager instance
 * (`sessionManager.ragStore`) by the worker on initialize, so this local tool
 * reaches it without constructor plumbing through the orchestrator.
 */
export function createSearchDocumentsTool(sessionManager, sessionId) {
  return {
    description: `Search the content of large attached documents and return the most relevant excerpts. Use this to find information inside files that are too large to read in full (the Attached Files section marks these as the "vector" tier). Small files should be read directly from their path instead. Returns ranked excerpts with their source file name and location.`,
    supportedModes: ['sfd', 'cld'],
    inputSchema: z.object({
      query: z.string().describe('Natural-language description of the information you are looking for'),
      topK: z.number().int().positive().optional().describe('Maximum number of excerpts to return'),
      fileId: z.string().optional().describe('Restrict the search to a single attached file by its id')
    }),
    handler: async ({ query, topK, fileId }) => {
      try {
        const ragStore = sessionManager.ragStore;
        if (!ragStore) {
          return createErrorResponse('Document search is not available in this session.');
        }
        const results = await ragStore.search(sessionManager, sessionId, query, { topK, fileId });
        if (results.length === 0) {
          return createSuccessResponse({
            results: [],
            message: 'No matching excerpts found. There may be no large (searchable) documents attached — small documents should be read directly from their path.'
          });
        }
        return createSuccessResponse({ results });
      } catch (error) {
        return createErrorResponse(`Document search failed: ${error.message}`, error);
      }
    }
  };
}
