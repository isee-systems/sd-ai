import { AgentOrchestrator } from '../../agent/AgentOrchestrator.js';
import { SessionManager } from '../../agent/utilities/SessionManager.js';
import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = { path: path.join(__dirname, '../../agent/config/socrates.md') };

// Minimal tool bag accepted by #isBuiltInTool and execute helpers
const EMPTY_TOOLS = { tools: {} };

function makeOrchestrator(sessionManager, sessionId) {
  process.env.ANTHROPIC_API_KEY = 'dummy';
  process.env.GEMINI_API_KEY = 'dummy';
  const sendToClient = jest.fn().mockResolvedValue(undefined);
  const orc = new AgentOrchestrator(sessionManager, sessionId, sendToClient, CONFIG);
  // Stub both execute methods so no real API calls happen
  orc.executeToolCallHelper = jest.fn().mockResolvedValue({
    content: 'tool output',
    isError: false,
  });
  orc.executeToolCallGeminiManual = jest.fn().mockResolvedValue({
    content: 'tool output',
    isError: false,
  });
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

  it('returns true to continue the loop when stop_reason is max_tokens', async () => {
    const messages = [];
    const response = {
      content: [{ type: 'text', text: 'Partial...' }],
      stop_reason: 'max_tokens',
    };

    const continueLoop = await orc.processAgentResponseAnthropicManual(
      response, messages, EMPTY_TOOLS, EMPTY_TOOLS
    );

    expect(continueLoop).toBe(true);
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
