import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The SDK route resolves `query` through a dynamic import, so the mock has to be
// registered before AgentOrchestrator.js is imported below.
const query = jest.fn();
jest.unstable_mockModule('@anthropic-ai/claude-agent-sdk', () => ({
  query,
  createSdkMcpServer: jest.fn(),
  tool: jest.fn(),
}));

const { AgentOrchestrator } = await import('../../agent/AgentOrchestrator.js');
const { SessionManager } = await import('../../agent/utilities/SessionManager.js');

const CONFIG = { path: path.join(__dirname, '../../agent/config/merlin.md') };

// Turn a list of SDK messages into the async iterable `query` hands back.
function iterator(...messages) {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

const INIT = { type: 'system', subtype: 'init', session_id: 'sdk-session-1' };
const DONE = { type: 'result', subtype: 'success' };
const ASK_USER_QUESTION = {
  type: 'assistant',
  message: {
    content: [{
      type: 'tool_use',
      id: 'tu_ask',
      name: 'AskUserQuestion',
      input: { questions: [{ question: 'Which one?', options: [{ label: 'A', description: 'a' }] }] },
    }],
  },
};

function makeOrchestrator(sessionManager, sessionId) {
  process.env.ANTHROPIC_API_KEY = 'dummy';
  const sendToClient = jest.fn().mockResolvedValue(undefined);
  const orc = new AgentOrchestrator(sessionManager, sessionId, sendToClient, CONFIG, 'anthropic');
  // Keep the route's setup off the network and off the client RPC channel.
  orc.builtInToolProvider.getMcpServer = jest.fn().mockResolvedValue({});
  orc.builtInToolProvider.getTools = jest.fn().mockReturnValue({ tools: {} });
  orc.builtInToolProvider.getToolNames = jest.fn().mockReturnValue([]);
  orc.dynamicToolProvider.getMcpServer = jest.fn().mockResolvedValue(null);
  orc.dynamicToolProvider.getToolNames = jest.fn().mockReturnValue([]);
  return orc;
}

function completionMessages(orc) {
  return orc.sendToClient.mock.calls
    .map(([m]) => m)
    .filter(m => m.type === 'agent_complete');
}

describe('Anthropic SDK route — stopRequested is per-run state', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    query.mockReset();
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    orc = makeOrchestrator(sessionManager, sessionId);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('drains messages queued while the SDK was running', async () => {
    query
      .mockReturnValueOnce(iterator(INIT, DONE))
      .mockReturnValueOnce(iterator(DONE));

    const run = orc.startConversationWithAnthropicSdk('first');
    orc.queueMessage('queued while working');
    await run;

    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0].prompt).toBe('queued while working');
    expect(completionMessages(orc).at(-1).status).toBe('success');
  });

  it('clears stopRequested after an AskUserQuestion intercept ends the run', async () => {
    query.mockReturnValueOnce(iterator(INIT, ASK_USER_QUESTION, DONE));

    await orc.startConversationWithAnthropicSdk('first');

    expect(orc.stopRequested).toBe(false);
    expect(completionMessages(orc).at(-1).status).toBe('awaiting_user');
  });

  it('clears stopRequested after the user stops the run', async () => {
    query.mockReturnValueOnce((async function* () {
      yield INIT;
      orc.stopIteration();
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    })());

    await orc.startConversationWithAnthropicSdk('first');

    expect(orc.stopRequested).toBe(false);
    expect(completionMessages(orc).at(-1).status).toBe('awaiting_user');
  });

  // The regression: a stop that leaked into later runs left the drain loop's
  // `!this.stopRequested` guard permanently false, so every message the user
  // sent while the agent was working was silently dropped.
  it('still drains queued messages on the run after a stopped run', async () => {
    query.mockReturnValueOnce(iterator(INIT, ASK_USER_QUESTION, DONE));
    await orc.startConversationWithAnthropicSdk('first');

    query
      .mockReturnValueOnce(iterator(DONE))
      .mockReturnValueOnce(iterator(DONE));

    const run = orc.startConversationWithAnthropicSdk('second');
    orc.queueMessage('queued after a stop');
    await run;

    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[2][0].prompt).toBe('queued after a stop');
  });
});
