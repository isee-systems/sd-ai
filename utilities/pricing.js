import logger from './logger.js';

// LLM pricing — USD per 1 million tokens
// Each provider section has a 'default' fallback for unknown models.
// Models with tiered pricing use an array of tiers; the first matching tier wins.
// A tier matches when inputTokens <= maxInputTokens, or when maxInputTokens is absent (catch-all).

// ─── Anthropic ───────────────────────────────────────────────────────────────
// Source: https://platform.claude.com/docs/en/about-claude/pricing
export const anthropic = {
  'claude-opus-4-7': {
    inputTokens: 5.00,
    cacheCreation5mInputTokens: 6.25,
    cacheCreation1hInputTokens: 10.00,
    cacheReadInputTokens: 0.50,
    outputTokens: 25.00,
  },
  'claude-opus-4-6': {
    inputTokens: 5.00,
    cacheCreation5mInputTokens: 6.25,
    cacheCreation1hInputTokens: 10.00,
    cacheReadInputTokens: 0.50,
    outputTokens: 25.00,
  },
  'claude-sonnet-4-6': {
    inputTokens: 3.00,
    cacheCreation5mInputTokens: 3.75,
    cacheCreation1hInputTokens: 6.00,
    cacheReadInputTokens: 0.30,
    outputTokens: 15.00,
  },
  'claude-sonnet-4-5': {
    inputTokens: 3.00,
    cacheCreation5mInputTokens: 3.75,
    cacheCreation1hInputTokens: 6.00,
    cacheReadInputTokens: 0.30,
    outputTokens: 15.00,
  },
  'claude-haiku-4-5': {
    inputTokens: 1.00,
    cacheCreation5mInputTokens: 1.25,
    cacheCreation1hInputTokens: 2.00,
    cacheReadInputTokens: 0.10,
    outputTokens: 5.00,
  },
  default: {
    inputTokens: 5.00,
    cacheCreation5mInputTokens: 6.25,
    cacheCreation1hInputTokens: 10.00,
    cacheReadInputTokens: 0.50,
    outputTokens: 25.00,
  },
};

// ─── Gemini ──────────────────────────────────────────────────────────────────
// Source: https://ai.google.dev/gemini-api/docs/pricing
// Thinking/reasoning tokens are billed at the output token rate.
// cachedTokens are a subset of inputTokens and billed at the cached rate instead.
export const gemini = {
  'gemini-3.1-pro-preview': [
    { maxInputTokens: 200000, inputTokens: 2.00, cachedTokens: 0.20, outputTokens: 12.00 },
    {                         inputTokens: 4.00, cachedTokens: 0.40, outputTokens: 18.00 },
  ],
  'gemini-2.5-pro': [
    { maxInputTokens: 200000, inputTokens: 1.25, cachedTokens: 0.13, outputTokens: 10.00 },
    {                         inputTokens: 2.50, cachedTokens: 0.25, outputTokens: 15.00 },
  ],
  'gemini-2.5-flash': {
    inputTokens: 0.30,
    cachedTokens: 0.03,
    outputTokens: 2.50,
  },
  'gemini-3-flash-preview': {
    inputTokens: 0.50,
    cachedTokens: 0.05,
    outputTokens: 3.00,
  },
  default: {
    inputTokens: 4.00,
    cachedTokens: 0.40,
    outputTokens: 18.00,
  },
};

// ─── OpenAI ──────────────────────────────────────────────────────────────────
// Source: https://developers.openai.com/api/docs/pricing
// Reasoning tokens are billed at the output token rate and are already included
// in completion_tokens, so they must not be double-counted.
// cachedTokens are a subset of inputTokens and billed at the cached rate instead.
// Aliases resolve before the pricing lookup.
export const openaiAliases = {
  'gpt-5': 'gpt-5.5',       // same as newest gpt-5.X model
  'gpt-5-mini': 'gpt-5.4-mini', // same as newest gpt-5.X mini model
};

export const openai = {
  'gpt-5.5': [
    { maxInputTokens: 272000, inputTokens: 5.00, cachedTokens: 0.50, outputTokens: 30.00 },
    {                         inputTokens: 10.00, cachedTokens: 1.00, outputTokens: 45.00 },
  ],
  'gpt-5.4-mini': {
    inputTokens: 0.75,
    cachedTokens: 0.08,
    outputTokens: 4.50,
  },
  default: {
    inputTokens: 10.00,
    cachedTokens: 1.00,
    outputTokens: 45.00,
  },
};

// ─── Lookup helper ───────────────────────────────────────────────────────────

/**
 * Returns the pricing tier for a given provider/model/inputTokenCount.
 * Unknown providers fall back to the OpenAI pricing table.
 * Unknown models fall back to the provider's "default" entry.
 * @param {string} provider - 'anthropic' | 'openai' | 'gemini' (others fall back to openai)
 * @param {string} model
 * @param {number} inputTokens - used to select the correct tier for tiered models
 * @returns {Object|null} pricing object with per-token-type rates
 */
export function getPricing(provider, model, inputTokens = 0) {
  let table, aliases;
  if (provider === 'anthropic') {
    table = anthropic; aliases = {};
  } else if (provider === 'openai') {
    table = openai; aliases = openaiAliases;
  } else if (provider === 'gemini') {
    table = gemini; aliases = {};
  } else {
    logger.error(`[pricing] unknown provider "${provider}" — falling back to openai pricing`);
    table = openai; aliases = openaiAliases;
  }

  const resolvedModel = aliases[model] ?? model;
  let entry = table[resolvedModel];
  if (!entry) {
    logger.error(`[pricing] unknown model "${model}" for provider "${provider}" — falling back to default rates`);
    entry = table['default'];
  }
  if (!entry) return null;

  if (Array.isArray(entry)) {
    for (const tier of entry) {
      if (tier.maxInputTokens === undefined || inputTokens <= tier.maxInputTokens) {
        return tier;
      }
    }
    return entry[entry.length - 1];
  }

  return entry;
}
