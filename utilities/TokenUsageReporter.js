import logger from './logger.js';
import { getPricing } from './pricing.js';

export const Provider = Object.freeze({
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GOOGLE: 'google',
});

export const ProviderDisplayNames = Object.freeze({
  [Provider.ANTHROPIC]: 'Claude',
  [Provider.GOOGLE]: 'Gemini',
  [Provider.OPENAI]: 'OpenAI',
});

class TokenUsageReporter {
  // Guards against reporting the same usage object twice (e.g. when a provider
  // reuses the same object across multiple events for one API call).
  #reported = new WeakSet();

  /**
   * @param {string|null} url - Optional URL to POST token usage to. If null, reporting is disabled.
   * @param {string|null} clientId - The clientId from the InitializeSessionMessage.
   */
  constructor(url = null, clientId = null) {
    this.url = url;
    this.clientId = clientId;
    this.enabled = url !== null && url !== undefined && url !== '' && clientId !== null && clientId !== undefined && clientId !== '';
  }

  /**
   * Reports token usage for an agent LLM call.
   * @param {Object} params
   * @param {string} params.provider - LLM provider: use Provider.ANTHROPIC | Provider.OPENAI | Provider.GOOGLE
   * @param {string} params.model - Specific model name, e.g. 'claude-sonnet-4-6' or 'gemini-3-flash-preview'
   * @param {Object} params.usage - Raw usage object from the LLM provider
   */
  async report({ provider, model, usage }) {
    if (!usage) return;
    const isDuplicate = this.#reported.has(usage);
    if (!isDuplicate) this.#reported.add(usage);

    const isAnthropic = provider === Provider.ANTHROPIC;
    const isOpenAI = provider === Provider.OPENAI;
    const isGemini = provider === Provider.GOOGLE;

    let tokens;
    if (isAnthropic) {
      tokens = {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheCreation5mInputTokens: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
        cacheCreation1hInputTokens: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      };
    } else if (isOpenAI) {
      tokens = {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      };
    } else if (isGemini) {
      tokens = {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        thoughtsTokens: usage.thoughtsTokenCount ?? 0,
      };
    } else {
      throw new Error('Unknown provider: "' + provider + '"');
    }

    const costs = this.#calculateCost(provider, model, tokens);
    const fmt = (n, cost) => cost != null ? `${n}($${cost.toFixed(6)})` : `${n}`;

    const dupTag = isDuplicate ? ' [duplicate?]' : '';
    const clientTag = this.clientId ? ` client=${this.clientId}` : '';
    if (isAnthropic) {
      logger.log(
        `[usage:${provider}]` +
        dupTag +
        clientTag +
        ` input=${fmt(tokens.inputTokens, costs?.inputTokens)}` +
        ` output=${fmt(tokens.outputTokens, costs?.outputTokens)}` +
        ` cache_write_5m=${fmt(tokens.cacheCreation5mInputTokens, costs?.cacheCreation5mInputTokens)}` +
        ` cache_write_1h=${fmt(tokens.cacheCreation1hInputTokens, costs?.cacheCreation1hInputTokens)}` +
        ` cache_read=${fmt(tokens.cacheReadInputTokens, costs?.cacheReadInputTokens)}` +
        (costs ? ` total=$${costs.total.toFixed(6)}` : '')
      );
    } else if (isOpenAI) {
      logger.log(
        `[usage:${provider}]` +
        dupTag +
        clientTag +
        ` input=${fmt(tokens.inputTokens, costs?.inputTokens)}` +
        ` output=${fmt(tokens.outputTokens, costs?.outputTokens)}` +
        ` cached=${fmt(tokens.cachedTokens, costs?.cachedTokens)}` +
        ` reasoning=${tokens.reasoningTokens}` +
        (costs ? ` total=$${costs.total.toFixed(6)}` : '')
      );
    } else {
      logger.log(
        `[usage:${provider}]` +
        dupTag +
        clientTag +
        ` input=${fmt(tokens.inputTokens, costs?.inputTokens)}` +
        ` output=${fmt(tokens.outputTokens, costs?.outputTokens)}` +
        ` cached=${fmt(tokens.cachedTokens, costs?.cachedTokens)}` +
        ` thoughts=${fmt(tokens.thoughtsTokens, costs?.thoughtsTokens)}` +
        (costs ? ` total=$${costs.total.toFixed(6)}` : '')
      );
    }

    if (!this.enabled) return;

    const reportData = {
      clientId: this.clientId,
      provider,
      model,
      tokens,
      cost: costs?.total ?? null,
      timestamp: new Date().toISOString(),
      ...(isDuplicate && { potentialDuplicate: true }),
    };

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      });

      if (!response.ok) {
        console.error(`TokenUsageReporter: Failed to POST to ${this.url}. Status: ${response.status}`);
      }
    } catch (error) {
      console.error(`TokenUsageReporter: Error posting to ${this.url}:`, error.message);
    }
  }

  /**
   * @param {string} provider - use Provider enum
   * @param {string} model
   * @param {Object} tokens
   * @returns {{ total: number, [key: string]: number }|null}
   */
  #calculateCost(provider, model, tokens) {
    const pricing = getPricing(provider, model, tokens.inputTokens);
    if (!pricing) return null;

    const per = (count, rate) => (count / 1_000_000) * rate;

    if (provider === Provider.ANTHROPIC) {
      const inputTokens = per(tokens.inputTokens, pricing.inputTokens);
      const outputTokens = per(tokens.outputTokens, pricing.outputTokens);
      const cacheCreation5mInputTokens = per(tokens.cacheCreation5mInputTokens, pricing.cacheCreation5mInputTokens);
      const cacheCreation1hInputTokens = per(tokens.cacheCreation1hInputTokens, pricing.cacheCreation1hInputTokens);
      const cacheReadInputTokens = per(tokens.cacheReadInputTokens, pricing.cacheReadInputTokens);
      return {
        inputTokens,
        outputTokens,
        cacheCreation5mInputTokens,
        cacheCreation1hInputTokens,
        cacheReadInputTokens,
        total: inputTokens + outputTokens + cacheCreation5mInputTokens + cacheCreation1hInputTokens + cacheReadInputTokens,
      };
    }

    if (provider === Provider.GOOGLE) {
      // cachedTokens are a subset of inputTokens; bill non-cached at full rate, cached at reduced rate
      // thoughtsTokens are separate from outputTokens and billed at the output rate
      const nonCached = tokens.inputTokens - tokens.cachedTokens;
      const inputTokens = per(nonCached, pricing.inputTokens);
      const cachedTokens = per(tokens.cachedTokens, pricing.cachedTokens);
      const outputTokens = per(tokens.outputTokens, pricing.outputTokens);
      const thoughtsTokens = per(tokens.thoughtsTokens, pricing.outputTokens);
      return {
        inputTokens,
        cachedTokens,
        outputTokens,
        thoughtsTokens,
        total: inputTokens + cachedTokens + outputTokens + thoughtsTokens,
      };
    }

    // openai (and unknown providers, which fall back to openai pricing)
    // cachedTokens are a subset of inputTokens; bill non-cached at full rate, cached at reduced rate
    // reasoningTokens are already included in outputTokens (completion_tokens), so not billed separately
    const nonCached = tokens.inputTokens - tokens.cachedTokens;
    const inputTokens = per(nonCached, pricing.inputTokens);
    const cachedTokens = per(tokens.cachedTokens, pricing.cachedTokens);
    const outputTokens = per(tokens.outputTokens, pricing.outputTokens);
    return {
      inputTokens,
      cachedTokens,
      outputTokens,
      total: inputTokens + cachedTokens + outputTokens,
    };
  }
}

export default TokenUsageReporter;
