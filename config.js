import { ThinkingLevel } from "@google/genai";


const config = {
    "port": 3000,
    "reporterURL": process.env.REPORTER_URL || null, // Optional URL to POST engine usage metrics
    "agentTokenReporterURL": process.env.AGENT_TOKEN_REPORTER_URL || null, // Optional URL to POST agent LLM token usage
    "websocketPort": 3000,
    "sessionTempDir": process.env.SESSION_TEMP_DIR || null, // Optional custom temp directory for session files (defaults to OS tmpdir/sd-agent)
    "agentMaxTokensForEngines": 50_000, // Maximum tokens before switching to file-based editing
    "agentMaxContextTokens": 32_000, // Maximum tokens for conversation history sent to Claude API
    "agentTargetedEditingMinimum": 5_000, //Above this size, models can be edited without quantitative/qualitative engine
    "agentAnthropicModel": 'claude-sonnet-4-6', // Model used for agent conversations MUST BE Anthropic models
    "agentAnthropicSummaryModel": 'claude-haiku-4-5', // Model used for conversation history summarization MUST BE Anthropic models
    "agentGeminiModel": 'gemini-3-flash-preview', // Model used for agent conversations MUST BE gemini models
    "agentGeminiSummaryModel": 'gemini-3.1-flash-preview', // Model used for conversation history summarization MUST BE gemini models
    "agentAnthropicEffort": "low",
    "agentAnthropicThinking": { type: "disabled" },
    "agentGeminiThinking": { thinkingLevel: ThinkingLevel.LOW }
};

export default config
