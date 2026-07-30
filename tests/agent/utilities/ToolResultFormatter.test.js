import { toolResultToText } from '../../../agent/utilities/ToolResultFormatter.js';

// Pure functions, no I/O. This file is where the exact contract lives: every
// provider route reads a tool result through here, so a change in behaviour that
// is not reflected in this file is a change no route asked for.

describe('toolResultToText', () => {
  it('renders a single text block', () => {
    expect(toolResultToText({ content: [{ type: 'text', text: 'hello' }], isError: false }))
      .toBe('hello');
  });

  it('joins multiple text blocks with newlines', () => {
    expect(toolResultToText({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }))
      .toBe('a\nb');
  });

  it('accepts a bare string envelope — the not-found and thrown-error paths', () => {
    expect(toolResultToText({ content: 'Tool not found: nope', isError: true }))
      .toBe('Tool not found: nope');
  });

  it('accepts a content array passed directly, without its envelope', () => {
    expect(toolResultToText([{ type: 'text', text: 'hello' }])).toBe('hello');
  });

  it('accepts a bare string', () => {
    expect(toolResultToText('hello')).toBe('hello');
  });

  it('drops non-text blocks rather than stringifying their internals', () => {
    const text = toolResultToText({
      content: [
        { type: 'text', text: 'described below' },
        { type: 'media', mediaId: 'med_0000000000000001', mimeType: 'image/png' },
      ],
    });
    expect(text).toBe('described below');
    expect(text).not.toContain('med_');
  });

  it('renders a text block with no text as empty rather than "undefined"', () => {
    expect(toolResultToText({ content: [{ type: 'text' }] })).toBe('');
  });

  it('stringifies a structured content value that is not a block array', () => {
    expect(toolResultToText({ content: { runId: 7 } })).toBe('{"runId":7}');
  });

  it.each([
    ['null content', { content: null }],
    ['undefined content', { content: undefined }],
    ['empty block array', { content: [] }],
  ])('renders %s as the empty string', (_label, result) => {
    expect(toolResultToText(result)).toBe('');
  });

  // The regression this helper was extracted to prevent: a client tool's
  // envelope wrapped a second time used to reach the model as its own JSON.
  it('never emits the envelope keys for a well-formed result', () => {
    const text = toolResultToText({ content: [{ type: 'text', text: 'ok' }], isError: false });
    expect(text).not.toContain('isError');
    expect(text).not.toContain('content');
  });
});

// ─── Per-route shapes ────────────────────────────────────────────────────────
//
// One route (the built-in MCP registration) shipped without its converter and
// failed at runtime with an invalid_union from MCP. These pin the accepted shape
// for every route so the next omission fails here instead of in production.

import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import {
  mediaBlock,
  toolResultToBlocks,
  toMcpContentResult,
  toOpenRouterAgentOutput,
  hydrateMessagesForAnthropic,
  hydrateContentsForGemini,
  hydrateMessagesForOpenAi,
  MediaBudget
} from '../../../agent/utilities/ToolResultFormatter.js';
import { MediaStore } from '../../../agent/utilities/MediaStore.js';
import { SessionManager } from '../../../agent/utilities/SessionManager.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
const PNG_B64 = PNG.toString('base64');

describe('per-route content shapes', () => {
  let sessionManager;
  let sessionId;
  let store;
  let envelope;
  let meta;

  beforeEach(() => {
    const base = join(tmpdir(), `fmt-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
    sessionManager = new SessionManager({ tempBasePath: base, disableCleanup: true });
    sessionId = sessionManager.createSession(null);
    store = new MediaStore(sessionManager, sessionId);
    meta = store.put(PNG, { name: 'drawn.png', mimeType: 'image/png' });
    envelope = { content: [{ type: 'text', text: 'drew it' }, mediaBlock(meta)], isError: false };
  });

  afterEach(() => sessionManager.shutdown());

  describe('anthropic-sdk (MCP)', () => {
    // MCP validates content against this union and rejects the whole call
    // otherwise — which is exactly what happened in production.
    const MCP_TYPES = new Set(['text', 'image', 'audio', 'resource_link', 'resource']);

    it('emits only MCP-valid content types', () => {
      for (const block of toMcpContentResult(envelope, store).content) {
        expect(MCP_TYPES.has(block.type)).toBe(true);
      }
    });

    it('uses data+mimeType, which is MCP\'s image shape and not Anthropic\'s', () => {
      const image = toMcpContentResult(envelope, store).content[1];
      expect(image).toEqual({ type: 'image', data: PNG_B64, mimeType: 'image/png' });
      expect(image).not.toHaveProperty('source');
    });
  });

  describe('openrouter-sdk', () => {
    // @openrouter/agent's own predicate (conversation-state.js isContentArray).
    // It is all-or-nothing: one element of any other type and the SDK falls back
    // to JSON.stringify on the whole array, quietly pushing a base64 data URI
    // into the model's context as text instead of as an image.
    function sdkWouldAcceptVerbatim(value) {
      if (!Array.isArray(value) || value.length === 0) return false;
      return value.every(item => typeof item === 'object' && item !== null && 'type' in item
        && (item.type === 'input_text' || item.type === 'input_image' || item.type === 'input_file'));
    }

    it('produces an array the SDK preserves verbatim', () => {
      expect(sdkWouldAcceptVerbatim(toOpenRouterAgentOutput(envelope, store))).toBe(true);
    });

    it('sets detail, which InputImage requires', () => {
      const image = toOpenRouterAgentOutput(envelope, store)[1];
      expect(image).toEqual({ type: 'input_image', detail: 'auto', imageUrl: `data:image/png;base64,${PNG_B64}` });
    });

    it('returns a plain string with no media, never an empty array', () => {
      // isContentArray rejects [], which would be stringified as "[]".
      const out = toOpenRouterAgentOutput({ content: [{ type: 'text', text: 'done' }] }, store);
      expect(typeof out).toBe('string');
      expect(out).toBe('done');
    });

    it('stays acceptable when an image degrades to text', () => {
      store.remove(meta.mediaId);
      const out = toOpenRouterAgentOutput(envelope, store);
      // Degraded to a single text part, so it is a string — still never a mixed
      // array with a foreign block type in it.
      expect(typeof out === 'string' || sdkWouldAcceptVerbatim(out)).toBe(true);
    });
  });

  describe('anthropic-manual', () => {
    it('keeps history free of bytes and hydrates only the request', () => {
      const messages = [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: toolResultToBlocks(envelope) }]
      }];

      expect(JSON.stringify(messages)).not.toContain(PNG_B64);

      const hydrated = hydrateMessagesForAnthropic(messages, store);
      expect(hydrated[0].content[0].content[1]).toEqual({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: PNG_B64 }
      });

      // The invariant that matters: hydration must not mutate the live context.
      expect(JSON.stringify(messages)).not.toContain(PNG_B64);
    });

    it('emits a text block, not a media block, when the budget is spent', () => {
      const messages = [{
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: toolResultToBlocks(envelope) }]
      }];

      const spent = new MediaBudget({ maxImages: 0, maxBytes: 0 });
      const hydrated = hydrateMessagesForAnthropic(messages, store, spent);
      const block = hydrated[0].content[0].content[1];

      // Anthropic accepts text and image inside a tool_result — never our handle.
      expect(block.type).toBe('text');
      expect(block.text).toContain(meta.mediaId);
    });
  });

  describe('gemini-manual', () => {
    it('converts the sibling part and leaves the functionResponse intact', () => {
      const contents = [{
        role: 'user',
        parts: [
          { functionResponse: { name: 'capture', response: { result: 'drew it' } } },
          { media: mediaBlock(meta) }
        ]
      }];

      const hydrated = hydrateContentsForGemini(contents, store);

      // isSafeConversationStart looks for a part with a functionResponse; the extra
      // sibling must not disturb that.
      expect(hydrated[0].parts[0].functionResponse).toBeDefined();
      expect(hydrated[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG_B64 } });
      // No `media` key survives into what Gemini is sent.
      expect(hydrated[0].parts.some(p => 'media' in p)).toBe(false);
    });
  });

  describe('openrouter-manual', () => {
    // `imageUrl`, not `image_url`. This assertion is the whole point of the test: the
    // key was snake_case here and in the assertion, so the suite passed while every
    // real chat.send carrying a picture failed input validation before it left the
    // process. The shape is pinned against the SDK's own schema below.
    it('rewrites media to an imageUrl part and leaves the tool message text-only', () => {
      const messages = [
        { role: 'tool', toolCallId: 'tc_1', content: 'drew it' },
        { role: 'user', content: [{ type: 'text', text: 'Images:' }, mediaBlock(meta)] }
      ];

      const hydrated = hydrateMessagesForOpenAi(messages, store);

      expect(hydrated[0]).toEqual(messages[0]);
      expect(hydrated[1].content[1]).toEqual({
        type: 'image_url',
        imageUrl: { url: `data:image/png;base64,${PNG_B64}` }
      });
      expect(JSON.stringify(hydrated[1].content).includes('"type":"media"')).toBe(false);
    });

    // Against @openrouter/sdk's real outbound schema rather than a hand-written
    // expectation, because a hand-written one is exactly what was wrong before. This is
    // the parse chat.send runs on the way out; it remaps imageUrl -> image_url itself.
    it('produces a content part @openrouter/sdk will accept', async () => {
      const { ChatContentItems$outboundSchema } = await import('@openrouter/sdk/models');

      const hydrated = hydrateMessagesForOpenAi(
        [{ role: 'user', content: [{ type: 'text', text: 'Images:' }, mediaBlock(meta)] }], store);

      for (const part of hydrated[0].content) {
        const parsed = ChatContentItems$outboundSchema.safeParse(part);
        expect(parsed.success).toBe(true);
      }
    });
  });

  describe('every route, one invariant', () => {
    it('never leaves an internal media block in what a provider is sent', () => {
      const shapes = [
        toMcpContentResult(envelope, store).content,
        toOpenRouterAgentOutput(envelope, store),
        hydrateMessagesForAnthropic(
          [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: toolResultToBlocks(envelope) }] }],
          store),
        hydrateContentsForGemini([{ role: 'user', parts: [{ media: mediaBlock(meta) }] }], store),
        hydrateMessagesForOpenAi([{ role: 'user', content: [mediaBlock(meta)] }], store)
      ];

      for (const shape of shapes) {
        expect(JSON.stringify(shape)).not.toContain('"type":"media"');
      }
    });
  });
});
