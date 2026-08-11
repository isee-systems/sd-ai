import config from '../../config.js';

/**
 * Registry entries for the OpenAI-compatible native providers the agent suites exercise.
 *
 * Which of them config.js actually ships is a deployment decision — entries are commented
 * in and out as the deployed configuration changes — but the code keyed off them is always
 * in the tree: the `openai`-only request shape (max_completion_tokens, reasoning_effort),
 * the max_tokens shape every other vendor takes, the per-provider client keying, and the
 * summarizer route. Reading the deployed registry made those suites vanish (or fail) the
 * moment a provider was commented out, so the tests own these entries instead.
 *
 * The ids are the real ones on purpose: the source branches on the literal 'openai' id and
 * TokenUsageReporter.Provider bills by id, so a made-up id would exercise neither branch.
 * Only the models and the host are fixtures — no test may reach either.
 */
export const TEST_NATIVE_PROVIDERS = Object.freeze({
  openai: Object.freeze({
    displayName: 'ChatGPT (test)',
    model: 'test-openai-model',
    summaryModel: 'test-openai-summary-model',
    // null is the "use the OpenAI SDK's own default host" case, which must leave baseURL unset.
    baseURL: null
  }),
  deepseek: Object.freeze({
    displayName: 'DeepSeek (test)',
    model: 'test-deepseek-model',
    summaryModel: 'test-deepseek-summary-model',
    baseURL: 'https://api.test-deepseek.invalid'
  })
});

/**
 * Merges the fixture entries into the native-provider registry, overriding any same-id
 * entry the deployed config happens to carry and leaving the vendor-SDK providers alone.
 *
 * Must run before the module under test is imported: OPENAI_COMPATIBLE_PROVIDERS is
 * derived from these keys once, when nativeProviders.js is evaluated. That is why the
 * suites calling this import the modules under test dynamically, after it returns. Jest
 * gives each test file its own module registry, so the mutation cannot leak between suites.
 *
 * The intelligence ladders for the same ids are dropped at the same time, and that is
 * load-bearing rather than tidiness: a ladder outranks nativeAgentProviders when the
 * orchestrator resolves a model, so leaving one in place would send these suites at a
 * real vendor model id and quietly void the "no test may reach either" guarantee above.
 * Removing it also means these providers exercise the no-ladder fallback path, which is
 * the behaviour every OpenRouter brand relies on.
 */
export function installTestNativeProviders() {
  config.nativeAgentProviders = { ...config.nativeAgentProviders, ...TEST_NATIVE_PROVIDERS };

  const ladders = { ...config.agentIntelligence?.providers };
  for (const id of Object.keys(TEST_NATIVE_PROVIDERS)) delete ladders[id];
  config.agentIntelligence = { ...config.agentIntelligence, providers: ladders };
}
