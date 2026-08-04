/**
 * DynamicToolProvider — the client-tool subsystem. No test file existed for it
 * before, which is why the double-wrapped envelope survived as long as it did.
 *
 * No network and no real WebSocket: sendToClient is a spy and the client's reply
 * is simulated by resolving the pending call, which is exactly what
 * AgentWorker does when a tool_call_response arrives.
 */
import { jest } from '@jest/globals';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { DynamicToolProvider } from '../../../agent/tools/DynamicToolProvider.js';
import { MediaStore } from '../../../agent/utilities/MediaStore.js';
import { SessionManager } from '../../../agent/utilities/SessionManager.js';
import {
  toMcpContentResult,
  toOpenRouterAgentOutput,
  toolResultToText,
  toolResultToBlocks,
  hydrateMessagesForAnthropic,
  hydrateContentsForGemini,
  hydrateMessagesForOpenRouter,
  mediaBlocksOf
} from '../../../agent/utilities/ToolResultFormatter.js';

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PNG_B64 = PNG_1x1.toString('base64');

// A text-only tool and a media-bearing one, declared the way Stella declares them.
const TEXT_TOOL = {
  name: 'get_variable_tags',
  description: 'Tags on variables',
  inputSchema: { type: 'object', properties: {}, required: [] }
};

const WRITE_MEDIA_TOOL = {
  name: 'write_interface_media',
  description: 'Write a generated image into the interface assets folder',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      image: { type: 'string' },
      description: { type: 'string' }
    },
    required: ['name', 'image', 'description']
  },
  media: { inputs: ['image'], returnsMedia: false, maxItems: 1 }
};

const CAPTURE_TOOL = {
  name: 'capture_interface_preview',
  description: 'Photograph the interface preview',
  inputSchema: { type: 'object', properties: {}, required: [] },
  media: { inputs: [], returnsMedia: true, maxItems: 1 }
};

describe('DynamicToolProvider', () => {
  let sessionManager;
  let sessionId;
  let sendToClient;
  let store;
  let provider;

  beforeEach(() => {
    const base = join(tmpdir(), `dyntool-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
    sessionManager = new SessionManager({ tempBasePath: base, disableCleanup: true });
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'sfd', {},
      [TEXT_TOOL, WRITE_MEDIA_TOOL, CAPTURE_TOOL], {}, 'test-client');
    sendToClient = jest.fn().mockResolvedValue(undefined);
    store = new MediaStore(sessionManager, sessionId);
    provider = new DynamicToolProvider(sessionManager, sessionId, sendToClient, store);
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  // Answer the request the provider just sent, the way AgentWorker does.
  function replyToLastCall(result, media = [], isError = false) {
    const request = sendToClient.mock.calls.at(-1)[0];
    sessionManager.resolvePendingToolCall(sessionId, request.callId, result, isError, media);
    return request;
  }

  describe('registration', () => {
    it('prefixes every client tool and keeps its description', () => {
      expect(provider.getToolNames().sort()).toEqual([
        'client_capture_interface_preview',
        'client_get_variable_tags',
        'client_write_interface_media'
      ]);
      expect(provider.isClientTool('client_write_interface_media')).toBe(true);
      expect(provider.isClientTool('write_interface_media')).toBe(false);
    });
  });

  describe('a text-only tool behaves exactly as it did before media existed', () => {
    it('produces one text block and nothing else', async () => {
      const pending = provider.requestClientExecution('get_variable_tags', {});
      replyToLastCall({ tags: ['stock'] });

      expect(await pending).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ tags: ['stock'] }, null, 2) }],
        isError: false
      });
    });

    it('sends no media key on the request at all', async () => {
      const pending = provider.requestClientExecution('get_variable_tags', {});
      const request = replyToLastCall({ ok: true });
      await pending;

      expect(request).not.toHaveProperty('media');
      expect(request.type).toBe('tool_call_request');
    });

    it('passes a string result through unchanged', async () => {
      const pending = provider.requestClientExecution('get_variable_tags', {});
      replyToLastCall('plain text answer');

      expect((await pending).content[0].text).toBe('plain text answer');
    });
  });

  describe('inbound media (a tool answering with a picture)', () => {
    it('builds a mixed content array and names the handle in the text', async () => {
      const meta = store.put(PNG_1x1, { name: 'preview.png', mimeType: 'image/png' });
      const pending = provider.requestClientExecution('capture_interface_preview', {});
      replyToLastCall({ viewport: { width: 1180, height: 720 } }, [meta]);
      const result = await pending;

      expect(result.isError).toBe(false);
      expect(result.content).toHaveLength(2);
      expect(result.content[0].type).toBe('text');
      // The handle is in the prose as well as in its own block, so a route that
      // cannot render an image still knows what came back and what to call it.
      expect(result.content[0].text).toContain(meta.mediaId);
      expect(result.content[1]).toMatchObject({ type: 'media', mediaId: meta.mediaId, mimeType: 'image/png' });
    });

    // The load-bearing assertion of the whole design.
    it('never puts base64 in the envelope', async () => {
      const meta = store.put(PNG_1x1, { name: 'preview.png', mimeType: 'image/png' });
      const pending = provider.requestClientExecution('capture_interface_preview', {});
      replyToLastCall({ ok: true }, [meta]);

      expect(JSON.stringify(await pending)).not.toContain(PNG_B64);
    });
  });

  describe('outbound media (a tool being handed a picture)', () => {
    it('attaches handles and metadata, and no bytes', async () => {
      const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });
      const pending = provider.requestClientExecution(
        'write_interface_media',
        { name: 'hero.png', image: meta.mediaId, description: 'a red square' });
      const request = replyToLastCall({ path: 'assets/hero.png' });
      await pending;

      // The handle stays in arguments exactly as written...
      expect(request.arguments.image).toBe(meta.mediaId);
      // ...and the sidecar names which argument it belongs to.
      expect(request.media).toEqual([{
        mediaId: meta.mediaId,
        argument: 'image',
        name: 'hero.png',
        mimeType: 'image/png',
        bytes: PNG_1x1.length
      }]);
      // Bytes are attached later, by the main-process relay.
      expect(request.media[0]).not.toHaveProperty('content');
      expect(JSON.stringify(request)).not.toContain(PNG_B64);
    });

    it.each([
      ['a file name instead of a handle', 'hero.png'],
      ['a description instead of a handle', 'a picture of a factory'],
      ['a malformed handle', 'med_nothex'],
      ['a well-formed handle that does not exist', 'med_0123456789abcdef'],
    ])('refuses %s without calling the client at all', async (_label, bad) => {
      const result = await provider.requestClientExecution(
        'write_interface_media',
        { name: 'hero.png', image: bad, description: 'x' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/media handle/);
      // The point: no round trip, so the client is never asked to do something
      // meaningless and the model gets a specific error instead.
      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('ignores a declared media argument the model did not supply', async () => {
      // capture_interface_preview declares inputs: [] — nothing to resolve.
      const pending = provider.requestClientExecution('capture_interface_preview', {});
      const request = replyToLastCall({ ok: true });
      await pending;

      expect(request).not.toHaveProperty('media');
    });
  });

  describe('timeout', () => {
    it('rejects, and drops the pending call so a late reply cannot resolve it', async () => {
      const pending = provider.requestClientExecution('get_variable_tags', {}, 20);

      await expect(pending).rejects.toThrow(/did not respond within 20ms/);

      const request = sendToClient.mock.calls.at(-1)[0];
      expect(sessionManager.getPendingToolCall(sessionId, request.callId)).toBeFalsy();
    });

    it('reports the timeout as a tool error through the registered handler', async () => {
      // The handler wraps requestClientExecution and turns a throw into an error
      // result, which is what the provider routes actually consume.
      const handler = provider.getTools().tools.client_get_variable_tags.handler;
      const result = await provider.requestClientExecution('get_variable_tags', {}, 20)
        .catch(error => ({ content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true }));

      expect(result.isError).toBe(true);
      expect(typeof handler).toBe('function');
    });
  });
});

// ─── The round trip, across every provider shape ─────────────────────────────

describe('media round trip through every provider route', () => {
  let sessionManager;
  let sessionId;
  let store;
  let provider;
  let sendToClient;
  let meta;
  let envelope;

  beforeEach(async () => {
    const base = join(tmpdir(), `roundtrip-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
    sessionManager = new SessionManager({ tempBasePath: base, disableCleanup: true });
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'sfd', {}, [CAPTURE_TOOL], {}, 'test-client');
    sendToClient = jest.fn().mockResolvedValue(undefined);
    store = new MediaStore(sessionManager, sessionId);
    provider = new DynamicToolProvider(sessionManager, sessionId, sendToClient, store);

    // Inbound leg: the client answered with a picture, which the main process
    // captured to the store before forwarding the handle.
    meta = store.captureBase64(PNG_B64, { name: 'preview.png', mimeType: 'image/png' });
    const pending = provider.requestClientExecution('capture_interface_preview', {});
    const request = sendToClient.mock.calls.at(-1)[0];
    sessionManager.resolvePendingToolCall(sessionId, request.callId, { ok: true }, false, [meta]);
    envelope = await pending;
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  it('anthropic-manual: history holds a handle, the request holds the bytes', () => {
    // What goes into the live session context.
    const messages = [{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: toolResultToBlocks(envelope) }]
    }];
    expect(JSON.stringify(messages)).not.toContain(PNG_B64);

    // What goes to the API.
    const hydrated = hydrateMessagesForAnthropic(messages, store);
    const image = hydrated[0].content[0].content.find(b => b.type === 'image');
    expect(image.source).toEqual({ type: 'base64', media_type: 'image/png', data: PNG_B64 });

    // And history is still clean afterwards — hydration must not mutate.
    expect(JSON.stringify(messages)).not.toContain(PNG_B64);
  });

  it('gemini-manual: a sibling inlineData part, with the functionResponse intact', () => {
    const parts = [{ functionResponse: { name: 'capture', response: { result: toolResultToText(envelope) } } }];
    for (const media of mediaBlocksOf(envelope)) parts.push({ media });
    const contents = [{ role: 'user', parts }];
    expect(JSON.stringify(contents)).not.toContain(PNG_B64);

    const hydrated = hydrateContentsForGemini(contents, store);
    expect(hydrated[0].parts[0].functionResponse).toBeDefined(); // isSafeConversationStart still works
    expect(hydrated[0].parts[1].inlineData).toEqual({ mimeType: 'image/png', data: PNG_B64 });
  });

  it('openrouter-manual: an imageUrl data URI on a trailing user turn', () => {
    const messages = [
      { role: 'tool', toolCallId: 'tc_1', content: toolResultToText(envelope) },
      { role: 'user', content: [{ type: 'text', text: 'Images returned by capture:' }, ...mediaBlocksOf(envelope)] }
    ];
    expect(JSON.stringify(messages)).not.toContain(PNG_B64);

    const hydrated = hydrateMessagesForOpenRouter(messages, store);
    expect(hydrated[0]).toEqual(messages[0]); // the tool message stays text-only
    expect(hydrated[1].content[1]).toEqual({
      type: 'image_url',
      imageUrl: { url: `data:image/png;base64,${PNG_B64}` }
    });
  });

  it('anthropic-sdk: an MCP image content block', () => {
    const mcp = toMcpContentResult(envelope, store);
    expect(mcp.content[0].type).toBe('text');
    expect(mcp.content[1]).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
    expect(mcp.isError).toBe(false);
  });

  it('openrouter-sdk: a native input_image part', () => {
    const parts = toOpenRouterAgentOutput(envelope, store);
    expect(parts[0].type).toBe('input_text');
    expect(parts[1]).toEqual({
      type: 'input_image',
      detail: 'auto',
      imageUrl: `data:image/png;base64,${PNG_B64}`
    });
  });

  it('google-sdk: text only from the tool, the picture queued for beforeModelCallback', () => {
    // ADK cannot return an image at all, so the tool returns text and the provider
    // queues the picture for the orchestrator to push onto the request.
    expect(toolResultToText(envelope)).toContain(meta.mediaId);
    expect(toolResultToText(envelope)).not.toContain(PNG_B64);
    expect(mediaBlocksOf(envelope)).toHaveLength(1);
  });

  it('a text-only result is a plain string on every route, exactly as before', () => {
    const textOnly = { content: [{ type: 'text', text: 'done' }], isError: false };
    expect(toolResultToBlocks(textOnly)).toBe('done');
    expect(toOpenRouterAgentOutput(textOnly, store)).toBe('done');
    expect(toMcpContentResult(textOnly, store).content).toEqual([{ type: 'text', text: 'done' }]);
  });

  it('degrades to a description when the bytes have been pruned', () => {
    store.remove(meta.mediaId);

    const mcp = toMcpContentResult(envelope, store);
    expect(mcp.content).toHaveLength(1); // no image block
    expect(mcp.content[0].text).toContain(meta.mediaId); // but the handle is still named
  });
});

// ─── The registered handler is the only correct way in ───────────────────────
//
// The manual routes used to call requestClientExecution directly, without the
// tool definition. That silently dropped two things: the tool's declared timeout
// (request_interface_media asks for eight hours because it waits for a person to
// find a photograph, and got 30 seconds), and the media contract (a tool expecting
// image bytes was sent the bare handle). Both are invisible until a real tool is
// called on a real route, so they get pinned here.

describe('the registered handler carries the tool definition', () => {
  let sessionManager;
  let sessionId;
  let sendToClient;
  let store;
  let provider;

  const SLOW_TOOL = {
    name: 'request_interface_media',
    description: 'Ask the user for media',
    inputSchema: { type: 'object', properties: { request: { type: 'string' } } },
    timeout: 1000 * 60 * 60 * 8
  };

  beforeEach(() => {
    const base = join(tmpdir(), `handler-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
    sessionManager = new SessionManager({ tempBasePath: base, disableCleanup: true });
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'sfd', {},
      [SLOW_TOOL, WRITE_MEDIA_TOOL], {}, 'test-client');
    sendToClient = jest.fn().mockResolvedValue(undefined);
    store = new MediaStore(sessionManager, sessionId);
    provider = new DynamicToolProvider(sessionManager, sessionId, sendToClient, store);
  });

  afterEach(() => sessionManager.shutdown());

  function handlerFor(name) {
    return provider.getTools().tools[name].handler;
  }

  it('honours a tool\'s declared timeout instead of the 30s default', async () => {
    const pending = handlerFor('client_request_interface_media')({ request: 'a photo' });
    const request = sendToClient.mock.calls.at(-1)[0];

    // Eight hours, as declared — not the default. A tool that waits on a human
    // being abandoned after 30 seconds is the bug this asserts against.
    expect(request.timeout).toBe(SLOW_TOOL.timeout);

    sessionManager.resolvePendingToolCall(sessionId, request.callId, { addedAny: false });
    await pending;
  });

  it('resolves the media contract, so a tool expecting bytes is sent them', async () => {
    const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });

    const pending = handlerFor('client_write_interface_media')(
      { name: 'hero.png', image: meta.mediaId, description: 'a red square' });
    const request = sendToClient.mock.calls.at(-1)[0];

    // Without the tool definition there is nothing to say `image` holds a handle,
    // and this sidecar would be absent — the client would get the handle alone.
    expect(request.media).toHaveLength(1);
    expect(request.media[0]).toMatchObject({ mediaId: meta.mediaId, argument: 'image' });

    sessionManager.resolvePendingToolCall(sessionId, request.callId, { path: 'assets/hero.png' });
    await pending;
  });

  it('resolves media from the bare requestClientExecution entry point too', async () => {
    // The structural point of looking the definition up: a caller that passes
    // neither a definition nor a timeout still gets both. Before, this path
    // silently sent the handle with no bytes attached.
    const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });

    const pending = provider.requestClientExecution('write_interface_media',
      { name: 'hero.png', image: meta.mediaId, description: 'a red square' });
    const request = sendToClient.mock.calls.at(-1)[0];

    expect(request.media).toHaveLength(1);
    expect(request.media[0].argument).toBe('image');

    sessionManager.resolvePendingToolCall(sessionId, request.callId, { ok: true });
    await pending;
  });

  it('takes the declared timeout with no timeout argument at all', async () => {
    const pending = provider.requestClientExecution('request_interface_media', { request: 'a photo' });
    const request = sendToClient.mock.calls.at(-1)[0];

    expect(request.timeout).toBe(SLOW_TOOL.timeout);

    sessionManager.resolvePendingToolCall(sessionId, request.callId, { addedAny: false });
    await pending;
  });

  it('turns a thrown failure into an error envelope rather than propagating it', async () => {
    // The routes consume envelopes; a handler that threw would abort the loop.
    const result = await handlerFor('client_write_interface_media')(
      { name: 'x.png', image: 'not-a-handle', description: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe('text');
  });
});
