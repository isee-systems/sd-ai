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
        input_tokens: usage.input_tokens ?? 0,
        output_tokens: usage.output_tokens ?? 0,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      };
    } else if (isOpenAI) {
      tokens = {
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
        reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      };
    } else {
      tokens = {
        input_tokens: usage.promptTokenCount ?? 0,
        output_tokens: usage.candidatesTokenCount ?? 0,
        cached_tokens: usage.cachedContentTokenCount ?? 0,
        thoughts_tokens: usage.thoughtsTokenCount ?? 0,
      };
    }

    if (isAnthropic) {
      logger.log(`[usage:${provider}] input=${tokens.input_tokens} output=${tokens.output_tokens} cache_write=${tokens.cache_creation_input_tokens} cache_read=${tokens.cache_read_input_tokens}`);
    } else if (isOpenAI) {
      logger.log(`[usage:${provider}] input=${tokens.input_tokens} output=${tokens.output_tokens} cached=${tokens.cached_tokens} reasoning=${tokens.reasoning_tokens}`);
    } else {
      logger.log(`[usage:${provider}] input=${tokens.input_tokens} output=${tokens.output_tokens} cached=${tokens.cached_tokens} thoughts=${tokens.thoughts_tokens}`);
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
