import { ThinkingLevel } from "@google/genai";


const config = {
    "port": process.env.PORT || 3000,
    "websocketPort": process.env.WEBSOCKET_PORT || 3000,
    // Maximum size (bytes) of a single WebSocket frame. Caps client uploads
    // (add_file content is sent inline). Without this the `ws` library defaults
    // to ~100 MiB silently; set it explicitly so the ceiling is tunable here.
    "websocketMaxPayloadBytes": Number(process.env.WEBSOCKET_MAX_PAYLOAD_BYTES) || 100 * 1024 * 1024,

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
    "agentAnthropicModel": 'claude-sonnet-5', // Model used for agent conversations MUST BE Anthropic models
    "agentAnthropicSummaryModel": 'claude-haiku-4-5', // Model used for conversation history summarization MUST BE Anthropic models
    "agentGeminiModel": 'gemini-3.5-flash', // Model used for agent conversations MUST BE gemini models
    "agentGeminiSummaryModel": 'gemini-3.1-flash-lite', // Model used for conversation history summarization MUST BE gemini models
    // OpenRouter-backed agent providers — the single source of truth for every
    // OpenRouter-routed brand. Add or remove an entry here and the whole agent stack
    // picks it up: the orchestrator's model/summary-model resolution, the context
    // summarizer, provider display names, the select_agent provider enum, and the
    // per-agent supported_providers defaults all derive from these keys. Keys are the
    // provider IDs clients send in `select_agent`; `displayName` is the UI label;
    // `model`/`summaryModel` MUST be OpenRouter slugs (provider/model form).
    "openRouterAgentProviders": {
        qwen: { 
            displayName: 'Qwen',     
            model: 'qwen/qwen3.7-max',         
            summaryModel: 'qwen/qwen3.6-flash' 
        },
        deepseek:   { 
            displayName: 'Deepseek', 
            model: 'deepseek/deepseek-v4-pro', 
            summaryModel: 'deepseek/deepseek-v4-flash' 
        },
        moonshotai: { 
            displayName: 'Kimi',     
            model: 'moonshotai/kimi-k3',     
            summaryModel: 'moonshotai/kimi-k3' 
        },
        zai: { 
            displayName: 'GLM',      
            model: 'z-ai/glm-5.2',             
            summaryModel: 'z-ai/glm-5.2' 
        }
    },
    // Underlying model the engine tools use, by provider. `default` is the fallback
    // for every provider (including the OpenRouter brands in openRouterAgentProviders),
    // so a newly added provider works with no extra config. To override the models for
    // a specific provider, add a key matching that provider id alongside `default`, e.g.:
    //   anthropic: {
    //       build:    { normal: 'claude-sonnet-4-6', hard: 'claude-opus-4-8' },
    //       nonBuild: { normal: 'claude-haiku-4-5', hard: 'claude-sonnet-4-6' }
    //   },
    "agentToolModels": {
        default: {
            build:    { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' },
            nonBuild: { normal: 'gemini-3.5-flash low', hard: 'gemini-3.5-flash high' }
        }
    },
    // Full ordered list of valid agent provider IDs: the two direct-API providers
    // plus every OpenRouter-backed brand above. A getter so it always tracks the
    // registry — adding/removing a brand above is the only edit needed. Drives the
    // select_agent provider enum and the per-agent supported_providers defaults.
    get agentProviders() {
        return ['anthropic', 'google', ...Object.keys(this.openRouterAgentProviders)];
    },
    "agentAnthropicEffort": "medium",
    "agentAnthropicThinking": { type: "adaptive" }, // Opus 4.7+/Sonnet 4.6 use adaptive thinking; depth is controlled by agentAnthropicEffort (budget_tokens is removed and 400s)
    "agentGeminiThinking": { thinkingLevel: ThinkingLevel.MEDIUM },
    /*
    * Retrieval-Augmented Generation (RAG). Clients attach files over the
    * WebSocket; the worker extracts text, reads small files in full and
    * chunks+embeds large ones for semantic search via the search_documents tool.
    * Embeddings use a Gemini model (decoupled from the chat provider) so
    * retrieval is identical across every agent route.
    */
    "ragMaxFileBytes": Number(process.env.RAG_MAX_FILE_BYTES) || 50 * 1024 * 1024, // Per-file upload cap (decoded bytes)
    "ragMaxFilesPerSession": Number(process.env.RAG_MAX_FILES_PER_SESSION) || 25, // Max attached files per session
    "ragEmbeddingModel": 'gemini-embedding-2', // Gemini embedding model (reuses GEMINI_API_KEY; no extra key needed)
    "ragEmbeddingDimensions": 768, // outputDimensionality for embeddings (smaller vectors → lighter storage)
    "ragManifestMaxTokens": 4000, // Files at/under this token count are read in full; larger files are chunked + embedded
    "ragChunkTokens": 600, // Target tokens per chunk for vector-tier files
    "ragChunkOverlap": 80, // Token overlap between adjacent chunks
    "ragSearchTopK": 8 // Default number of chunks returned by search_documents
    
};

export default config
