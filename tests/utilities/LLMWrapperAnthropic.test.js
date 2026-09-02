import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// The Anthropic SDK is replaced wholesale so these tests can drive the exact
// response shapes the real API returns on a refusal — an HTTP 200 whose content is
// either empty or a partial answer — without spending a call to provoke one.
let finalMessage = null;
let modelInfo = null;
const streamSpy = jest.fn();
const retrieveSpy = jest.fn();

jest.unstable_mockModule('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor() {
      this.models = {
        retrieve: (...args) => {
          retrieveSpy(...args);
          return Promise.resolve(modelInfo);
        }
      };
      this.beta = {
        messages: {
          stream: (params) => {
            streamSpy(params);
            return { finalMessage: async () => finalMessage };
          }
        }
      };
    }
  }
}));

let LLMWrapper;
let TokenUsageReporter;

beforeAll(async () => {
  process.env.ANTHROPIC_API_KEY = 'dummy';
  ({ LLMWrapper } = await import('../../utilities/LLMWrapper.js'));
  ({ default: TokenUsageReporter } = await import('../../utilities/TokenUsageReporter.js'));
});

beforeEach(() => {
  streamSpy.mockClear();
  retrieveSpy.mockClear();
  modelInfo = { max_tokens: 64000, allowed_fallback_models: [] };
});

const messages = [{ role: 'user', content: 'model this' }];

const completeWith = (model, usage) => ({
  model,
  content: [{ type: 'text', text: '{"variables":[]}' }],
  stop_reason: 'end_turn',
  usage: usage ?? { input_tokens: 10, output_tokens: 5 }
});

describe('the Anthropic path on a refusal', () => {
  test('reports a decline that happened before any output as a refusal', async () => {
    // Thinking ran, then the classifier fired: there is no text block at all. The
    // old code returned {content: null} and the caller blamed the response format.
    finalMessage = {
      model: 'claude-sonnet-5',
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'bio' },
      usage: { input_tokens: 6518, output_tokens: 891 }
    };

    const wrapper = new LLMWrapper({ underlyingModel: 'claude-sonnet-5' });
    const response = await wrapper.createChatCompletion(messages, 'claude-sonnet-5');

    expect(response.refusal).toMatch(/declined the request/);
    expect(response.refusal).toMatch(/bio/);
    expect(response.content).toBeUndefined();
  });

  test('reports a decline part-way through the answer as a refusal, not as its truncated partial', async () => {
    // The same classifier firing after generation started leaves a text block
    // holding JSON cut off mid-object. Handing that to the caller produced a
    // "Bad JSON returned by underlying LLM" that pointed at the wrong thing.
    finalMessage = {
      model: 'claude-sonnet-5',
      content: [
        { type: 'thinking', thinking: '', signature: 'sig' },
        { type: 'text', text: '{"variables":[{"name":"stock_a","type":"stock"' }
      ],
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'bio' },
      usage: { input_tokens: 6515, output_tokens: 6426 }
    };

    const wrapper = new LLMWrapper({ underlyingModel: 'claude-sonnet-5' });
    const response = await wrapper.createChatCompletion(messages, 'claude-sonnet-5');

    expect(response.refusal).toMatch(/declined the request/);
    expect(response.content).toBeUndefined();
  });

  test('still names the refusal when the API sends no category', async () => {
    // stop_details is informational and may be absent or null even on a refusal,
    // so the branch has to key on stop_reason alone.
    finalMessage = {
      model: 'claude-sonnet-5',
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 10, output_tokens: 0 }
    };

    const wrapper = new LLMWrapper({ underlyingModel: 'claude-sonnet-5' });
    const response = await wrapper.createChatCompletion(messages, 'claude-sonnet-5');

    expect(response.refusal).toMatch(/declined the request/);
  });
});

describe('asking for refusal fallbacks', () => {
  test('is skipped on a model that publishes no fallback list', async () => {
    // Sonnet 5 answers with an empty allowed_fallback_models and 400s if sent the
    // parameter anyway, so the empty list is what has to gate the request.
    modelInfo = { max_tokens: 64000, allowed_fallback_models: [] };
    finalMessage = completeWith('claude-sonnet-5');

    const wrapper = new LLMWrapper({ underlyingModel: 'claude-sonnet-5' });
    await wrapper.createChatCompletion(messages, 'claude-sonnet-5');

    const params = streamSpy.mock.calls[0][0];
    expect(params.fallbacks).toBeUndefined();
    expect(params.betas).toBeUndefined();
    expect(params.max_tokens).toBe(64000);
  });

  test('happens on a model that names its substitutes', async () => {
    modelInfo = { max_tokens: 128000, allowed_fallback_models: ['claude-opus-4-8'] };
    finalMessage = completeWith('claude-opus-5');

    const wrapper = new LLMWrapper({ underlyingModel: 'claude-opus-5' });
    await wrapper.createChatCompletion(messages, 'claude-opus-5');

    const params = streamSpy.mock.calls[0][0];
    expect(params.fallbacks).toBe('default');
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
  });

  test('reads the fallback list under the beta header that publishes it', async () => {
    modelInfo = { max_tokens: 128000, allowed_fallback_models: ['claude-opus-4-8'] };
    finalMessage = completeWith('claude-opus-5');

    const wrapper = new LLMWrapper({ underlyingModel: 'claude-opus-5' });
    await wrapper.createChatCompletion(messages, 'claude-opus-5');

    expect(retrieveSpy).toHaveBeenCalledWith('claude-opus-5', {
      headers: { 'anthropic-beta': 'server-side-fallback-2026-06-01' }
    });
  });
});

describe('usage attribution', () => {
  test('bills the model that answered, which a fallback makes different from the one asked for', async () => {
    modelInfo = { max_tokens: 128000, allowed_fallback_models: ['claude-opus-4-8'] };
    finalMessage = completeWith('claude-opus-4-8', { input_tokens: 100, output_tokens: 50 });

    const report = jest.spyOn(TokenUsageReporter.prototype, 'report').mockResolvedValue(undefined);
    try {
      const wrapper = new LLMWrapper({ underlyingModel: 'claude-opus-5' });
      await wrapper.createChatCompletion(messages, 'claude-opus-5');

      expect(report).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-opus-4-8' }));
    } finally {
      report.mockRestore();
    }
  });
});
