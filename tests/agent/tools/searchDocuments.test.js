/**
 * Unit tests for the search_documents built-in tool. The RagStore is stubbed on
 * the SessionManager (sessionManager.ragStore), mirroring how the worker wires it.
 */
import { createSearchDocumentsTool } from '../../../agent/tools/builtin/searchDocuments.js';

const SESSION_ID = 'sess_test';

describe('search_documents tool', () => {
  it('returns ranked results from the RagStore', async () => {
    const ragStore = {
      search: async () => [
        { fileId: 'f1', name: 'doc.txt', chunkIndex: 0, location: { startChar: 0, endChar: 10 }, score: 0.9, text: 'relevant excerpt' }
      ]
    };
    const tool = createSearchDocumentsTool({ ragStore }, SESSION_ID);
    const res = await tool.handler({ query: 'something' });
    expect(res.isError).toBe(false);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].name).toBe('doc.txt');
  });

  it('returns a helpful message when there are no matches', async () => {
    const ragStore = { search: async () => [] };
    const tool = createSearchDocumentsTool({ ragStore }, SESSION_ID);
    const res = await tool.handler({ query: 'nothing' });
    expect(res.isError).toBe(false);
    const payload = JSON.parse(res.content[0].text);
    expect(payload.results).toEqual([]);
    expect(payload.message).toMatch(/no/i);
  });

  it('errors gracefully when RAG is not available', async () => {
    const tool = createSearchDocumentsTool({}, SESSION_ID); // no ragStore
    const res = await tool.handler({ query: 'x' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not available/i);
  });

  it('errors gracefully when search throws', async () => {
    const ragStore = { search: async () => { throw new Error('boom'); } };
    const tool = createSearchDocumentsTool({ ragStore }, SESSION_ID);
    const res = await tool.handler({ query: 'x' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/boom/);
  });

  it('passes topK and fileId through to the store', async () => {
    let received = null;
    const ragStore = { search: async (_sm, _sid, _q, opts) => { received = opts; return []; } };
    const tool = createSearchDocumentsTool({ ragStore }, SESSION_ID);
    await tool.handler({ query: 'x', topK: 3, fileId: 'abc' });
    expect(received).toEqual({ topK: 3, fileId: 'abc' });
  });
});
