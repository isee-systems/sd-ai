/***
 * You must have a .env file which has the following keys
 * OPEN_API_KEY which is your open AI access token
 */

const config = {
    "port": 3000,
    "websocketPort": 3000,
    "reporterURL": process.env.REPORTER_URL || null, // Optional URL to POST engine usage metrics
    "sessionTempDir": process.env.SESSION_TEMP_DIR || null, // Optional custom temp directory for session files (defaults to OS tmpdir/sd-agent)
    "maxTokensForEngines": parseInt(process.env.MAX_TOKENS_FOR_ENGINES) || 100000, // Maximum tokens before switching to file-based editing
    "maxContextTokens": parseInt(process.env.MAX_CONTEXT_TOKENS) || 100000, // Maximum tokens for conversation history sent to Claude API
};

export default config