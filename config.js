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
    "buildDefaultModel": 'gemini-3.6-flash', //LLMWrapper underlyingModel default for building model tools
    "nonBuildDefaultModel": 'gemini-3.6-flash', //LLMWrapper underlyingModel default for non-building model tools
    "evalModel": "gemini-3.6-flash", //LLMWrapper underlyingModel default used for judging LLM repsonses during eval runs

    /*
    * Every model the engines expose in the `underlyingModel` combobox, in display
    * order. `label` is the UI text, `value` is the id LLMWrapper routes on — and that
    * routing is by shape, not by an explicit provider field (see ModelCapabilities.kind):
    * a namespaced `<provider>/<model>` slug goes to OpenRouter, while a bare id is
    * matched by substring to its vendor's own API. So 'deepseek/deepseek-v4-pro' and
    * 'deepseek-v4-pro' are the same model reached two different ways, and both are
    * listed deliberately.
    */
    "models": [
        {label: "GPT-5.6 Sol", value: 'gpt-5.6-sol'},
        {label: "GPT-5.6 Terra", value: 'gpt-5.6-terra'},
        {label: "GPT-5.6 Luna", value: 'gpt-5.6-luna'},
        {label: "Gemini 3.1-pro-preview", value: 'gemini-3.1-pro-preview'},
        {label: "Gemini 3.6-flash", value: 'gemini-3.6-flash'},
        {label: "Gemini 3.6-flash high", value: 'gemini-3.6-flash high'},
        {label: "Gemini 3.6-flash medium", value: 'gemini-3.6-flash medium'},
        {label: "Gemini 3.6-flash low", value: 'gemini-3.6-flash low'},
        {label: "Gemini 3.5-flash", value: 'gemini-3.5-flash'},
        {label: "Claude Fable 5", value: 'claude-fable-5'},
        {label: "Claude Opus 5", value: 'claude-opus-5'},
        {label: "Claude Sonnet 5", value: 'claude-sonnet-5'},
        {label: "Claude Haiku 4.5", value: 'claude-haiku-4-5'},
        {label: "Qwen3.7 Max", value: 'qwen/qwen3.7-max'},
        {label: "Qwen3.7 Plus", value: 'qwen/qwen3.7-plus'},
        {label: "Deepseek v4 Pro", value: 'deepseek/deepseek-v4-pro'},
        {label: "Deepseek v4 Flash", value: 'deepseek/deepseek-v4-flash'},
        // Native DeepSeek API models (routed directly to DEEPSEEK_API_KEY, not OpenRouter)
        /*{label: "Deepseek v4 Pro (API)", value: 'deepseek-v4-pro'},
        {label: "Deepseek v4 Flash (API)", value: 'deepseek-v4-flash'},*/
        {label: "Kimi K3", value: 'moonshotai/kimi-k3'},
        {label: "GLM 5.2", value: 'z-ai/glm-5.2'},
    ],

    /*
    * These settings control the operation of the agents
    */
    "agentSessionTempDir": process.env.AGENT_SESSION_TEMP_DIR || null, // Optional custom temp directory for session files (defaults to OS tmpdir/sd-agent)
    "agentMaxTokensForEngines": 32_000, // Maximum tokens before force switching to file-based editing
    "agentMaxContextTokens": 32_000, // Maximum tokens for conversation history sent to Claude API
    "agentTargetedEditingMinimum": 250, //Above this size, models can be edited without quantitative/qualitative engine
    "agentDefaultProvider": 'anthropic', // Default LLM provider when client does not specify one — any id in agentProviders below

    /*
    * Native-API agent providers — the single source of truth for every provider
    * that reaches its vendor's API directly rather than via OpenRouter. Same
    * derivation contract as openRouterAgentProviders: keys are the provider IDs
    * clients send in `select_agent`, `displayName` is the UI label, and
    * `model`/`summaryModel` are the vendor's own model ids (`model` for agent
    * conversations, `summaryModel` for conversation-history summarization).
    *
    * 'anthropic' and 'google' each drive their own vendor SDK and are dispatched by
    * provider id; every other entry here is assumed to speak the OpenAI-compatible
    * chat-completions API and shares one manual loop — so adding another such vendor
    * needs no new code path. Those entries also carry `baseURL`, the host their
    * compatible endpoint lives at: vendors do not follow one naming convention
    * (api.deepseek.com, but api.moonshot.cn / api.z.ai / api.x.ai), and several want
    * an explicit /v1 suffix, so the host is stated here rather than guessed from the
    * provider id — a wrong guess would surface as a DNS failure or 404 on first use
    * instead of a clear config error. null means "the OpenAI SDK's own default host".
    * <PROVIDER>_BASE_URL in the environment overrides whatever is set here, which is
    * what lets a deployment point one at a gateway, proxy or self-hosted endpoint.
    */
    "nativeAgentProviders": {
        anthropic: {
            displayName: 'Claude',
            model: 'claude-sonnet-5',
            summaryModel: 'claude-haiku-4-5'
        },
        google: {
            displayName: 'Gemini',
            model: 'gemini-3.6-flash',
            summaryModel: 'gemini-3.5-flash-lite'
        }/*,
        openai: {
            displayName: 'ChatGPT',
            model: 'gpt-5.6-terra',
            summaryModel: 'gpt-5.6-luna',
            baseURL: null
        },
        deepseek: {
            displayName: 'DeepSeek',
            model: 'deepseek-v4-pro',
            summaryModel: 'deepseek-v4-flash',
            baseURL: 'https://api.deepseek.com'
        }
        */
    },
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
            summaryModel: 'qwen/qwen3.7-plus'
        },
        deepseek: {
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
            build:    { normal: 'gemini-3.6-flash low', hard: 'gemini-3.6-flash high' },
            nonBuild: { normal: 'gemini-3.6-flash low', hard: 'gemini-3.6-flash high' }
        }
    },
    // Full ordered list of valid agent provider IDs: every native-API brand plus every
    // OpenRouter-backed brand above. A getter so it always tracks the registries —
    // adding/removing a brand above is the only edit needed. Drives the select_agent
    // provider enum and the per-agent supported_providers defaults.
    get agentProviders() {
        return [...Object.keys(this.nativeAgentProviders), ...Object.keys(this.openRouterAgentProviders)];
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
    "ragSearchTopK": 8, // Default number of chunks returned by search_documents
    /*
    * Binary media (images) exchanged with client tools and produced by generate_image.
    * Bytes live under <sessionTempDir>/media/<mediaId>/; the model, the IPC channel and
    * conversation history all carry only the opaque handle, never base64.
    *
    * mediaAllowedMimeTypes is the intersection of what every provider route can render
    * AND what the desktop client can decode, so a handle that exists is renderable
    * everywhere rather than only on the route that produced it.
    */
    "mediaMaxItemBytes": Number(process.env.MEDIA_MAX_ITEM_BYTES) || 20 * 1024 * 1024, // Per-image cap (decoded bytes)
    "mediaMaxItemsPerCall": 4, // Max images attached to one tool call or result
    "mediaMaxItemsPerSession": Number(process.env.MEDIA_MAX_ITEMS_PER_SESSION) || 50, // Oldest are pruned past this
    "mediaAllowedMimeTypes": ['image/png', 'image/jpeg', 'image/gif'],
    "mediaMaxImagesInContext": 4, // Images hydrated into any one provider call (newest first)
    "mediaMaxHydratedBytes": 8 * 1024 * 1024, // Total image bytes hydrated into any one provider call
    "mediaImageModels": { default: 'gemini-3.1-flash-image' }, // Per-provider override lane, like selectEngineModel's
    "mediaImageMaxCount": 1 // Images returned by one generate_image call

};

export default config
