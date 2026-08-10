import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The SDK loop resolves callModel/tool/stepCountIs through a dynamic import, so the
// mock has to be registered before AgentOrchestrator.js is imported below.
const callModel = jest.fn();
jest.unstable_mockModule('@openrouter/agent', () => ({
  callModel,
  stepCountIs: (steps) => ({ steps }),
  tool: (definition) => definition,
}));

// Which OpenRouter brands config.js ships is a deployment decision — entries are
// commented in and out as the deployed configuration changes — but both loops are
// always in the tree and each resolves its model out of this registry. So the suite
// owns its entry rather than borrowing today's config, and the model is a fixture no
// request can reach. Jest gives each test file its own module registry, so the
// mutation cannot leak to another suite.
const PROVIDER = 'qwen';
const MODEL = 'test-openrouter-model';
config.openRouterAgentProviders = {
  ...config.openRouterAgentProviders,
  [PROVIDER]: { displayName: 'Qwen (test)', model: MODEL, summaryModel: 'test-openrouter-summary-model' },
};

const { AgentOrchestrator } = await import('../../agent/AgentOrchestrator.js');
const { SessionManager } = await import('../../agent/utilities/SessionManager.js');

const CONFIG = { path: path.join(__dirname, '../../agent/config/socrates.md') };
const BLOCK_RESULT = { content: [{ type: 'text', text: 'tool output' }], isError: false };

// Chat-completions usage, the shape @openrouter/sdk hands the manual loop.
function chatUsage(promptTokens, completionTokens, cost, cachedTokens = 0, cacheWriteTokens = 0) {
  return {
    promptTokens,
    completionTokens,
    promptTokensDetails: { cachedTokens, cacheWriteTokens },
    cost,
    totalTokens: promptTokens + completionTokens,
  };
}

// Responses-API usage, the shape @openrouter/agent puts on `response.completed`.
function responsesUsage(inputTokens, outputTokens, cost, cachedTokens = 0) {
  return {
    inputTokens,
    outputTokens,
    inputTokensDetails: { cachedTokens },
    cost,
    totalTokens: inputTokens + outputTokens,
  };
}

function toolCallCompletion(usage) {
  return {
    choices: [{ message: { content: null, toolCalls: [{ id: 'tc_1', function: { name: 'my_tool', arguments: '{}' } }] } }],
    usage,
  };
}

function textCompletion(text, usage) {
  return { choices: [{ message: { content: text, toolCalls: [] } }], usage };
}

function responseCompleted(id, usage) {
  return { type: 'response.completed', response: { id, usage } };
}

function reportedUsage(orc) {
  return orc.tokenReporter.report.mock.calls.map(([call]) => call);
}

function completionStatuses(orc) {
  return orc.sendToClient.mock.calls.map(([m]) => m).filter(m => m.type === 'agent_complete').map(m => m.status);
}

function makeOrchestrator(sessionManager, sessionId, send) {
  process.env.OPEN_ROUTER_API_KEY = 'dummy';
  const sendToClient = jest.fn().mockResolvedValue(undefined);
  const orc = new AgentOrchestrator(sessionManager, sessionId, sendToClient, CONFIG, PROVIDER);
  orc.executeToolCallHelper = jest.fn().mockResolvedValue(BLOCK_RESULT);
  // The lazy getter hands back a client that is already set, so no SDK is
  // constructed and no request leaves the process.
  orc.openRouterClient = { chat: { send } };
  orc.builtInToolProvider.getTools = jest.fn().mockReturnValue({ tools: {} });
  orc.dynamicToolProvider.getTools = jest.fn().mockReturnValue({ tools: {} });
  orc.tokenReporter = { report: jest.fn().mockResolvedValue(undefined) };
  return orc;
}

// Every OpenRouter request bills on its own — the responses API and chat completions
// alike return the cost of that one call — so a tool loop that ran five turns has five
// usage blocks and the last one is not the total. These pin that they are summed, and
// that the sum is reported however the run ends: a user stop mid-loop is the case that
// used to bill only whichever turn happened to be last before the break.

describe('OpenRouter manual loop — usage reporting', () => {
  let sessionManager;
  let sessionId;
  let orc;
  let send;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    send = jest.fn();
    orc = makeOrchestrator(sessionManager, sessionId, send);
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('reports every turn the user was billed for when they stop mid-loop', async () => {
    send
      .mockImplementationOnce(async () => toolCallCompletion(chatUsage(100, 20, 0.001, 10, 5)))
      .mockImplementationOnce(async () => {
        // The user hits stop while this turn is in flight. It still completed
        // upstream, so its tokens are on the bill either way.
        orc.stopIteration();
        return textCompletion('half an answer', chatUsage(200, 30, 0.002, 100, 0));
      });

    await orc.startConversationOpenRouterManual('build me a model');

    expect(send).toHaveBeenCalledTimes(2);
    expect(completionStatuses(orc).at(-1)).toBe('awaiting_user');

    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].provider).toBe('openrouter');
    expect(reports[0].model).toBe(MODEL);
    expect(reports[0].usage).toEqual({
      promptTokens: 300,
      completionTokens: 50,
      promptTokensDetails: { cachedTokens: 110, cacheWriteTokens: 5 },
      cost: 0.003,
    });
  });

  it('reports the sum of every turn on a run that ends by itself', async () => {
    send
      .mockResolvedValueOnce(toolCallCompletion(chatUsage(100, 20, 0.001)))
      .mockResolvedValueOnce(textCompletion('all done', chatUsage(200, 30, 0.002)));

    await orc.startConversationOpenRouterManual('build me a model');

    expect(completionStatuses(orc).at(-1)).toBe('success');
    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].usage.promptTokens).toBe(300);
    expect(reports[0].usage.completionTokens).toBe(50);
    expect(reports[0].usage.cost).toBe(0.003);
  });

  it('reports what the run spent before a request failed', async () => {
    send
      .mockResolvedValueOnce(toolCallCompletion(chatUsage(100, 20, 0.001)))
      .mockRejectedValueOnce(new Error('upstream exploded'));

    await orc.startConversationOpenRouterManual('build me a model');

    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].usage.promptTokens).toBe(100);
    expect(reports[0].usage.cost).toBe(0.001);
  });

  it('leaves cost null rather than zero when no response priced itself', async () => {
    send.mockResolvedValueOnce(textCompletion('all done', chatUsage(100, 20, undefined)));

    await orc.startConversationOpenRouterManual('build me a model');

    expect(reportedUsage(orc)[0].usage.cost).toBeNull();
  });

  it('does not report a run that never reached the API', async () => {
    send.mockRejectedValueOnce(new Error('upstream exploded'));

    await orc.startConversationOpenRouterManual('build me a model');

    expect(orc.tokenReporter.report).not.toHaveBeenCalled();
  });
});

describe('OpenRouter SDK loop — usage reporting', () => {
  let sessionManager;
  let sessionId;
  let orc;

  // A ModelResult stand-in: the three streams the loop consumes, plus the
  // getResponse() promise it awaits.
  function modelResult(events, { getResponse = async () => ({}) } = {}) {
    return {
      getToolCallsStream: () => (async function* () {})(),
      getFullResponsesStream: () => events(),
      getResponse,
    };
  }

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
    callModel.mockReset();
    orc = makeOrchestrator(sessionManager, sessionId, jest.fn());
  });

  afterEach(() => {
    orc.destroy();
    sessionManager.shutdown();
  });

  it('reports every turn the user was billed for when they stop mid-run', async () => {
    callModel.mockReturnValueOnce(modelResult(async function* () {
      yield responseCompleted('resp_1', responsesUsage(100, 20, 0.001, 10));
      // The user hits stop between turns. The request in flight is not cancelled,
      // so the turn it is on completes and bills like any other.
      orc.stopIteration();
      yield { type: 'response.output_item.done', item: { id: 'item_1', type: 'message', content: [{ type: 'output_text', text: 'text nobody sees' }] } };
      yield responseCompleted('resp_2', responsesUsage(200, 30, 0.002, 100));
    }));

    await orc.startConversationOpenRouterSDK('build me a model');

    expect(completionStatuses(orc).at(-1)).toBe('awaiting_user');
    expect(orc.stopRequested).toBe(false);

    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].provider).toBe('openrouter');
    expect(reports[0].model).toBe(MODEL);
    expect(reports[0].usage).toEqual({
      promptTokens: 300,
      completionTokens: 50,
      promptTokensDetails: { cachedTokens: 110, cacheWriteTokens: 0 },
      cost: 0.003,
    });
  });

  it('bills a reissued response.completed once, not twice', async () => {
    callModel.mockReturnValueOnce(modelResult(async function* () {
      yield responseCompleted('resp_1', responsesUsage(100, 20, 0.001));
      yield responseCompleted('resp_1', responsesUsage(100, 20, 0.001));
      yield responseCompleted('resp_2', responsesUsage(200, 30, 0.002));
    }));

    await orc.startConversationOpenRouterSDK('build me a model');

    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].usage.promptTokens).toBe(300);
    expect(reports[0].usage.completionTokens).toBe(50);
    expect(reports[0].usage.cost).toBe(0.003);
  });

  it('reports what the run spent before it aborted', async () => {
    callModel.mockReturnValueOnce(modelResult(
      async function* () {
        yield responseCompleted('resp_1', responsesUsage(100, 20, 0.001));
        orc.stopIteration();
      },
      {
        getResponse: async () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          throw err;
        }
      }
    ));

    await orc.startConversationOpenRouterSDK('build me a model');

    expect(completionStatuses(orc).at(-1)).toBe('awaiting_user');
    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].usage.promptTokens).toBe(100);
    expect(reports[0].usage.cost).toBe(0.001);
  });

  it('reports what the run spent before it errored', async () => {
    callModel.mockReturnValueOnce(modelResult(
      async function* () {
        yield responseCompleted('resp_1', responsesUsage(100, 20, 0.001));
      },
      { getResponse: async () => { throw new Error('upstream exploded'); } }
    ));

    await orc.startConversationOpenRouterSDK('build me a model');

    const reports = reportedUsage(orc);
    expect(reports).toHaveLength(1);
    expect(reports[0].usage.promptTokens).toBe(100);
  });
});
