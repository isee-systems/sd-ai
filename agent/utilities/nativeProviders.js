import config from '../../config.js';
import logger from '../../utilities/logger.js';
import { Provider } from '../../utilities/TokenUsageReporter.js';

// 'anthropic' and 'google' are native-API providers with their own vendor SDKs and are
// dispatched by provider id wherever they appear. Every other entry in
// config.nativeAgentProviders is therefore a vendor whose own API is OpenAI-compatible:
// they share one client, one chat-completions loop and one summarizer, and differ only
// in the values this module derives from the provider id.
const VENDOR_SDK_PROVIDERS = ['anthropic', 'google'];

// The `select_agent` provider id for OpenAI's own API. Deliberately a literal rather
// than TokenUsageReporter's Provider.OPENAI: that enum is the usage-reporting namespace
// and this is the client-facing provider-id namespace. They agree on this string only by
// convention, and usageProviderFor below exists precisely because they do not always.
const OPENAI_PROVIDER_ID = 'openai';

export const OPENAI_COMPATIBLE_PROVIDERS = new Set(
  Object.keys(config.nativeAgentProviders).filter(id => !VENDOR_SDK_PROVIDERS.includes(id))
);

/**
 * The environment variable names this provider's credentials and host override live
 * under. Both follow a naming convention off the provider id, so registering another
 * OpenAI-compatible vendor in config.js needs no edit here — and WorkerSpawner derives
 * the sandbox's env allowlist from the same helper, so the key reaches the worker too.
 */
export function envVarNamesFor(provider) {
  const envPrefix = provider.toUpperCase();
  return { apiKey: `${envPrefix}_API_KEY`, baseURL: `${envPrefix}_BASE_URL` };
}

/**
 * Constructor options for the OpenAI SDK pointed at this provider's own API. Throws when
 * the key is missing.
 */
export function openAiCompatibleClientOptions(provider) {
  const envVars = envVarNamesFor(provider);
  const apiKey = process.env[envVars.apiKey];
  if (!apiKey) {
    throw new Error(`${provider} provider selected but ${envVars.apiKey} is not set`);
  }
  // The host comes from the provider's registry entry, never from a guess at the vendor's
  // domain — see the baseURL note on config.nativeAgentProviders for why. The env var
  // overrides it so a deployment can point one at a gateway, proxy or self-hosted
  // endpoint; null on both sides leaves the OpenAI SDK on its own default host.
  const baseURL = process.env[envVars.baseURL] || config.nativeAgentProviders[provider]?.baseURL;
  return { apiKey, ...(baseURL ? { baseURL } : {}) };
}

/**
 * The output-token cap under the parameter name this vendor accepts. OpenAI's own API
 * dropped `max_tokens` for the GPT-5 family and rejects the request unless the cap is
 * sent as `max_completion_tokens`; the other compatible vendors still take `max_tokens`.
 */
export function maxOutputTokensParam(provider, count) {
  return provider === OPENAI_PROVIDER_ID
    ? { max_completion_tokens: count }
    : { max_tokens: count };
}

/**
 * Reasoning params for a chat-completions request, where this vendor needs them.
 *
 * OpenAI's GPT-5.6 family refuses function tools on /v1/chat/completions while reasoning
 * is on: "Function tools with reasoning_effort are not supported ... To use function
 * tools, use /v1/responses or set reasoning_effort to 'none'". Every agent request this
 * loop makes carries tools, so reasoning is turned off explicitly — the alternative is
 * porting the route to the Responses API. Sent on the summarizer too, where it costs
 * nothing and saves reasoning tokens on a request that only condenses text.
 */
export function reasoningParams(provider) {
  return provider === OPENAI_PROVIDER_ID ? { reasoning_effort: 'none' } : {};
}

/**
 * The usage-reporter Provider to bill this provider's tokens under. The enum uses the
 * same ids as the registry for these vendors, so the id doubles as the reporting
 * provider — which matters because each one's usage payload is shaped differently
 * (DeepSeek reports cache hits top-level, OpenAI nests them under prompt_tokens_details)
 * and each has its own pricing table. An id the enum doesn't cover reports as OpenAI,
 * whose usage shape is the compatibility baseline and whose pricing table getPricing
 * already falls back to.
 *
 * That fallback is load-bearing — reporting under the raw id would hit the reporter's
 * "Unknown provider" throw, and every report() call site swallows rejections, so the
 * usage would silently never be reported at all. But it also means getPricing never sees
 * the unrecognized id and its own UNKNOWN PROVIDER alarm cannot fire, so the alarm is
 * raised here instead: without it a new vendor's tokens are parsed with OpenAI's usage
 * shape and billed at OpenAI's rates with nothing in the logs to say so.
 */
export function usageProviderFor(provider) {
  if (Object.values(Provider).includes(provider)) return provider;
  logger.error(`[usage] !!! NO TokenUsageReporter.Provider FOR "${provider}" !!! its tokens are being read with OpenAI's usage shape and billed at OpenAI's rates — ADD IT TO Provider AND pricing.js`);
  return Provider.OPENAI;
}
