import { Provider } from '../../utilities/TokenUsageReporter.js';
import config from '../../config.js';
import { TEST_NATIVE_PROVIDERS, installTestNativeProviders } from './nativeProviderFixture.js';

// Every per-vendor difference between the OpenAI-compatible native providers is derived
// here from the provider id, so these are the assertions that catch a new registry entry
// silently inheriting another vendor's key, host or request shape.
//
// The fixture entries stand in for whichever vendors the deployed config enables: the
// derivation is what is under test, and it must stay covered whether or not a given
// provider is currently switched on in config.js. OPENAI_COMPATIBLE_PROVIDERS is built at
// module evaluation, so the module comes in dynamically after the fixtures are installed.
installTestNativeProviders();

const {
  OPENAI_COMPATIBLE_PROVIDERS,
  openAiCompatibleClientOptions,
  maxOutputTokensParam,
  reasoningParams,
  usageProviderFor
} = await import('../../agent/utilities/nativeProviders.js');

describe('OPENAI_COMPATIBLE_PROVIDERS', () => {
  it('is every native provider except the two with their own vendor SDKs', () => {
    const expected = Object.keys(config.nativeAgentProviders)
      .filter(id => id !== 'anthropic' && id !== 'google');
    expect([...OPENAI_COMPATIBLE_PROVIDERS].sort()).toEqual(expected.sort());
  });

  it('covers every OpenAI-compatible entry in the registry', () => {
    for (const id of Object.keys(TEST_NATIVE_PROVIDERS)) {
      expect(OPENAI_COMPATIBLE_PROVIDERS.has(id)).toBe(true);
    }
  });

  it('excludes anthropic and google, which are dispatched by id', () => {
    expect(OPENAI_COMPATIBLE_PROVIDERS.has('anthropic')).toBe(false);
    expect(OPENAI_COMPATIBLE_PROVIDERS.has('google')).toBe(false);
  });
});

describe('openAiCompatibleClientOptions', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('reads the key from <PROVIDER>_API_KEY', () => {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    expect(openAiCompatibleClientOptions('deepseek').apiKey).toBe('ds-key');
  });

  it('leaves the host unset when the registry entry has none, so the SDK uses its own default', () => {
    process.env.OPENAI_API_KEY = 'oa-key';
    expect(TEST_NATIVE_PROVIDERS.openai.baseURL).toBeNull();
    expect(openAiCompatibleClientOptions('openai')).toEqual({ apiKey: 'oa-key' });
  });

  it('takes the host from the registry entry rather than guessing at the vendor domain', () => {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    expect(openAiCompatibleClientOptions('deepseek').baseURL)
      .toBe(TEST_NATIVE_PROVIDERS.deepseek.baseURL);
  });

  it('honours a <PROVIDER>_BASE_URL override', () => {
    process.env.DEEPSEEK_API_KEY = 'ds-key';
    process.env.DEEPSEEK_BASE_URL = 'https://gateway.internal/v1';
    expect(openAiCompatibleClientOptions('deepseek').baseURL).toBe('https://gateway.internal/v1');

    process.env.OPENAI_API_KEY = 'oa-key';
    process.env.OPENAI_BASE_URL = 'https://proxy.internal/v1';
    expect(openAiCompatibleClientOptions('openai').baseURL).toBe('https://proxy.internal/v1');
  });

  it('names the missing environment variable when the key is absent', () => {
    expect(() => openAiCompatibleClientOptions('openai')).toThrow('OPENAI_API_KEY');
  });
});

describe('maxOutputTokensParam', () => {
  // OpenAI's API rejects max_tokens for the GPT-5 family.
  it('uses max_completion_tokens for openai', () => {
    expect(maxOutputTokensParam('openai', 1024)).toEqual({ max_completion_tokens: 1024 });
  });

  it('uses max_tokens for the other vendors', () => {
    expect(maxOutputTokensParam('deepseek', 1024)).toEqual({ max_tokens: 1024 });
  });
});

describe('reasoningParams', () => {
  // GPT-5.6 refuses function tools on /v1/chat/completions unless reasoning is off, and
  // every request the agent loop makes carries tools.
  it('turns reasoning off for openai', () => {
    expect(reasoningParams('openai')).toEqual({ reasoning_effort: 'none' });
  });

  it('sends nothing for the other vendors', () => {
    expect(reasoningParams('deepseek')).toEqual({});
  });
});

describe('usageProviderFor', () => {
  it('bills each vendor under its own provider, since usage shapes and pricing differ', () => {
    expect(usageProviderFor('openai')).toBe(Provider.OPENAI);
    expect(usageProviderFor('deepseek')).toBe(Provider.DEEPSEEK);
  });

  it('falls back to openai for an id the usage reporter does not know', () => {
    // Reporting under the raw id would throw inside the reporter and be swallowed, so
    // the usage would never be reported at all; the fallback keeps it flowing and the
    // helper raises the alarm that getPricing can no longer raise for itself.
    expect(usageProviderFor('some-new-vendor')).toBe(Provider.OPENAI);
  });
});
