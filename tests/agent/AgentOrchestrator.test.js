import { jest } from '@jest/globals';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { TEST_NATIVE_PROVIDERS, installTestNativeProviders } from './nativeProviderFixture.js';

// The native OpenAI-compatible suite at the bottom of this file needs registry entries for
// the providers it drives, and whether config.js ships them is a deployment decision — so
// the fixtures go in before the orchestrator is loaded, which is when the module derives
// OPENAI_COMPATIBLE_PROVIDERS from the registry keys.
installTestNativeProviders();

const { AgentOrchestrator } = await import('../../agent/AgentOrchestrator.js');
const { SessionManager } = await import('../../agent/utilities/SessionManager.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = { path: path.join(__dirname, '../../agent/config/socrates.md') };

// Minimal tool bag accepted by #isBuiltInTool and execute helpers
const EMPTY_TOOLS = { tools: {} };

// The block-array envelope every tool actually answers with. The stubs used to
// return `{ content: 'tool output' }` -- a bare string -- which is why the array
// branch of the flattener went unexercised for as long as it did. Bare strings
// are still a live path (the not-found and thrown-error returns), so they get
// their own explicit tests rather than being the default here.
const BLOCK_RESULT = { content: [{ type: 'text', text: 'tool output' }], isError: false };

function makeOrchestrator(sessionManager, sessionId, toolResult = BLOCK_RESULT) {
  process.env.ANTHROPIC_API_KEY = 'dummy';
  process.env.GEMINI_API_KEY = 'dummy';
  const sendToClient = jest.fn().mockResolvedValue(undefined);
  const orc = new AgentOrchestrator(sessionManager, sessionId, sendToClient, CONFIG);
  // Stub both execute methods so no real API calls happen
  orc.executeToolCallHelper = jest.fn().mockResolvedValue(toolResult);
  orc.executeToolCallGeminiManual = jest.fn().mockResolvedValue(toolResult);
  return orc;
}

// Helper builders for Gemini response shapes
function geminiText(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function geminiFunctionCalls(...calls) {
  return {
    candidates: [{
      content: {
        parts: calls.map(({ name, args }) => ({ functionCall: { name, args: args ?? {} } }))
      }
    }]
  };
}

function geminiTextAndFunctionCall(text, name, args = {}) {
  return {
    candidates: [{
      content: {
        parts: [{ text }, { functionCall: { name, args } }]
      }
    }]
  };
}

// ─── processAgentResponseAnthropicManual ────────────────────────────────────

describe('processAgentResponseAnthropicManual', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeOrchestrator(sessionManager, sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  // ── text-only response ────────────────────────────────────────────────────

  it('adds a single assistant text message for a text-only response', async () => {
    const messages = [];
    const response = {
      content: [{ type: 'text', text: 'Hello world' }],
      stop_reason: 'end_turn',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  // ── single tool call ──────────────────────────────────────────────────────

  it('adds one assistant+user pair for a single tool call', async () => {
    const messages = [{ role: 'user', content: 'question' }];
    const response = {
      content: [{ type: 'tool_use', id: 'tu_1', name: 'my_tool', input: { x: 1 } }],
      stop_reason: 'tool_use',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    // Original user message plus new assistant + user pair = 3 messages
    expect(messages).toHaveLength(3);

    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toEqual([
      { type: 'tool_use', id: 'tu_1', name: 'my_tool', input: { x: 1 } },
    ]);

    const toolResult = messages[2];
    expect(toolResult.role).toBe('user');
    expect(toolResult.content).toHaveLength(1);
    expect(toolResult.content[0].type).toBe('tool_result');
    expect(toolResult.content[0].tool_use_id).toBe('tu_1');
  });

  // ── multiple tool calls — the core regression ─────────────────────────────

  it('batches multiple tool calls into ONE assistant message and ONE user message', async () => {
    const messages = [{ role: 'user', content: 'do both' }];
    const response = {
      content: [
        { type: 'tool_use', id: 'tu_A', name: 'tool_a', input: {} },
        { type: 'tool_use', id: 'tu_B', name: 'tool_b', input: {} },
      ],
      stop_reason: 'tool_use',
    };

    await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    // Must be exactly 3 messages: original user + assistant + user-with-results
    expect(messages).toHaveLength(3);

    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toHaveLength(2);
    expect(assistant.content[0]).toMatchObject({ type: 'tool_use', id: 'tu_A' });
    expect(assistant.content[1]).toMatchObject({ type: 'tool_use', id: 'tu_B' });

    const results = messages[2];
    expect(results.role).toBe('user');
    expect(results.content).toHaveLength(2);
    expect(results.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_A' });
    expect(results.content[1]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_B' });
  });

  // ── text before tool calls ────────────────────────────────────────────────

  it('places text and tool_use blocks in the same assistant message', async () => {
    const messages = [{ role: 'user', content: 'go' }];
    const response = {
      content: [
        { type: 'text', text: 'Thinking...' },
        { type: 'tool_use', id: 'tu_C', name: 'tool_c', input: {} },
      ],
      stop_reason: 'tool_use',
    };

    await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(messages).toHaveLength(3);

    const assistant = messages[1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.content).toHaveLength(2);
    expect(assistant.content[0]).toMatchObject({ type: 'text', text: 'Thinking...' });
    expect(assistant.content[1]).toMatchObject({ type: 'tool_use', id: 'tu_C' });

    expect(messages[2].role).toBe('user');
    expect(messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_C' });
  });

  // ── stop requested before first block ────────────────────────────────────

  it('leaves messages untouched when stop is requested before processing', async () => {
    orc.stopRequested = true;
    const messages = [{ role: 'user', content: 'hello' }];
    const response = {
      content: [{ type: 'tool_use', id: 'tu_D', name: 'tool_d', input: {} }],
      stop_reason: 'tool_use',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toHaveLength(1); // unchanged
    expect(orc.executeToolCallHelper).not.toHaveBeenCalled();
  });

  // ── stop requested during tool execution ─────────────────────────────────

  it('leaves messages untouched when stop is requested mid-tool-execution', async () => {
    orc.executeToolCallHelper = jest.fn().mockImplementation(async () => {
      orc.stopRequested = true;
      return { content: 'result', isError: false };
    });

    const messages = [{ role: 'user', content: 'hello' }];
    const response = {
      content: [{ type: 'tool_use', id: 'tu_E', name: 'tool_e', input: {} }],
      stop_reason: 'tool_use',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    // Nothing should have been committed to messages — no orphaned tool_use
    expect(messages).toHaveLength(1);
  });

  // ── tool errors are included, not dropped ─────────────────────────────────

  it('records tool errors in the tool_result block', async () => {
    orc.executeToolCallHelper = jest.fn().mockResolvedValue({
      content: 'Something went wrong',
      isError: true,
    });

    const messages = [];
    const response = {
      content: [{ type: 'tool_use', id: 'tu_F', name: 'tool_f', input: {} }],
      stop_reason: 'tool_use',
    };

    await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(messages[1].content[0].is_error).toBe(true);
    expect(messages[1].content[0].content).toBe('Something went wrong');
  });

  // ── max_tokens keeps the loop going ──────────────────────────────────────

  it('returns true and appends a continuation user turn when stop_reason is max_tokens', async () => {
    const messages = [];
    const response = {
      content: [{ type: 'text', text: 'Partial...' }],
      stop_reason: 'max_tokens',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    // The conversation must end on a user turn — the configured Anthropic model
    // rejects assistant-message prefill, so the next API call 400s otherwise.
    expect(messages[messages.length - 1].role).toBe('user');
    expect(messages[messages.length - 1].content).toMatch(/cut off/i);
  });

  // ── string-content assistant tail — the shared-context regression ─────────

  it('promotes a trailing string-content assistant turn to block form instead of throwing', async () => {
    // The session context is shared with the SDK/OpenRouter/Gemini routes and
    // with restored history, which all write assistant turns as plain strings.
    const messages = [
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer from another route' },
    ];
    const response = {
      content: [{ type: 'text', text: 'continued' }],
      stop_reason: 'end_turn',
    };

    await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'answer from another route' },
      { type: 'text', text: 'continued' },
    ]);
  });

  it('does not append a continuation turn on max_tokens when nothing was committed', async () => {
    const messages = [{ role: 'user', content: 'question' }];
    const response = {
      content: [{ type: 'thinking', thinking: 'hmm' }], // no committable blocks
      stop_reason: 'max_tokens',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    // Messages still end on the original user turn; no bridge message needed.
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
  });
});

// ─── processGeminiManualResponse ────────────────────────────────────────────

describe('processGeminiManualResponse', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeOrchestrator(sessionManager, sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  // ── missing/empty candidate ───────────────────────────────────────────────

  it('returns false immediately when the response has no candidate', async () => {
    const continueLoop = await orc.processGeminiManualResponse(
      {}, [], EMPTY_TOOLS, EMPTY_TOOLS
    );
    expect(continueLoop).toBe(false);
  });

  // ── text-only response ────────────────────────────────────────────────────

  it('adds a model message and returns false for a text-only response', async () => {
    const messages = [];
    const continueLoop = await orc.processGeminiManualResponse(
      geminiText('Hello from Gemini'), messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('model');
    expect(messages[0].parts[0].text).toBe('Hello from Gemini');
  });

  // ── single function call ──────────────────────────────────────────────────

  it('adds model message then user message with functionResponse for one call', async () => {
    const messages = [{ role: 'user', parts: [{ text: 'go' }] }];
    const continueLoop = await orc.processGeminiManualResponse(
      geminiFunctionCalls({ name: 'my_tool', args: { x: 1 } }),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    expect(messages).toHaveLength(3); // original user + model + user-with-responses

    const model = messages[1];
    expect(model.role).toBe('model');
    expect(model.parts[0].functionCall.name).toBe('my_tool');

    const userResp = messages[2];
    expect(userResp.role).toBe('user');
    expect(userResp.parts).toHaveLength(1);
    expect(userResp.parts[0].functionResponse.name).toBe('my_tool');

    expect(orc.executeToolCallGeminiManual).toHaveBeenCalledWith({ name: 'my_tool', input: { x: 1 } });
  });

  // ── multiple function calls — all responses in ONE user message ───────────

  it('batches multiple function call responses into ONE user message', async () => {
    const messages = [{ role: 'user', parts: [{ text: 'do both' }] }];
    const continueLoop = await orc.processGeminiManualResponse(
      geminiFunctionCalls({ name: 'tool_a' }, { name: 'tool_b' }),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    // original user + model + one user with both responses = 3
    expect(messages).toHaveLength(3);

    const model = messages[1];
    expect(model.role).toBe('model');
    expect(model.parts).toHaveLength(2);

    const userResp = messages[2];
    expect(userResp.role).toBe('user');
    expect(userResp.parts).toHaveLength(2);
    expect(userResp.parts[0].functionResponse.name).toBe('tool_a');
    expect(userResp.parts[1].functionResponse.name).toBe('tool_b');

    expect(orc.executeToolCallGeminiManual).toHaveBeenCalledWith({ name: 'tool_a', input: {} });
    expect(orc.executeToolCallGeminiManual).toHaveBeenCalledWith({ name: 'tool_b', input: {} });
  });

  // ── thought parts are ignored by the text renderer ───────────────────────

  it('skips thought parts when streaming text to the client', async () => {
    const messages = [];
    const response = {
      candidates: [{
        content: {
          parts: [
            { thought: true, text: 'internal reasoning' },
            { text: 'visible answer' },
          ]
        }
      }]
    };

    await orc.processGeminiManualResponse(response, messages, EMPTY_TOOLS, EMPTY_TOOLS);

    // The model message contains all parts (thought + text)
    expect(messages[0].parts).toHaveLength(2);

    // Only the non-thought text should have been sent to the client
    const sentTexts = orc.sendToClient.mock.calls.flatMap(args => {
      const msg = args[0];
      return msg?.data?.text ? [msg.data.text] : [];
    });
    expect(sentTexts.some(t => t.includes('internal reasoning'))).toBe(false);
  });

  // ── stop requested before tool execution ─────────────────────────────────

  it('returns false without executing tools when stop is set before the loop', async () => {
    orc.stopRequested = true;
    const messages = [];

    const continueLoop = await orc.processGeminiManualResponse(
      geminiFunctionCalls({ name: 'tool_a' }),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(orc.executeToolCallGeminiManual).not.toHaveBeenCalled();
  });

  // ── stop requested during tool execution ─────────────────────────────────

  it('returns false without pushing the function response when stop fires mid-execution', async () => {
    orc.executeToolCallGeminiManual = jest.fn().mockImplementation(async () => {
      orc.stopRequested = true;
      return { content: 'partial', isError: false };
    });

    const messages = [];
    const continueLoop = await orc.processGeminiManualResponse(
      geminiFunctionCalls({ name: 'tool_a' }, { name: 'tool_b' }),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    // Only the model message is present; the user response was not committed
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('model');
    // Only one tool was executed before the stop
    expect(orc.executeToolCallGeminiManual).toHaveBeenCalledTimes(1);
    expect(orc.executeToolCallGeminiManual).toHaveBeenCalledWith({ name: 'tool_a', input: {} });
  });

  // ── tool errors are included in the response parts ────────────────────────

  it('records error output in the functionResponse for a failed tool', async () => {
    orc.executeToolCallGeminiManual = jest.fn().mockResolvedValue({
      content: 'Something failed',
      isError: true,
    });

    const messages = [];
    await orc.processGeminiManualResponse(
      geminiFunctionCalls({ name: 'bad_tool' }),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    const functionResp = messages[1].parts[0].functionResponse;
    expect(functionResp.name).toBe('bad_tool');
    expect(functionResp.response.result).toBe('Something failed');

    expect(orc.executeToolCallGeminiManual).toHaveBeenCalledWith({ name: 'bad_tool', input: {} });
  });
});

// ─── processOpenRouterManualResponse ────────────────────────────────────────

function openRouterCompletion(content, toolCalls) {
  return { choices: [{ message: { content, toolCalls } }] };
}

describe('processOpenRouterManualResponse', () => {
  let sessionManager;
  let sessionId;
  let orc;
  let messages;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeOrchestrator(sessionManager, sessionId);
    // The real loop hands the live session context to the processor — the array
    // and the session's history are the same object, which is exactly what makes
    // a stray messages.push a duplicate rather than a second bookkeeping copy.
    messages = sessionManager.getConversationContext(sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('commits a text-only response as exactly one assistant turn', async () => {
    const continueLoop = await orc.processOpenRouterManualResponse(
      openRouterCompletion('Hello world', []), messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: 'assistant', content: 'Hello world' });
  });

  it('carries the text on the toolCalls turn instead of committing it twice', async () => {
    const completion = openRouterCompletion('Let me check that', [
      { id: 'tc_1', function: { name: 'my_tool', arguments: '{"x":1}' } },
    ]);

    const continueLoop = await orc.processOpenRouterManualResponse(
      completion, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    // One assistant turn (text + toolCalls) then one tool result — no duplicate
    // text-only assistant turn ahead of it.
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('assistant');
    expect(messages[0].content).toBe('Let me check that');
    expect(messages[0].toolCalls).toEqual([
      { id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{"x":1}' } },
    ]);
    expect(messages[1]).toEqual({ role: 'tool', toolCallId: 'tc_1', content: 'tool output' });
    expect(orc.executeToolCallHelper).toHaveBeenCalledWith(
      { name: 'my_tool', input: { x: 1 } }, EMPTY_TOOLS, EMPTY_TOOLS
    );
  });

  it('commits no assistant turn for an empty text-only response', async () => {
    const continueLoop = await orc.processOpenRouterManualResponse(
      openRouterCompletion('   ', []), messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toHaveLength(0);
  });

  // Each processor speaks exactly one dialect. Feeding a wire-format response through
  // this one is how the OpenAI route came to stop dead at its first tool call — the
  // camelCase read found nothing, so the turn looked like an empty text answer.
  it('does not see wire-format tool_calls — that is the OpenAI processor\'s job', async () => {
    const continueLoop = await orc.processOpenRouterManualResponse(
      { choices: [{ message: { content: null, tool_calls: [{ id: 'tc_1', function: { name: 'my_tool', arguments: '{}' } }] } }] },
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(orc.executeToolCallHelper).not.toHaveBeenCalled();
  });
});

// ─── processOpenAiManualResponse ────────────────────────────────────────────
//
// The native OpenAI-compatible route's own processor: the official `openai` client
// sends and receives the wire format, so this one reads `tool_calls` and writes
// `tool_call_id`, with no translation step between it and the request.

function openAiCompletion(content, toolCalls) {
  return { choices: [{ message: { content, tool_calls: toolCalls } }] };
}

describe('processOpenAiManualResponse', () => {
  let sessionManager;
  let sessionId;
  let orc;
  let messages;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeOrchestrator(sessionManager, sessionId);
    messages = sessionManager.getConversationContext(sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('commits a text-only response as exactly one assistant turn', async () => {
    const continueLoop = await orc.processOpenAiManualResponse(
      openAiCompletion('Hello world', []), messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toEqual([{ role: 'assistant', content: 'Hello world' }]);
  });

  it('runs the tool and records the turn in the wire format', async () => {
    const completion = openAiCompletion('Let me check that', [
      { id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{"x":1}' } },
    ]);

    const continueLoop = await orc.processOpenAiManualResponse(
      completion, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Let me check that');
    expect(messages[0].tool_calls).toEqual([
      { id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{"x":1}' } },
    ]);
    expect(messages[0].toolCalls).toBeUndefined();
    expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'tc_1', content: 'tool output' });
    expect(orc.executeToolCallHelper).toHaveBeenCalledWith(
      { name: 'my_tool', input: { x: 1 } }, EMPTY_TOOLS, EMPTY_TOOLS
    );
  });

  it('ignores camelCase tool calls — the OpenRouter dialect is not this route\'s', async () => {
    const continueLoop = await orc.processOpenAiManualResponse(
      { choices: [{ message: { content: null, toolCalls: [{ id: 'tc_1', function: { name: 'my_tool', arguments: '{}' } }] } }] },
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(orc.executeToolCallHelper).not.toHaveBeenCalled();
  });

  it('commits no assistant turn for an empty text-only response', async () => {
    const continueLoop = await orc.processOpenAiManualResponse(
      openAiCompletion('   ', []), messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(false);
    expect(messages).toHaveLength(0);
  });
});

// ─── tool result flattening, shared across the four manual routes ───────────
//
// They used to carry their own copies of the filter/map/join, and disagreed about
// the non-array cases -- one used String(), one JSON.stringify(), one checked for a
// string first. These pin the shared helper's behaviour on every route so a future
// edit cannot quietly reintroduce the divergence. The routes are deliberately
// separate code paths; toolResultToText is the one thing they still share.

describe('tool result flattening (all manual routes)', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
  });

  afterEach(() => {
    orc?.destroy();
    sessionManager.shutdown();
  });

  // Each case stubs the tool result, then reads back what the route put in front
  // of the model. `sessionManager.getConversationContext` rather than a fresh
  // array because the openrouter route commits its assistant turn through
  // addToConversationHistory -- the live context and `messages` are one object.
  function route(toolResult) {
    orc = makeOrchestrator(sessionManager, sessionId, toolResult);
    return { orc, messages: sessionManager.getConversationContext(sessionId) };
  }

  const TEXT_BLOCKS = { content: [{ type: 'text', text: 'tool output' }], isError: false };
  const BARE_STRING = { content: 'tool output', isError: false };

  const anthropicToolUse = {
    content: [{ type: 'tool_use', id: 'tu_1', name: 'my_tool', input: {} }],
    stop_reason: 'tool_use',
  };

  it.each([
    ['a block array', TEXT_BLOCKS],
    ['a bare string', BARE_STRING],
  ])('anthropic-manual renders %s into tool_result content', async (_label, toolResult) => {
    const { orc, messages } = route(toolResult);
    messages.push({ role: 'user', content: 'go' });

    await orc.processAgentResponseAnthropicManual(anthropicToolUse, messages, EMPTY_TOOLS, EMPTY_TOOLS);

    expect(messages[2].content[0].content).toBe('tool output');
  });

  it('joins multiple text blocks with newlines rather than dropping any', async () => {
    const { orc, messages } = route({
      content: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
      isError: false,
    });
    messages.push({ role: 'user', content: 'go' });

    await orc.processAgentResponseAnthropicManual(anthropicToolUse, messages, EMPTY_TOOLS, EMPTY_TOOLS);

    expect(messages[2].content[0].content).toBe('first\nsecond');
  });

  it.each([
    ['a block array', TEXT_BLOCKS],
    ['a bare string', BARE_STRING],
  ])('gemini-manual renders %s into the functionResponse result', async (_label, toolResult) => {
    const { orc, messages } = route(toolResult);

    await orc.processGeminiManualResponse(
      geminiFunctionCalls({ name: 'my_tool' }), messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(messages[1].parts[0].functionResponse.response.result).toBe('tool output');
  });

  it.each([
    ['a block array', TEXT_BLOCKS],
    ['a bare string', BARE_STRING],
  ])('openrouter-manual renders %s into the tool message', async (_label, toolResult) => {
    const { orc, messages } = route(toolResult);

    await orc.processOpenRouterManualResponse(
      openRouterCompletion('Let me check', [
        { id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{}' } },
      ]),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(messages[1]).toEqual({ role: 'tool', toolCallId: 'tc_1', content: 'tool output' });
  });

  it.each([
    ['a block array', TEXT_BLOCKS],
    ['a bare string', BARE_STRING],
  ])('openai-manual renders %s into the tool message', async (_label, toolResult) => {
    const { orc, messages } = route(toolResult);

    await orc.processOpenAiManualResponse(
      openAiCompletion('Let me check', [
        { id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{}' } },
      ]),
      messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(messages[1]).toEqual({ role: 'tool', tool_call_id: 'tc_1', content: 'tool output' });
  });

  // The bug this whole pass exists to kill: a client tool's envelope used to be
  // wrapped a second time, so the model was shown the JSON of the envelope
  // rather than what the tool said.
  it('never shows the model a stringified envelope', async () => {
    const { orc, messages } = route(TEXT_BLOCKS);
    messages.push({ role: 'user', content: 'go' });

    await orc.processAgentResponseAnthropicManual(anthropicToolUse, messages, EMPTY_TOOLS, EMPTY_TOOLS);

    const rendered = messages[2].content[0].content;
    expect(rendered).toBe('tool output');
    expect(rendered).not.toContain('isError');
    expect(rendered).not.toContain('"type"');
  });
});

// ─── startConversation — prior-context dispatching ──────────────────────────

const SDK_CONFIG = { path: path.join(__dirname, '../../agent/config/merlin.md') };

function makeStubbedOrchestrator(sessionManager, sessionId, agentConfig = CONFIG, provider = 'anthropic') {
  process.env.ANTHROPIC_API_KEY = 'dummy';
  process.env.GEMINI_API_KEY = 'dummy';
  const sendToClient = jest.fn().mockResolvedValue(undefined);
  const orc = new AgentOrchestrator(sessionManager, sessionId, sendToClient, agentConfig, provider);
  // #fetchCurrentModel invokes the get_current_model tool which awaits a
  // 30-second client RPC. Strip the tool so it returns early in tests.
  orc.builtInToolProvider.getTools = jest.fn().mockReturnValue({ tools: {} });
  // Replace the four provider-specific entry points so startConversation's
  // dispatcher logic runs but no real API calls happen.
  orc.startConversationAnthropicManual = jest.fn().mockResolvedValue(undefined);
  orc.startConversationWithAnthropicSdk = jest.fn().mockResolvedValue(undefined);
  orc.startConversationGeminiManual = jest.fn().mockResolvedValue(undefined);
  orc.startConversationWithGeminiAdk = jest.fn().mockResolvedValue(undefined);
  return orc;
}

describe('startConversation — prior-context dispatching (manual)', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeStubbedOrchestrator(sessionManager, sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('pops a trailing user message from previousAgentContext before dispatching', async () => {
    const prior = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'unanswered' },
    ];

    await orc.startConversation('new question', prior);

    expect(prior).toHaveLength(2);
    expect(prior[prior.length - 1]).toEqual({ role: 'assistant', content: 'b' });
    expect(orc.startConversationAnthropicManual).toHaveBeenCalledWith('new question');
  });

  it('preserves a trailing assistant message (initial history replay case)', async () => {
    const prior = [
      { role: 'user', content: 'historical question' },
      { role: 'assistant', content: 'historical answer' },
    ];

    await orc.startConversation('follow-up', prior);

    expect(prior).toHaveLength(2);
    expect(prior[prior.length - 1]).toEqual({ role: 'assistant', content: 'historical answer' });
    expect(orc.startConversationAnthropicManual).toHaveBeenCalledWith('follow-up');
  });

  it('does not crash and does not pop when previousAgentContext is null', async () => {
    await expect(orc.startConversation('hi', null)).resolves.toBeUndefined();
    expect(orc.startConversationAnthropicManual).toHaveBeenCalledWith('hi');
  });

  it('does not crash and does not pop when previousAgentContext is an empty array', async () => {
    const prior = [];
    await orc.startConversation('hi', prior);
    expect(prior).toHaveLength(0);
    expect(orc.startConversationAnthropicManual).toHaveBeenCalledWith('hi');
  });

  it('preserves a Gemini-format trailing model message untouched (cross-mode handoff)', async () => {
    const prior = [
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
    ];

    await orc.startConversation('next', prior);

    expect(prior).toHaveLength(2);
    expect(prior[prior.length - 1]).toEqual({ role: 'model', parts: [{ text: 'a' }] });
  });
});

describe('startConversation — prior-context dispatching (SDK)', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeStubbedOrchestrator(sessionManager, sessionId, SDK_CONFIG);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('does not pop trailing user in SDK mode — the SDK route handles slicing itself', async () => {
    const prior = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'still-trailing' },
    ];

    await orc.startConversation('new question', prior);

    expect(prior).toHaveLength(3);
    expect(prior[prior.length - 1]).toEqual({ role: 'user', content: 'still-trailing' });
    expect(orc.startConversationWithAnthropicSdk).toHaveBeenCalledWith('new question', prior);
  });

  it('forwards previousAgentContext reference unchanged to the SDK dispatch', async () => {
    const prior = [
      { role: 'user', content: 'historical' },
      { role: 'assistant', content: 'reply' },
    ];

    await orc.startConversation('next', prior);

    const callArgs = orc.startConversationWithAnthropicSdk.mock.calls[0];
    expect(callArgs[0]).toBe('next');
    expect(callArgs[1]).toBe(prior);
  });
});

// ─── startConversation clears stale stop state ──────────────────────────────

// Routes clear stopRequested when their run ends, but a stop that arrives while
// nothing is running has no run to clear it. Left set, it makes the next run
// skip its queued messages and report itself as stopped.

describe('startConversation — stale stopRequested', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeStubbedOrchestrator(sessionManager, sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('clears a stop that arrived while no run was in flight', async () => {
    let flagSeenByRoute;
    orc.startConversationAnthropicManual = jest.fn().mockImplementation(async () => {
      flagSeenByRoute = orc.stopRequested;
    });

    orc.stopIteration();
    expect(orc.stopRequested).toBe(true);

    await orc.startConversation('next question', null);

    // The route must see it already cleared — it reads the flag on every turn.
    expect(flagSeenByRoute).toBe(false);
    expect(orc.stopRequested).toBe(false);
  });
});

// ─── sandbox write gating at execute time ───────────────────────────────────

// The declaration-time filter (isToolAvailable, covered in toolAvailability.test.js)
// can only decline to *advertise* write_file and edit_file — the tool objects stay in
// the collection and the manual execute paths reach them by name. This is the second
// guard, and it earns its keep on agent switch: the previous agent's transcript is
// replayed into the next agent's prompt, so an agent without the grant can be reading
// worked examples of the tools Merlin has.
const SANDBOX_AGENT = grant => ({
  markdownContent: `---\nname: "SandboxTest"\nagent_mode: manual\nsupported_modes:\n  - cld\n${grant}---\n## Instructions\nDo things.\n`
});

describe('sandbox write gating — manual execute paths', () => {
  let sessionManager;
  let sessionId;
  let tmpDir;
  let orcs;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdai-sandbox-'));
    orcs = [];
  });

  afterEach(() => {
    for (const orc of orcs) orc.destroy();
    sessionManager.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeAgent(grantLine) {
    process.env.ANTHROPIC_API_KEY = 'dummy';
    process.env.GEMINI_API_KEY = 'dummy';
    const orc = new AgentOrchestrator(
      sessionManager, sessionId, jest.fn().mockResolvedValue(undefined), SANDBOX_AGENT(grantLine)
    );
    orcs.push(orc);
    return orc;
  }

  it('refuses write_file and leaves the disk alone without the grant', async () => {
    const orc = makeAgent('');
    const target = path.join(tmpDir, 'forbidden.txt');

    const result = await orc.executeToolCallHelper(
      { name: 'write_file', input: { filePath: target, content: 'should never land' } },
      orc.builtInToolProvider.getTools()
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/cannot write to the local sandbox/);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses edit_file the same way', async () => {
    const orc = makeAgent('can_write_to_local_sandbox: false\n');
    const target = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(target, 'original', 'utf-8');

    const result = await orc.executeToolCallHelper(
      { name: 'edit_file', input: { filePath: target, oldString: 'original', newString: 'tampered' } },
      orc.builtInToolProvider.getTools()
    );

    expect(result.isError).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('original');
  });

  it('lets a granted manual-mode agent write — the flag is authoritative off the SDK route too', async () => {
    const orc = makeAgent('can_write_to_local_sandbox: true\n');
    const target = path.join(tmpDir, 'allowed.txt');

    const result = await orc.executeToolCallHelper(
      { name: 'write_file', input: { filePath: target, content: 'landed' } },
      orc.builtInToolProvider.getTools()
    );

    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(target, 'utf-8')).toBe('landed');
  });

  it('advertises the write tools to a granted manual-mode agent', async () => {
    // The refusal guard is the backstop; this is the path the model actually sees.
    const granted = makeAgent('can_write_to_local_sandbox: true\n');
    const denied = makeAgent('');
    const catalogue = orc => orc.builtInToolProvider.getTools().tools;

    expect(await granted.builtInToolProvider.getAdkTools('cld', 0).then(t => t.map(x => x.name)))
      .toContain('write_file');
    expect(await denied.builtInToolProvider.getAdkTools('cld', 0).then(t => t.map(x => x.name)))
      .not.toContain('write_file');
    // Both still hold the tool object — withholding happens in the filter, not the catalogue.
    expect(catalogue(granted).write_file).toBeDefined();
    expect(catalogue(denied).write_file).toBeDefined();
  });

  it('never refuses a read, whichever way the flag is set', async () => {
    const target = path.join(tmpDir, 'data.csv');
    fs.writeFileSync(target, 'time,value\n0,1\n', 'utf-8');

    for (const grant of ['', 'can_write_to_local_sandbox: true\n']) {
      const orc = makeAgent(grant);
      const result = await orc.executeToolCallHelper(
        { name: 'read_file', input: { filePath: target } },
        orc.builtInToolProvider.getTools()
      );
      expect(result.isError).toBeFalsy();
    }
  });

  it('applies the same refusal on the Gemini manual path', async () => {
    const orc = makeAgent('');
    const target = path.join(tmpDir, 'gemini.txt');

    const result = await orc.executeToolCallGeminiManual(
      { name: 'write_file', input: { filePath: target, content: 'should never land' } }
    );

    expect(result.isError).toBe(true);
    expect(fs.existsSync(target)).toBe(false);
  });
});

// ─── native OpenAI-compatible manual loop — outbound request shape ───────────
//
// Everything this loop sends is shaped by the provider id, and each mismatch has
// already reached production once: max_tokens (rejected for the GPT-5 family),
// reasoning_effort with function tools (rejected on /v1/chat/completions), and the
// camelCase tool-call keys (silently invisible, so the agent stopped at its first
// tool call). These pin the whole payload rather than any one of them.

describe('startConversationOpenAiCompatibleManual — request shape', () => {
  let sessionManager;
  let sessionId;
  let orc;
  let create;

  function makeNativeOrchestrator(provider) {
    process.env.OPENAI_API_KEY = 'dummy';
    process.env.DEEPSEEK_API_KEY = 'dummy';
    const sendToClient = jest.fn().mockResolvedValue(undefined);
    const o = new AgentOrchestrator(sessionManager, sessionId, sendToClient, CONFIG, provider);
    o.executeToolCallHelper = jest.fn().mockResolvedValue(BLOCK_RESULT);
    // The lazy getter returns this instance when it is already set, so no SDK is
    // constructed and no request leaves the process.
    o.openAiCompatibleClient = { chat: { completions: { create } } };
    return o;
  }

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    // Round one asks for a tool, round two answers in text so the loop terminates.
    create = jest.fn()
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{}' } }]
          }
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5 }
      })
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'All done', tool_calls: [] } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 }
      });
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('sends the tool result back in the snake_case dialect the official client requires', async () => {
    orc = makeNativeOrchestrator('openai');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    expect(create).toHaveBeenCalledTimes(2);
    expect(orc.executeToolCallHelper).toHaveBeenCalledWith(
      { name: 'my_tool', input: {} }, expect.anything(), expect.anything()
    );

    const secondRequest = create.mock.calls[1][0];
    const assistant = secondRequest.messages.find(m => m.role === 'assistant');
    const toolResult = secondRequest.messages.find(m => m.role === 'tool');
    expect(assistant.tool_calls[0].id).toBe('tc_1');
    expect(toolResult.tool_call_id).toBe('tc_1');
    // Not one camelCase key anywhere in the payload — the official client 400s on an
    // unrecognized property rather than ignoring it.
    const wire = JSON.stringify(secondRequest);
    expect(wire).not.toContain('toolCalls');
    expect(wire).not.toContain('toolCallId');
    expect(wire).not.toContain('imageUrl');
  });

  it('sends openai the registry model with reasoning off', async () => {
    orc = makeNativeOrchestrator('openai');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    const firstRequest = create.mock.calls[0][0];
    expect(firstRequest.model).toBe(TEST_NATIVE_PROVIDERS.openai.model);
    expect(firstRequest.reasoning_effort).toBe('none');
    expect(firstRequest.messages[0].role).toBe('system');
  });

  it('leaves deepseek requests free of the openai-only parameters', async () => {
    orc = makeNativeOrchestrator('deepseek');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    const firstRequest = create.mock.calls[0][0];
    expect(firstRequest.model).toBe(TEST_NATIVE_PROVIDERS.deepseek.model);
    expect(firstRequest.reasoning_effort).toBeUndefined();
  });
});

// ─── native OpenAI-compatible manual loop — usage reporting ──────────────────
//
// One report per request, never a total held back to the end of the run. The loop
// used to keep only the latest usage and report it once on the way out, which billed
// a five-turn conversation for its fifth turn — and billed a run the user stopped for
// whichever turn happened to be last before the break. Per-request is also the only
// shape openai's pricing tiers accept: they charge by the size of one prompt, and a
// summed input count crosses the 272K long-context line no single request went near.

describe('startConversationOpenAiCompatibleManual — usage reporting', () => {
  let sessionManager;
  let sessionId;
  let orc;
  let create;

  const FIRST_USAGE = {
    prompt_tokens: 100,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 10, cache_write_tokens: 5 },
  };
  const SECOND_USAGE = {
    prompt_tokens: 200,
    completion_tokens: 30,
    prompt_tokens_details: { cached_tokens: 100, cache_write_tokens: 0 },
  };

  function toolCallTurn(usage) {
    return {
      choices: [{
        message: {
          content: null,
          tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'my_tool', arguments: '{}' } }]
        }
      }],
      usage,
    };
  }

  function makeNativeOrchestrator(provider) {
    process.env.OPENAI_API_KEY = 'dummy';
    process.env.DEEPSEEK_API_KEY = 'dummy';
    const sendToClient = jest.fn().mockResolvedValue(undefined);
    const o = new AgentOrchestrator(sessionManager, sessionId, sendToClient, CONFIG, provider);
    o.executeToolCallHelper = jest.fn().mockResolvedValue(BLOCK_RESULT);
    o.openAiCompatibleClient = { chat: { completions: { create } } };
    o.tokenReporter = { report: jest.fn().mockResolvedValue(undefined) };
    return o;
  }

  function reports(o) {
    return o.tokenReporter.report.mock.calls.map(([call]) => call);
  }

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    create = jest.fn();
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('reports each turn as its own request rather than one total at the end', async () => {
    create
      .mockResolvedValueOnce(toolCallTurn(FIRST_USAGE))
      .mockResolvedValueOnce({ choices: [{ message: { content: 'All done', tool_calls: [] } }], usage: SECOND_USAGE });
    orc = makeNativeOrchestrator('openai');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    expect(reports(orc)).toEqual([
      { provider: 'openai', model: TEST_NATIVE_PROVIDERS.openai.model, usage: FIRST_USAGE, clientKey: false },
      { provider: 'openai', model: TEST_NATIVE_PROVIDERS.openai.model, usage: SECOND_USAGE, clientKey: false },
    ]);
  });

  it('reports the turn in flight when the user stops mid-loop', async () => {
    create
      .mockResolvedValueOnce(toolCallTurn(FIRST_USAGE))
      .mockImplementationOnce(async () => {
        // The stop lands while this turn is in flight. It completed upstream, so
        // its tokens are on the bill whether or not the loop goes another round.
        orc.stopIteration();
        return { choices: [{ message: { content: 'half an answer', tool_calls: [] } }], usage: SECOND_USAGE };
      });
    orc = makeNativeOrchestrator('deepseek');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    expect(reports(orc).map(r => r.usage)).toEqual([FIRST_USAGE, SECOND_USAGE]);
    // deepseek bills on its own table, not openai's — the usage shapes differ too.
    expect(reports(orc).every(r => r.provider === 'deepseek')).toBe(true);
  });

  it('reports what the run spent before a request failed', async () => {
    create
      .mockResolvedValueOnce(toolCallTurn(FIRST_USAGE))
      .mockRejectedValueOnce(new Error('upstream exploded'));
    orc = makeNativeOrchestrator('openai');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    expect(reports(orc).map(r => r.usage)).toEqual([FIRST_USAGE]);
  });

  it('reports nothing for a run that never reached the API', async () => {
    create.mockRejectedValueOnce(new Error('upstream exploded'));
    orc = makeNativeOrchestrator('openai');

    await orc.startConversationOpenAiCompatibleManual('build me a model');

    expect(orc.tokenReporter.report).not.toHaveBeenCalled();
  });
});
