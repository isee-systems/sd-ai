/***
 * You must have a .env file which has the following keys
 * OPEN_API_KEY which is your open AI access token
 */

const config = {
    "port": 3000,
    "reporterURL": process.env.REPORTER_URL || null, // Optional URL to POST engine usage metrics
    "websocketPort": 3000,
    "sessionTempDir": process.env.SESSION_TEMP_DIR || null, // Optional custom temp directory for session files (defaults to OS tmpdir/sd-agent)
    "agentMaxTokensForEngines": parseInt(process.env.MAX_TOKENS_FOR_ENGINES) || 50_000, // Maximum tokens before switching to file-based editing
    "agentMaxContextTokens": parseInt(process.env.MAX_CONTEXT_TOKENS) || 50_000, // Maximum tokens for conversation history sent to Claude API
    "agentTargetedEditingMinimum": parseInt(process.env.TARGETED_EDITING_MINIMUM) || 5_000, //Above this size, models can be edited without quantitative/qualitative engine
    "agentModel": process.env.AGENT_MODEL || 'claude-sonnet-4-6', // Model used for agent conversations MUST BE Anthropic models
    "agentSummaryModel": process.env.SUMMARY_MODEL || 'claude-haiku-4-5', // Model used for conversation history summarization MUST BE Anthropic models
};

export default config
