import logger from './logger.js';

class TokenUsageReporter {
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
   * @param {string} params.provider - LLM provider: 'anthropic' | 'openai' | 'gemini'
   * @param {string} params.model - Specific model name, e.g. 'claude-sonnet-4-6' or 'gemini-3-flash-preview'
   * @param {Object} params.usage - Raw usage object from the LLM provider
   */
  async report({ provider, model, usage }) {
    if (!usage) return;

    const isAnthropic = provider === 'anthropic';
    const isOpenAI = provider === 'openai';

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
    } else {
      tokens = {
        inputTokens: usage.promptTokenCount ?? 0,
        outputTokens: usage.candidatesTokenCount ?? 0,
        cachedTokens: usage.cachedContentTokenCount ?? 0,
        thoughtsTokens: usage.thoughtsTokenCount ?? 0,
      };
    }

    if (isAnthropic) {
      logger.log(`[usage:${provider}] input=${tokens.inputTokens} output=${tokens.outputTokens} cache_write=${tokens.cacheCreationInputTokens} cache_write_5m=${tokens.cacheCreation5mInputTokens} cache_write_1h=${tokens.cacheCreation1hInputTokens} cache_read=${tokens.cacheReadInputTokens}`);
    } else if (isOpenAI) {
      logger.log(`[usage:${provider}] input=${tokens.inputTokens} output=${tokens.outputTokens} cached=${tokens.cachedTokens} reasoning=${tokens.reasoningTokens}`);
    } else {
      logger.log(`[usage:${provider}] input=${tokens.inputTokens} output=${tokens.outputTokens} cached=${tokens.cachedTokens} thoughts=${tokens.thoughtsTokens}`);
    }

    if (!this.enabled) return;

    const reportData = {
      clientId: this.clientId,
      provider,
      model,
      tokens,
      timestamp: new Date().toISOString(),
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
}

export default TokenUsageReporter;
