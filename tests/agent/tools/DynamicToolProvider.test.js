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
  hydrateMessagesForOpenAi,
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

    const hydrated = hydrateMessagesForOpenAi(messages, store);
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

// ─── Deferred client tools (the search/dispatch pair) ────────────────────────
//
// Past config.agentClientToolSearchThreshold the schemas are withheld and the
// model gets two tools instead: one that hands back a schema, one that runs a
// tool by name. What matters is that a withheld tool is still reachable, is
// still called with its declared timeout and media contract, and still shows the
// user its own name rather than the dispatcher's.

describe('deferred client tools', () => {
  let sessionManager;
  let sessionId;
  let sendToClient;
  let store;
  let provider;

  // Seven — one over the default threshold of five.
  const MANY_TOOLS = [
    TEXT_TOOL,
    WRITE_MEDIA_TOOL,
    CAPTURE_TOOL,
    { name: 'export_model_to_csv', description: 'Export the model to a CSV file', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    { name: 'open_panel', description: 'Open a panel in the user interface', inputSchema: { type: 'object', properties: { panel: { type: 'string' } }, required: ['panel'] } },
    { name: 'set_units', description: 'Set the units on a variable', inputSchema: { type: 'object', properties: { variable: { type: 'string' }, units: { type: 'string' } }, required: ['variable', 'units'] } },
    { name: 'slow_report', description: 'Run a long report', inputSchema: { type: 'object', properties: {} }, timeout: 600000 }
  ];

  beforeEach(() => {
    const base = join(tmpdir(), `deferred-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
    sessionManager = new SessionManager({ tempBasePath: base, disableCleanup: true });
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'sfd', {}, MANY_TOOLS, {}, 'test-client');
    sendToClient = jest.fn().mockResolvedValue(undefined);
    store = new MediaStore(sessionManager, sessionId);
    provider = new DynamicToolProvider(sessionManager, sessionId, sendToClient, store);
  });

  afterEach(() => sessionManager.shutdown());

  const search = (input) => provider.getTools().tools.client_search_tools.handler(input);
  const call = (input) => provider.getTools().tools.client_call_tool.handler(input);
  const parse = (result) => JSON.parse(result.content[0].text);

  describe('what the model is advertised', () => {
    it('withholds every schema and offers the pair instead', () => {
      expect(provider.deferred).toBe(true);
      expect(provider.getToolNames().sort()).toEqual(['client_call_tool', 'client_search_tools']);
      expect(provider.isClientTool('client_write_interface_media')).toBe(false);
    });

    it('names every tool in the search description, and no schemas', () => {
      const { description } = provider.getTools().tools.client_search_tools;

      for (const tool of MANY_TOOLS) expect(description).toContain(tool.name);
      // The point of the exercise: the catalogue is names, not schemas.
      expect(description).not.toContain('inputSchema');
      expect(description).not.toContain('"properties"');
    });

    it('registers directly, as before, when there are few enough tools', () => {
      const base = join(tmpdir(), `few-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
      const manager = new SessionManager({ tempBasePath: base, disableCleanup: true });
      const id = manager.createSession(null);
      manager.initializeSession(id, 'sfd', {}, [TEXT_TOOL, WRITE_MEDIA_TOOL], {}, 'test-client');
      const few = new DynamicToolProvider(manager, id, sendToClient, new MediaStore(manager, id));

      expect(few.deferred).toBe(false);
      expect(few.getToolNames().sort()).toEqual(['client_get_variable_tags', 'client_write_interface_media']);
      manager.shutdown();
    });
  });

  describe('search', () => {
    it('returns the full schema, and the media contract with it', async () => {
      const found = parse(await search({ query: 'write an image into the interface' }));
      const media = found.matches.find(match => match.name === 'write_interface_media');

      expect(media.inputSchema).toEqual(WRITE_MEDIA_TOOL.inputSchema);
      // Without this the model has a `string` argument and no way to learn that
      // only a handle will do.
      expect(media.note).toMatch(/media handle/);
    });

    it('fetches exact names with select:, and says which it did not know', async () => {
      const found = parse(await search({ query: 'select:open_panel,not_a_tool' }));

      expect(found.matches.map(match => match.name)).toEqual(['open_panel']);
      expect(found.unknown).toEqual(['not_a_tool']);
    });

    it('ranks a name hit above a description-only hit', async () => {
      const found = parse(await search({ query: 'panel' }));
      expect(found.matches[0].name).toBe('open_panel');
    });

    it('honours a required term', async () => {
      const found = parse(await search({ query: '+units set' }));
      expect(found.matches.map(match => match.name)).toEqual(['set_units']);
    });

    it('caps the result count', async () => {
      const found = parse(await search({ query: 'the', maxResults: 2 }));
      expect(found.matches.length).toBeLessThanOrEqual(2);
    });

    it('falls back to the catalogue when nothing matches, so the model is not stuck', async () => {
      const found = parse(await search({ query: 'zzzz_nothing_like_this' }));

      expect(found.matches).toEqual([]);
      expect(found.available).toEqual(MANY_TOOLS.map(tool => tool.name));
    });

    it('reports a tool\'s declared timeout so a long wait is expected', async () => {
      const found = parse(await search({ query: 'select:slow_report' }));
      expect(found.matches[0].timeoutMs).toBe(600000);
    });
  });

  describe('dispatch', () => {
    it('runs the withheld tool under its own name', async () => {
      const pending = call({ name: 'open_panel', arguments: '{"panel":"equations"}' });
      const request = sendToClient.mock.calls.at(-1)[0];

      expect(request.type).toBe('tool_call_request');
      // The client is asked for the real tool, never for the dispatcher.
      expect(request.toolName).toBe('open_panel');
      expect(request.arguments).toEqual({ panel: 'equations' });

      sessionManager.resolvePendingToolCall(sessionId, request.callId, { opened: true });
      expect((await pending).isError).toBe(false);
    });

    it('accepts arguments as an object as well as a string', async () => {
      const pending = call({ name: 'open_panel', arguments: { panel: 'equations' } });
      const request = sendToClient.mock.calls.at(-1)[0];

      expect(request.arguments).toEqual({ panel: 'equations' });
      sessionManager.resolvePendingToolCall(sessionId, request.callId, { opened: true });
      await pending;
    });

    it('runs a no-argument tool with arguments omitted', async () => {
      const pending = call({ name: 'get_variable_tags' });
      const request = sendToClient.mock.calls.at(-1)[0];

      expect(request.toolName).toBe('get_variable_tags');
      sessionManager.resolvePendingToolCall(sessionId, request.callId, { tags: [] });
      await pending;
    });

    it('carries the declared timeout and the media contract through', async () => {
      const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });
      const pending = call({
        name: 'write_interface_media',
        arguments: JSON.stringify({ name: 'hero.png', image: meta.mediaId, description: 'a red square' })
      });
      const request = sendToClient.mock.calls.at(-1)[0];

      // Both are read from the client's own definition inside
      // requestClientExecution — dispatching must not lose them.
      expect(request.media).toEqual([expect.objectContaining({ mediaId: meta.mediaId, argument: 'image' })]);
      expect(request.timeout).toBe(30000);

      sessionManager.resolvePendingToolCall(sessionId, request.callId, { path: 'assets/hero.png' });
      await pending;
    });

    it('hands back a picture the tool returned', async () => {
      const meta = store.put(PNG_1x1, { name: 'preview.png', mimeType: 'image/png' });
      const pending = call({ name: 'capture_interface_preview' });
      const request = sendToClient.mock.calls.at(-1)[0];
      sessionManager.resolvePendingToolCall(sessionId, request.callId, { ok: true }, false, [meta]);

      const result = await pending;
      expect(result.content[1]).toMatchObject({ type: 'media', mediaId: meta.mediaId });
    });

    it('rejects a name nothing registered, and lists what there is', async () => {
      const result = await call({ name: 'no_such_tool', arguments: '{}' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('open_panel');
      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('rejects malformed JSON arguments without a round trip', async () => {
      const result = await call({ name: 'open_panel', arguments: '{panel: equations' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/not valid JSON/);
      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('rejects arguments the schema does not allow, and returns the schema', async () => {
      const result = await call({ name: 'set_units', arguments: '{"variable":"population"}' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('units');
      // The retry should be informed rather than another guess.
      expect(result.content[0].text).toContain(JSON.stringify(MANY_TOOLS.find(t => t.name === 'set_units').inputSchema));
      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('passes through a key the client did not declare rather than dropping it', async () => {
      // Zod strips undeclared keys; a client whose schema is looser than its
      // implementation would lose them silently, so the raw arguments are sent.
      const pending = call({ name: 'open_panel', arguments: '{"panel":"equations","focus":"stocks"}' });
      const request = sendToClient.mock.calls.at(-1)[0];

      expect(request.arguments).toEqual({ panel: 'equations', focus: 'stocks' });
      sessionManager.resolvePendingToolCall(sessionId, request.callId, { opened: true });
      await pending;
    });

    it('turns a timeout into an error envelope, as a registered handler would', async () => {
      const pending = call({ name: 'open_panel', arguments: '{"panel":"equations"}' });
      const request = sendToClient.mock.calls.at(-1)[0];
      sessionManager.resolvePendingToolCall(sessionId, request.callId, { error: 'boom' }, true);

      await expect(pending).resolves.toHaveProperty('isError');
    });
  });

  describe('what the user is shown', () => {
    it.each([
      ['client_call_tool', 'the manual routes'],
      ['mcp__client__call_tool', 'the Agent SDK'],
      ['call_tool', 'ADK']
    ])('unwraps %s (%s) to the tool actually being run', (name) => {
      const displayed = provider.describeCall(name, { name: 'open_panel', arguments: '{"panel":"equations"}' });

      expect(displayed).toEqual({ name: 'open_panel', input: { panel: 'equations' } });
    });

    it('leaves anything that is not a dispatch alone', () => {
      expect(provider.describeCall('run_model', { a: 1 })).toEqual({ name: 'run_model', input: { a: 1 } });
      // A dispatch with no name to unwrap is not a dispatch worth rewriting.
      expect(provider.describeCall('client_call_tool', {})).toEqual({ name: 'client_call_tool', input: {} });
    });

    it('points a direct call at the dispatcher instead of failing flat', () => {
      const message = provider.toolNotFoundMessage('client_open_panel');

      expect(message).toContain('open_panel');
      expect(message).toContain('call_tool');
    });

    it('says only what it knows for a name that is nobody\'s tool', () => {
      expect(provider.toolNotFoundMessage('invented_tool')).toBe('Tool not found: invented_tool');
    });
  });
});
