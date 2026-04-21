/***
 * You must have a .env file which has the following keys
 * OPEN_API_KEY which is your open AI access token
 */

const config = {
    "port": 3000,
    "websocketPort": 3000,
    "reporterURL": process.env.REPORTER_URL || null, // Optional URL to POST engine usage metrics
    "sessionTempDir": process.env.SESSION_TEMP_DIR || null, // Optional custom temp directory for session files (defaults to OS tmpdir/sd-agent)
    "maxTokensForEngines": parseInt(process.env.MAX_TOKENS_FOR_ENGINES) || 8192, // Maximum tokens before switching to file-based editing
};

export default config