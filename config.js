import { ThinkingLevel } from "@google/genai";


const config = {
    "port": process.env.PORT || 3000,
    "websocketPort": process.env.WEBSOCKET_PORT || 3000,

    /*
    * Reporting URLs
    */
    "metricsReporterURL": process.env.METRICS_REPORTER_URL || null, // Optional URL to POST engine usage metrics
    "tokenReporterURL": process.env.TOKEN_REPORTER_URL || null, // Optional URL to POST agent LLM token usage

    /*
    * Engine exposure
    */
    "includeTestEngines": false, // When true, engines whose directory starts with `test-` are returned by GET /v1/engines
    
    /*
    * Defaults for the engines that use LLMWrapper and the agent tools that use those engines
    */
    "buildDefaultModel": 'gemini-3.5-flash low', //LLMWrapper underlyingModel default for building model tools
    "nonBuildDefaultModel": 'gemini-3.5-flash low', //LLMWrapper underlyingModel default for non-building model tools
    
    /*
    * These settings control the operation of the agents
    */
    "agentSessionTempDir": process.env.AGENT_SESSION_TEMP_DIR || null, // Optional custom temp directory for session files (defaults to OS tmpdir/sd-agent)
    "agentMaxTokensForEngines": 32_000, // Maximum tokens before force switching to file-based editing
    "agentMaxContextTokens": 32_000, // Maximum tokens for conversation history sent to Claude API
    "agentTargetedEditingMinimum": 250, //Above this size, models can be edited without quantitative/qualitative engine
    "agentDefaultProvider": 'anthropic', // Default LLM provider when client does not specify one ('anthropic' | 'google' | 'openrouter')
    "agentAnthropicModel": 'claude-sonnet-4-6', // Model used for agent conversations MUST BE Anthropic models
    "agentAnthropicSummaryModel": 'claude-haiku-4-5', // Model used for conversation history summarization MUST BE Anthropic models
    "agentGeminiModel": 'gemini-3.5-flash', // Model used for agent conversations MUST BE gemini models
    "agentGeminiSummaryModel": 'gemini-3.1-flash-lite', // Model used for conversation history summarization MUST BE gemini models
    // Per-brand defaults for OpenRouter-routed providers. AgentOrchestrator picks the
    // entry matching `this.provider` (qwen/deepseek/moonshotai). All slugs MUST be
    // OpenRouter slugs (provider/model form).
    "agentQwenModel": 'qwen/qwen3.7-max',
    "agentQwenSummaryModel": 'qwen/qwen3.6-flash',
    "agentDeepseekModel": 'deepseek/deepseek-v4-pro',
    "agentDeepseekSummaryModel": 'deepseek/deepseek-v4-flash',
    "agentMoonshotaiModel": 'moonshotai/kimi-k2.6',
    "agentMoonshotaiSummaryModel": 'moonshotai/kimi-k2.6',
    "agentAnthropicEffort": "medium",
    "agentAnthropicThinking": { type: "adaptive" }, // Opus 4.7+/Sonnet 4.6 use adaptive thinking; depth is controlled by agentAnthropicEffort (budget_tokens is removed and 400s)
    "agentGeminiThinking": { thinkingLevel: ThinkingLevel.MEDIUM },
    "agentToolModels": {
        anthropic: {
            build:    { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' },
            nonBuild: { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' }
        },
        google: {
            build:    { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' },
            nonBuild: { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' }
        },
        qwen: {
            build:    { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' },
            nonBuild: { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' }
        },
        deepseek: {
            build:    { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' },
            nonBuild: { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' }
        },
        moonshotai: {
            build:    { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' },
            nonBuild: { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' }
        }
    }
};

export default config
