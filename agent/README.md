# WebSocket AI Agent Server

AI-powered agent for building and modifying System Dynamics models via WebSocket.

## Overview

This WebSocket server provides an AI agent (powered by Claude, Gemini, or OpenRouter-routed brands like Qwen / Deepseek / Kimi) that helps users build, modify, and analyze System Dynamics models. The agent uses built-in SD-AI engine tools and communicates with the client for model state, simulation runs, feedback loop data, and variable time-series.

**Key Features:**
- Stateless server architecture (all user data lives client-side)
- Built-in tools for model interaction — no tool registration required for core operations
- Optional custom client tool registration for application-specific behavior
- Configurable agent behavior via Markdown files in `agent/config/`
- AI-powered custom visualizations (SVG)
- Multiple agent personalities (Socrates, Merlin, etc.)
- Per-session temp directory for visualization scratch space

## Architecture

### Client-Owned Model

The **client** owns and maintains:
- Complete model state (SD-JSON format)
- All simulation run data
- Full conversation history (user messages, agent responses, visualizations)
- Message log for session resumption

The **server** maintains (in-memory only):
- Active WebSocket sessions
- A per-session temp directory (created on connect, cleaned up on disconnect)
- Model type (CLD or SFD) — set once, never changes
- Conversation context (can be seeded with historical messages)
- Pending tool calls, feedback requests, and model interaction requests

### Worker Process Architecture

Each agent session runs in a dedicated **worker subprocess** spawned by `WorkerSpawner` and managed by `AgentWorker`. The main process owns WebSocket connections; all agent execution (LLM calls, tool execution) happens inside the worker.

**On Linux with bubblewrap installed:** the worker runs inside a bwrap sandbox. Only the session's temp directory is writable; the rest of the filesystem is read-only or not mounted. IPC between the main process and the worker uses a Unix domain socket (`<tempDir>/ipc-<random>.sock`) that crosses the sandbox boundary without needing `--forward-fd`.

**On macOS / Linux without bwrap:** falls back to a plain Node.js `fork()`. The fork runs in its own process group (`detached: true`) so killing the group also terminates any grandchild processes (e.g. the Claude CLI subprocess spawned by the Anthropic Agent SDK).

IPC messages between the main process and worker:
- **Main → Worker:** `initialize`, `select_agent`, `chat`, `stop`, `tool_response`, `model_updated`, `add_file`, `remove_file`, `get_context`, `shutdown`
- **Worker → Main:** `to_client` (relayed to the WebSocket), `context_response`, `rag_file_processed`, `worker_error`

### Model Type Enforcement

Each session works with ONE model type that cannot be changed:
- **CLD** (Causal Loop Diagram) — Conceptual models with feedback loops
- **SFD** (Stock Flow Diagram) — Quantitative models with stocks, flows, and equations

The model type is declared at session initialization and enforced throughout.

### Retrieval-Augmented Generation (RAG)

Clients can attach reference documents to a session with the `add_file` / `remove_file` messages. Attached files are available to the agent on **every** provider/loop route, because retrieval is implemented independently of the chat provider.

**Hybrid, threshold-based tiers** (the threshold is `config.ragManifestMaxTokens`):
- **manifest tier** (small files) — listed in an "Attached Files" section appended to the system prompt; the agent reads the full extracted text on demand from the file's path.
- **vector tier** (large files) — chunked and embedded; the agent retrieves relevant passages with the universal `search_documents` tool. Embeddings use a Gemini embedding model (`config.ragEmbeddingModel`), decoupled from the chat provider, so behavior is identical across all routes.

**Flow.** The main process is authoritative for "the bytes exist": on `add_file` it decodes the inline content, writes the raw bytes to `<tempDir>/rag/<fileId>/original.bin` (the worker's `/session` bind-mount source), records metadata, acks the client immediately with a full file snapshot (`status: "processing"`), then forwards a lightweight `add_file` IPC to the worker. The worker extracts text (txt/md/csv/json as-is; PDF via pdfjs, DOCX via mammoth, XLSX via SheetJS), classifies the tier, chunks + embeds large files, persists artifacts, and reports back with `rag_file_processed`; the main process then pushes an updated snapshot (`status: "ready"`).

**On-disk layout** (under the session temp dir, which survives agent switches):
```
rag/
  manifest.json                 # array of file metadata
  <fileId>/
    original.bin                # raw uploaded bytes
    extracted.txt               # extracted plain text
    chunks.json                 # [{chunkIndex,text,startChar,endChar,page?}]  (vector tier)
    embeddings.json             # [[float,...]] aligned to chunks.json          (vector tier)
```
Because the session temp dir is reused across agent switches, a worker spawned for a new agent **reloads** the existing artifacts (via the `attachedFiles` list on `initialize`) instead of re-embedding. The whole `rag/` directory is removed with the session on disconnect.

### Message Flow

```
Client ← WebSocket → Main Process → Worker Process ← Tools → SD-AI Engines
   ↓                                     ↑                         ↑
 Model,                             (IPC socket               Quantitative,
 Runs,                              or Node IPC)              Qualitative,
 History                                                       Seldon, etc.
```

## API Endpoints

### WebSocket Endpoint

```
ws://localhost:3000/api/v1/agent
```

## WebSocket Protocol

### Connection Flow

1. **Client connects** to WebSocket endpoint
2. **Server sends** `session_created` with session ID
3. **Client sends** `initialize_session` with auth, model type, initial model, and optional custom tools
4. **Server validates** and sends `session_ready` with available agents
5. **Client sends** `select_agent` to choose an agent by ID (e.g., `"socrates"`, `"merlin"`) or supply a custom agent config inline
6. **Server sends** `agent_selected` confirmation
7. **Normal conversation** begins with `chat` messages

### Client → Server Messages

All client messages include a `sessionId` (except `initialize_session` which receives one).

#### 1. Initialize Session

Establishes a session with authentication, model type, initial model, and optional custom tools.

```json
{
  "type": "initialize_session",
  "authenticationKey": "your-auth-key",
  "clientProduct": "sd-web",
  "clientVersion": "1.0.0",
  "mode": "sfd",
  "model": {
    "variables": [],
    "relationships": [],
    "specs": {}
  },
  "tools": [
    {
      "name": "open_variable_inspector",
      "description": "Opens the variable inspector panel in the client UI for a given variable",
      "inputSchema": {
        "type": "object",
        "properties": {
          "variableName": { "type": "string" }
        },
        "required": ["variableName"]
      }
    },
    {
      "name": "write_interface_media",
      "description": "Write a generated image into the interface's assets folder",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "image": { "type": "string", "description": "Media handle from generate_image" }
        },
        "required": ["name", "image"]
      },
      "media": { "inputs": ["image"], "maxItems": 1 }
    }
  ],
  "supportsArrays": true,
  "supportsModules": true,
  "supportsSubTypes": false,
  "supportsMedia": true,
  "historicalMessages": [
    {
      "type": "user_text",
      "content": "Build me a population model"
    },
    {
      "type": "agent_text",
      "content": "I'll help you build a population model...",
      "isThinking": false
    }
  ],
  "context": {
    "description": "Optional context about the modeling task"
  }
}
```

**Fields:**
- `authenticationKey` — Server authentication (required only if `AUTHENTICATION_KEY` env var is set)
- `clientProduct` — Client identifier (e.g., `"sd-web"`, `"sd-desktop"`)
- `clientVersion` — Client version for compatibility checking
- `clientId` — Optional unique identifier for the end user (used for token usage reporting)
- `mode` — Either `"cld"` or `"sfd"` — **cannot be changed during session**
- `model` — Initial model state (can be empty)
- `tools` — Optional array of custom client tool definitions (see Client Tool Registration below). Core model operations are all built-in and do not need to be registered here.
- `historicalMessages` — Optional array of previous messages to seed conversation context
- `context` — Optional contextual information for the agent

**Capability flags** — all optional, all defaulting to `false`, so a client that omits them behaves
as it did before the flag existed:
- `supportsArrays` — client can render arrayed models
- `supportsModules` — client can render modular models
- `supportsSubTypes` — client can render queues, conveyors and ovens
- `supportsMedia` — client can decode and display images. Gates the built-in `generate_image` and
  `view_media` tools, which are *additionally* withheld unless at least one entry in `tools`
  declares a `media` contract (see Client Tool Registration). Both conditions must hold: the flag
  says the client could show a picture, the tool contracts say there is somewhere to put one.
  The example above sends both halves — `supportsMedia: true` plus a `write_interface_media` tool
  whose `media.inputs` names the argument a generated image lands in. Send the flag on its own and
  neither built-in is offered, because a generated picture would have nowhere to go.

### Historical Messages

The `historicalMessages` field lets clients provide conversation history from a previous session, enabling continuity across reconnections or new sessions.

**Message Types:**

1. **user_text** — User chat message
```json
{ "type": "user_text", "content": "Build me a population model" }
```

2. **agent_text** — Agent response or thinking
```json
{
  "type": "agent_text",
  "content": "I'll create a simple population model with births and deaths",
  "isThinking": false
}
```

3. **visualization** — Previous visualization (summarized as context, not re-rendered)
```json
{
  "type": "visualization",
  "visualizationTitle": "Population Growth",
  "visualizationDescription": "Shows exponential growth"
}
```

4. **agent_complete** — Agent completion message
```json
{ "type": "agent_complete", "content": "I've completed building your model" }
```

**Important Notes:**
- Historical messages seed the agent's conversation context
- The server does not persist messages — the client is responsible for maintaining history
- SVG data from past visualizations is not replayed; only the title/description are included as context

#### 2. Select Agent

Chooses which agent personality and LLM provider to use. Either `agentId` or `agentConfig` must be provided.

**Option A — select a built-in agent by ID:**

```json
{
  "type": "select_agent",
  "sessionId": "sess_abc123",
  "agentId": "socrates",
  "provider": "google"
}
```

**Option B — supply a custom agent configuration inline:**

```json
{
  "type": "select_agent",
  "sessionId": "sess_abc123",
  "agentConfig": "---\nname: \"My Agent\"\nagent_mode: sdk\nsupported_modes:\n  - sfd\nsupported_providers:\n  - anthropic\n  - google\n  - qwen\n  - deepseek\n  - moonshotai\n---\n\n## Instructions\nYou are a custom agent...",
  "provider": "anthropic"
}
```

The `agentConfig` string must be a Markdown document with valid YAML frontmatter containing at minimum `name` and `agent_mode`. Its format is identical to the agent `.md` files in `agent/config/` — see [Agent Configuration](#agent-configuration) for the full frontmatter reference. The Markdown body below the frontmatter becomes the agent's system prompt.

**Fields:**
- `agentId` — ID of a built-in agent (e.g., `"socrates"`, `"merlin"`). Available agent IDs are returned in `session_ready`. Required if `agentConfig` is not provided.
- `agentConfig` — Full agent configuration as a Markdown string. Required if `agentId` is not provided. Server returns `AGENT_SELECTION_ERROR` if the frontmatter is missing or invalid.
- `provider` — LLM provider. `"anthropic"` and `"google"` reach their vendor APIs directly; every other id names an upstream LLM brand routed internally through the OpenRouter gateway. The OpenRouter-backed brands are defined in `config.openRouterAgentProviders` (currently `qwen`, `deepseek`, `moonshotai`, `zai`/GLM) — add or remove one there and the full set updates everywhere. The complete accepted list is `config.agentProviders`. Defaults to `agentDefaultProvider` in `config.js`. Ignored when the agent's `supportedProviders` has exactly one entry.

#### 3. Chat Message

Sends a user message to the agent.

```json
{
  "type": "chat",
  "sessionId": "sess_abc123",
  "message": "Build me a simple population model"
}
```

#### 4. Tool Call Response

Responds to any `tool_call_request` or `feedback_request` from the server.

```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "req_abc123",
  "result": {},
  "isError": false
}
```

**Error response:**
```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "req_abc123",
  "result": "Simulation failed: division by zero in equation",
  "isError": true
}
```

The `result` shape depends on which request is being answered — see the Server → Client messages below for the expected format per tool.

**Answering with an image.** A tool can hand the agent a picture to actually look at by adding a
`media` array alongside `result`. The bytes are written to the session's media store, given an opaque
handle, and turned into a native image content block for whichever provider the session is using —
so the model sees the picture rather than a description of it.

```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "req_abc123",
  "result": { "path": "assets/hero.png" },
  "media": [
    {
      "name": "preview.png",
      "mimeType": "image/png",
      "encoding": "base64",
      "content": "<base64>",
      "description": "Screenshot of the interface preview"
    }
  ],
  "isError": false
}
```

Field names deliberately match `add_file`, so a client reuses the same encode path. Limits are
`config.mediaMaxItemBytes` per image (20 MiB), `config.mediaMaxItemsPerCall` images per response (4)
and `config.mediaAllowedMimeTypes` (`image/png`, `image/jpeg`, `image/gif`) — the intersection of
what every provider route can render and what the desktop client can decode. An image that breaks a
limit is answered as a tool error rather than dropped silently. Declare the intent with
`media.returnsMedia` on the tool definition; the caps, not the declaration, are what enforce it.

#### 5. Model Updated Notification

Notifies the server when the client updates the model externally (e.g., user manual edit).

```json
{
  "type": "model_updated_notification",
  "sessionId": "sess_abc123",
  "model": {
    "variables": [],
    "relationships": []
  },
  "changeReason": "User manually added a new variable"
}
```

#### 6. Stop Iteration

Interrupts the current agent loop without disconnecting the session.

```json
{
  "type": "stop_iteration",
  "sessionId": "sess_abc123"
}
```

The agent stops after the current API call completes, then sends `agent_complete` with status `awaiting_user`. The session remains active and can receive new `chat` messages.

#### 7. Add File (RAG)

Attaches a reference document to the session. The content is sent inline — as plain UTF-8 text or, for binary documents (PDF/DOCX/XLSX), base64-encoded. Decoded size is capped by `config.ragMaxFileBytes`, and the number of attached files by `config.ragMaxFilesPerSession`. The overall WebSocket frame is capped by `config.websocketMaxPayloadBytes`.

```json
{
  "type": "add_file",
  "sessionId": "sess_abc123",
  "fileId": "optional-client-id",
  "name": "requirements.pdf",
  "mimeType": "application/pdf",
  "encoding": "base64",
  "content": "JVBERi0xLjQ..."
}
```

`fileId` is optional; the server assigns one if omitted. The server replies with a `file_added` snapshot immediately (`status: "processing"`) and again once extraction/embedding completes (`status: "ready"`).

#### 8. Remove File (RAG)

Removes a previously attached file and all of its artifacts.

```json
{
  "type": "remove_file",
  "sessionId": "sess_abc123",
  "fileId": "file_9f3a..."
}
```

The server replies with a `file_removed` snapshot.

#### 9. Disconnect

Gracefully closes the session and cleans up all server-side resources including the temp directory.

```json
{
  "type": "disconnect",
  "sessionId": "sess_abc123"
}
```

---

### Server → Client Messages

#### 1. Session Created

Sent immediately upon WebSocket connection.

```json
{
  "type": "session_created",
  "sessionId": "sess_abc123",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### 2. Session Ready

Sent after successful initialization. Lists available agents.

```json
{
  "type": "session_ready",
  "sessionId": "sess_abc123",
  "availableAgents": [
    {
      "id": "socrates",
      "name": "Socrates",
      "supportedModes": ["sfd", "cld"],
      "supportedProviders": [
        {"id": "anthropic", "name": "Claude"},
        {"id": "google", "name": "Gemini"},
        {"id": "qwen", "name": "Qwen"},
        {"id": "deepseek", "name": "Deepseek"},
        {"id": "moonshotai", "name": "Kimi"},
        {"id": "zai", "name": "GLM"}
      ],
      "description": "System Dynamics mentor who uses Socratic questioning..."
    },
    {
      "id": "merlin",
      "name": "Merlin",
      "supportedModes": ["sfd", "cld"],
      "supportedProviders": [
        {"id": "anthropic", "name": "Claude"},
        {"id": "google", "name": "Gemini"},
        {"id": "qwen", "name": "Qwen"},
        {"id": "deepseek", "name": "Deepseek"},
        {"id": "moonshotai", "name": "Kimi"},
        {"id": "zai", "name": "GLM"}
      ],
      "description": "..."
    }
  ],
  "defaults": {
    "sfd": "socrates",
    "cld": "socrates"
  },
  "timestamp": "2025-01-15T10:30:00.100Z"
}
```

#### 3. Agent Selected

Confirms the selected agent is ready.

```json
{
  "type": "agent_selected",
  "sessionId": "sess_abc123",
  "agentId": "socrates",
  "agentName": "Socrates",
  "supportedProviders": [
    {"id": "anthropic", "name": "Claude (Anthropic)"},
    {"id": "google", "name": "Gemini (Google)"},
    {"id": "qwen", "name": "Qwen (OpenRouter)"},
    {"id": "deepseek", "name": "Deepseek (OpenRouter)"},
    {"id": "moonshotai", "name": "Kimi (OpenRouter)"},
    {"id": "zai", "name": "GLM (OpenRouter)"}
  ],
  "currentProvider": "anthropic",
  "timestamp": "2025-01-15T10:30:00.200Z"
}
```

- `agentId` — `"custom"` when a custom `agentConfig` was used; otherwise the built-in agent ID.
- `agentName` — Display name from the agent's frontmatter.
- `supportedProviders` — Providers this agent accepts, in `{id, name}` form. Same format as the `supportedProviders` array in `session_ready`. Use this to populate a provider selector after agent selection — especially important for custom agents where the supported providers are only known after the server parses the config.
- `currentProvider` — The provider ID that was actually selected for this session (one of `config.agentProviders`, e.g. `"anthropic"`, `"google"`, or an OpenRouter brand such as `"zai"`). Resolved from the `provider` field of the `select_agent` message, falling back to `agentDefaultProvider` in config, or forced to the single entry when `supportedProviders` has exactly one item. The OpenRouter-routed brands all share the same internal code paths but pick different model slugs from their `config.openRouterAgentProviders` entry (`model` / `summaryModel`).

#### 4. Agent Text

Text response from the agent.

```json
{
  "type": "agent_text",
  "sessionId": "sess_abc123",
  "content": "I'll help you build a population model with births and deaths...",
  "isThinking": false,
  "timestamp": "2025-01-15T10:30:01.000Z"
}
```

`isThinking: true` indicates internal reasoning — display is optional.

#### 5. Tool Call Notification

Informs the client that a tool is being called (for UI display). Sent for all tools — built-in and custom.

```json
{
  "type": "tool_call_notification",
  "sessionId": "sess_abc123",
  "callId": "call_abc456",
  "toolName": "generate_quantitative_model",
  "isBuiltIn": true,
  "timestamp": "2025-01-15T10:30:02.000Z"
}
```

#### 6. Tool Call Request

Requests the client to execute a model interaction and return results via `tool_call_response`. Sent for both built-in client interaction tools and any custom registered tools.

```json
{
  "type": "tool_call_request",
  "sessionId": "sess_abc123",
  "callId": "req_abc123",
  "toolName": "get_current_model",
  "arguments": {},
  "timeout": 30000,
  "timestamp": "2025-01-15T10:30:03.000Z"
}
```

**Calls that carry an image.** When a tool declares `media.inputs`, any argument named there holds an
opaque media handle (`med_<16 hex>`) and the bytes travel beside the call in a `media` array. The
handle stays in `arguments` exactly as the model wrote it — the model never sees base64, and never
handles bytes — and `media[].argument` says which argument the bytes are the real value of:

```json
{
  "type": "tool_call_request",
  "sessionId": "sess_abc123",
  "callId": "req_abc123",
  "toolName": "write_interface_media",
  "arguments": { "name": "hero.png", "image": "med_9f2c1b0a5d3e4711", "description": "A red square" },
  "media": [
    {
      "mediaId": "med_9f2c1b0a5d3e4711",
      "argument": "image",
      "name": "hero.png",
      "mimeType": "image/png",
      "bytes": 184320,
      "encoding": "base64",
      "content": "<base64>"
    }
  ],
  "timeout": 60000
}
```

`arguments` still validates against the tool's own `inputSchema` unchanged, because a handle is
declared there as a plain string. A handle the server does not recognise fails the call before it is
sent, so the client is never asked to act on a meaningless value.

**Built-in tool names and expected `result` shapes:**

**`get_current_model`** — return the current model state
```json
{
  "model": {
    "variables": [
      {
        "name": "Population",
        "type": "stock",
        "equation": "1000",
        "documentation": "Total population",
        "units": "people",
        "inflows": ["Births"],
        "outflows": ["Deaths"]
      },
      {
        "name": "Births",
        "type": "flow",
        "equation": "Population * Birth Rate",
        "uniflow": true
      },
      {
        "name": "Birth Rate",
        "type": "variable",
        "equation": "0.02"
      }
    ],
    "relationships": [
      { "from": "Birth Rate", "to": "Births", "polarity": "+" },
      { "from": "Population", "to": "Births", "polarity": "+" }
    ],
    "specs": {
      "startTime": 0,
      "stopTime": 100,
      "dt": 0.25,
      "timeUnits": "Years"
    },
    "errors": [],
    "unitWarnings": []
  }
}
```

`errors` is an array of strings set by the client to report any simulation or validation errors on the current model state. Pass an empty array if there are no errors.

`unitWarnings` is an array of strings set by the client to report the results of the engine's unit- (dimensional-) consistency check on the current model. This field is **authoritative**: the server never computes unit warnings, and the agent reports a unit/dimensional problem to the user *only* if it appears here. Pass an **empty array** to signal that the engine ran the unit check and found no problems (a positive "units are consistent" signal the agent can rely on); **omit the field entirely** if the client did not run or report a unit check. The agent will never infer or fabricate unit warnings from the human-readable `units` strings when this array is empty or absent.

**`update_model`** — apply model changes, confirm success
```json
{ "success": true }
```

**`run_model`** — run the simulation, return the new run ID
```json
{ "runId": "run_abc123" }
```

**`get_run_info`** — return all simulation runs
```json
{
  "runs": [
    {
      "id": "run_abc123",
      "name": "Baseline",
      "isExternal": false,
      "variables": ["Population", "Births", "Deaths"]
    },
    { "id": "run_def456", "name": "Policy" }
  ]
}
```

Each run object:
- `id` — required, unique run identifier
- `name` — required, display name
- `isExternal` — optional boolean, whether the run originated outside the current model
- `variables` — optional array of variable names available in this run

**`get_variable_data`** — return time-series data for requested variables and runs
```json
{
  "run_abc123": {
    "Population": {
      "time": [0, 1, 2],
      "values": [1000, 1020, 1040]
    },
    "Births": {
      "time": [0, 1, 2],
      "values": [20, 20.4, 20.8]
    }
  },
  "run_def456": {
    "Population": {
      "time": [0, 1, 2],
      "values": [1000, 980, 961]
    }
  }
}
```

The response is keyed by run ID, then by variable name. Each variable entry has parallel `time` and `values` arrays.

For **custom registered tools**, the `toolName` will match a name from the `tools` array provided in `initialize_session`, and `result` can be any JSON value meaningful to the agent.

#### 7. Tool Call Completed

Sent after a built-in tool finishes execution.

```json
{
  "type": "tool_call_completed",
  "sessionId": "sess_abc123",
  "callId": "call_abc456",
  "toolName": "generate_quantitative_model",
  "isError": false,
  "timestamp": "2025-01-15T10:30:04.000Z"
}
```

#### 8. Visualization

Sends an SVG visualization to the client.

```json
{
  "type": "visualization",
  "sessionId": "sess_abc123",
  "visualizationId": "viz_12345",
  "title": "Population Growth Over Time",
  "description": "Shows exponential growth pattern",
  "format": "svg",
  "data": "<svg xmlns=\"http://www.w3.org/2000/svg\" ...>...</svg>",
  "timestamp": "2025-01-15T10:30:05.000Z"
}
```

- `format` is always `"svg"`
- `data` is a raw SVG string (not base64, not PNG)
- `description` is optional

#### 9. Feedback Request

Requests feedback loop analysis data from the client, used by the Seldon and LTM narrative tools.

```json
{
  "type": "feedback_request",
  "sessionId": "sess_abc123",
  "requestId": "feedback_xyz789",
  "runIds": ["run_abc123", "run_def456"],
  "timestamp": "2025-01-15T10:30:07.000Z"
}
```

**Client response** — send `tool_call_response` with `callId` set to the `requestId`:

```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "feedback_xyz789",
  "result": {
    "feedbackContent": {
      "feedbackLoops": [
        {
          "identifier": "loop_1",
          "name": "Population Growth Loop",
          "polarity": "+",
          "links": [
            { "from": "Population", "to": "Births", "polarity": "+" },
            { "from": "Births", "to": "Population", "polarity": "+" }
          ],
          "loopset": 1,
          "Percent of Model Behavior Explained By Loop": [
            { "time": 0, "value": 0.3 },
            { "time": 10, "value": 0.8 }
          ]
        }
      ],
      "dominantLoopsByPeriod": [
        { "dominantLoops": ["loop_1"], "startTime": 0, "endTime": 50 }
      ]
    },
    "runIds": ["run_abc123"]
  },
  "isError": false
}
```

#### 10. Get Variable Data Request

Requests time-series data for specific variables from specific runs.

```json
{
  "type": "get_variable_data",
  "sessionId": "sess_abc123",
  "requestId": "vardata_xyz789",
  "variableNames": ["Population", "Births", "Deaths"],
  "runIds": ["run_abc123", "run_def456"],
  "detailed": true,
  "timestamp": "2025-01-15T10:30:07.500Z"
}
```

- `detailed: true` returns more data points suitable for plotting; `false` returns a sampled summary

**Client response** — send `tool_call_response` with `callId` set to the `requestId` and the `result` in the `get_variable_data` shape shown in §6 above (keyed by run ID → variable name → `{ time, values }`).

#### 11. Agent Complete

Signals the agent has finished the current request. **Agent execution only stops when the client disconnects or when this message is received** — clients should treat `agent_complete` as the authoritative signal that the agent is idle and ready for the next input.

```json
{
  "type": "agent_complete",
  "sessionId": "sess_abc123",
  "status": "success",
  "finalMessage": "I've completed building your population model.",
  "timestamp": "2025-01-15T10:30:08.000Z"
}
```

**Status values:** `"success"` | `"error"` | `"awaiting_user"`

#### 12. Error

Reports errors during processing.

```json
{
  "type": "error",
  "sessionId": "sess_abc123",
  "error": "Tool 'run_model' timed out after 60 seconds",
  "errorCode": "TOOL_TIMEOUT",
  "timestamp": "2025-01-15T10:30:09.000Z"
}
```

**Known error codes:**

| Code | Cause |
|---|---|
| `AGENT_SELECTION_ERROR` | `select_agent` failed — e.g. unknown `agentId`, or `agentConfig` frontmatter is missing required `name` / `agent_mode` fields. The session remains active; send another `select_agent` to recover. |
| `TOOL_TIMEOUT` | A built-in or custom tool did not receive a `tool_call_response` within its timeout. |
| `NO_AGENT` | A `chat` message arrived before `select_agent` was sent. |
| `FILE_TOO_LARGE` | An `add_file` decoded to more than `config.ragMaxFileBytes` bytes. |
| `FILE_LIMIT_EXCEEDED` | An `add_file` would exceed `config.ragMaxFilesPerSession`. |
| `ADD_FILE_ERROR` / `REMOVE_FILE_ERROR` | An attach/remove operation failed server-side. |
| `MEDIA_TOO_LARGE` | An image on a `tool_call_response` decoded to more than `config.mediaMaxItemBytes` bytes. |
| `MEDIA_TYPE_UNSUPPORTED` | An image's `mimeType` is not in `config.mediaAllowedMimeTypes`. |
| `MEDIA_LIMIT_EXCEEDED` | A response carried more images than `config.mediaMaxItemsPerCall`. |
| `MEDIA_ID_INVALID` / `MEDIA_MISSING` | A media handle was malformed, or its bytes are no longer held (the session prunes the oldest past `config.mediaMaxItemsPerSession`). |

Note that receiving an `error` message does not mean the agent has stopped — the agent may still continue iterating. Wait for `agent_complete` before treating the agent as idle.

#### 13. File Added (RAG)

Acknowledges an `add_file`. Carries the **full snapshot** of currently attached files so the client always has authoritative state. Sent twice per upload: once immediately (`status: "processing"`) and again when extraction/embedding completes (`status: "ready"`, or `"error"` on failure).

```json
{
  "type": "file_added",
  "sessionId": "sess_abc123",
  "files": [
    {
      "fileId": "file_9f3a...",
      "name": "requirements.pdf",
      "mimeType": "application/pdf",
      "bytes": 482113,
      "tokenCount": 18240,
      "tier": "vector",
      "chunkCount": 34,
      "status": "ready"
    }
  ],
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

`tier` is `"manifest"` (read in full by the agent) or `"vector"` (searched via `search_documents`).

#### 14. File Removed (RAG)

Acknowledges a `remove_file`, carrying the updated full snapshot (the same `files` shape as `file_added`).

```json
{
  "type": "file_removed",
  "sessionId": "sess_abc123",
  "files": [],
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## Client Tool Registration

Clients can optionally register custom tools during `initialize_session`. These are application-specific operations the agent can invoke — for example, opening a UI panel, triggering an export, or running a custom analysis.

Core model operations (`get_current_model`, `update_model`, `run_model`, `get_run_info`, `get_variable_data`) are all built-in and do **not** need to be registered.

```typescript
{
  name: string,              // Unique tool name
  description: string,       // What the tool does (shown to the AI)
  inputSchema: {             // JSON Schema for parameters
    type: "object",
    properties: {
      // Parameter definitions
    },
    required?: string[]
  },
  timeout?: number,          // Milliseconds to wait for client response (default: 30000)
  media?: {                  // Optional — only for a tool that exchanges images
    inputs?: string[],       // inputSchema properties whose value is a media handle
    returnsMedia?: boolean,  // whether this tool may answer with a `media` array
    maxItems?: number        // how many images it expects to return
  }
}
```

The `timeout` field controls how long the server waits for the client's `tool_call_response` before failing with a timeout error. Use a longer value for tools that trigger slow operations (e.g., a long-running export or analysis):

```json
{
  "name": "run_heavy_export",
  "description": "Exports the full model to an external system",
  "inputSchema": { "type": "object", "properties": {} },
  "timeout": 120000
}
```

### Tools that exchange images

A custom tool can be handed an image, or answer with one, by declaring a `media` contract beside its
`inputSchema`. Omit `media` and nothing changes — the tool behaves exactly as it always did.

```json
{
  "name": "write_interface_media",
  "description": "Write a generated image into the interface's assets folder",
  "inputSchema": {
    "type": "object",
    "properties": {
      "name":        { "type": "string", "description": "File name, e.g. hero.png" },
      "image":       { "type": "string", "description": "Media handle from generate_image" },
      "description": { "type": "string", "description": "What the picture shows" }
    },
    "required": ["name", "image", "description"]
  },
  "media": { "inputs": ["image"], "maxItems": 1 }
}
```

A handle parameter is declared as an ordinary `{"type": "string"}`, which is exactly what the model
sees and sends — it never handles base64. The server swaps the handle for the bytes on the way out
(see the `tool_call_request` shape above) and captures any bytes coming back into a handle of its own.
Handles come from the built-in `generate_image` tool; `view_media` shows one to the model again, which
is how a picture survives an agent switch or a summarised conversation.

Those two built-ins are only offered when the client can actually use them, which takes two things:
`supportsMedia: true` on `initialize_session`, **and** at least one declared tool with a media
contract. The flag alone is not enough — a client that can display images but registers nowhere to
put one would get an image generator whose output is a dead end. This is why no agent needs to know
about media: a client that registers its media tools conditionally (Stella registers them only for
interface authoring) automatically withholds `generate_image` from a plain modeling session with
Merlin or Socrates, and offers it during interface work, without either side naming an agent.

When the agent calls a custom tool, the server sends a `tool_call_request` and the client must respond with `tool_call_response`.

### Large tool catalogues are searched, not listed

Registered tools are advertised to the model with their full schemas up to
`agentClientToolSearchThreshold` in [`config.js`](../config.js) (default 5, overridable with
`AGENT_CLIENT_TOOL_SEARCH_THRESHOLD`). Register more than that and the schemas are withheld: the model
is given their **names** plus two tools in their place, defined in
[`tools/clientToolSearch.js`](tools/clientToolSearch.js).

- **`search_tools`** — takes a `query` and returns the matching tools' descriptions, full input
  schemas, declared timeouts and media contracts. Three query forms: `select:name_a,name_b` for exact
  names, `+term rest` to require a term, or plain keywords matched against names and descriptions.
- **`call_tool`** — takes `{ name, arguments }`, where `arguments` is the tool's argument object
  encoded as a JSON string (an object is accepted too). Arguments are validated against the client's
  own schema before the call leaves the server; a mismatch comes back with the schema attached and no
  round trip to the client.

A dispatched call is indistinguishable from a direct one everywhere it matters: the client still
receives an ordinary `tool_call_request` naming the real tool, with the declared `timeout` and the
resolved `media` sidecar, and the `tool_call_notification`/`tool_call_completed` messages still name
the tool the user actually asked for rather than `call_tool`.

Nothing about a tool definition changes — the threshold is a server-side decision about how to spend
the context window, and a client registering three tools sees exactly the behaviour it always did.

---

## Built-In Tool Interface

Each built-in tool is a plain object returned by a factory function. The fields are:

### Required

| Field | Type | Description |
|---|---|---|
| `description` | `string` | Natural-language description shown to the AI when deciding whether to call the tool |
| `inputSchema` | `ZodSchema` | Zod schema defining the tool's input parameters |
| `handler` | `async (args) => { content, isError }` | Executes the tool and returns a standardized response |
| `supportedModes` | `string[]` | Modes this tool is available in. Values: `'sfd'`, `'cld'`. Include both to support all modes. |

### Optional

| Field | Type | Description |
|---|---|---|
| `maxModelTokens` | `number` | If the current model's token count exceeds this value, the tool is excluded from the agent's tool list. Used for tools that receive the full model (e.g., `generate_quantitative_model`). |
| `minModelTokens` | `number` | If the current model's token count is below this value, the tool is excluded. Used for tools that only make sense for large models (e.g., `read_model_section`, `edit_variables`). |
| `requiresMedia` | `'sink' \| 'any'` | Excludes the tool unless the client declared `supportsMedia` at session init **and** its tool list backs that up. `'sink'` needs a client tool with a non-empty `media.inputs` — somewhere a generated picture can go (`generate_image`). `'any'` needs a sink *or* a client tool with `media.returnsMedia` — some way for a handle to exist at all (`view_media`). |
| `nonSdkOnly` | `boolean` | If `true`, the tool is excluded from the Anthropic SDK (`sdk`) mode's MCP server and the Google ADK tool list. It is only available in `manual` loop mode. Use this for tools that duplicate functionality already provided natively by the SDK (e.g. file system tools). |

All of these are evaluated by one predicate, `isToolAvailable` in [`tools/toolAvailability.js`](tools/toolAvailability.js).
Every provider route (SDK/MCP, ADK, both manual loops, OpenRouter) filters through it, so a new
condition added there takes effect everywhere rather than on the routes someone remembered.

Token counting runs on every conversation turn for all sessions. The token thresholds use `agentMaxTokensForEngines` from `config.js` (default: 100,000).

---

## Built-In Tools

All core tools are registered server-side. Clients do not need to register them.

### Model Generation
- **generate_quantitative_model** — Generate Stock Flow Diagrams (SFD)
- **generate_qualitative_model** — Generate Causal Loop Diagrams (CLD)

### Discussion & Analysis
- **discuss_model_with_seldon** — Deep technical discussion with feedback loop analysis
- **discuss_model_across_runs** — Compare behavior across simulation runs
- **discuss_with_mentor** — User-friendly mentoring discussion
- **generate_ltm_narrative** — Feedback loop dominance narratives (LTM)

### Visualization
- **create_visualization** — Create SVG charts; supports `time_series`, `phase_portrait`, `feedback_dominance`, `comparison`, and AI-custom types
- **draw_causal_loop_diagram** (SFD only) — Render an SVG causal loop diagram from simplified, LLM-authored feedback loops to explain the origins of model behavior

### Client Model Interaction
- **get_current_model** — Fetch current model state from client
- **update_model** — Push model changes to client
- **run_model** — Trigger simulation run on client
- **get_run_info** — Get list of all simulation runs from client
- **get_variable_data** — Fetch time-series variable data from client

### Feedback
- **get_feedback_information** — Request feedback loop analysis from client (required before Seldon/LTM tools)

### Large Model Utilities
- **read_model_section** — Read a section of a large model without loading it entirely
- **edit_variables** — Add, update, or remove variables in a large model in place
- **edit_relationships** — Add, update, or remove relationships in a large model in place
- **edit_specs** — Update simulation specs (startTime, stopTime, dt, timeUnits, arrayDimensions) in a large model in place
- **edit_modules** — Add, update, or remove modules in a large model in place

### File Utilities
- **read_file** — Read a file from the session temp directory (supports line range and search filtering). Used to read manifest-tier attached files in full. (Excluded from the Anthropic SDK route, which uses the SDK's native `Read`.)

### Retrieval (RAG)
- **search_documents** — Semantic search over large (vector-tier) attached documents. Inputs: `query` (required), `topK` (optional), `fileId` (optional, restrict to one file). Returns ranked excerpts, each with the source file name, chunk index, and location. Small (manifest-tier) files are not searched — the agent reads those in full from their path. Available on every provider/loop route.

---

## Agent Configuration

Agents are configured via Markdown files in `agent/config/`. The server automatically discovers any `.md` file with a `name` frontmatter field.

```
agent/config/
  socrates.md
  merlin.md
```

**Frontmatter fields:**

```yaml
---
name: "Socrates"
description: "System Dynamics mentor who uses Socratic questioning..."
version: "1.0"
max_iterations: 20
agent_mode: manual          # Loop strategy: 'sdk' (managed framework) or 'manual' (explicit loop)
supported_modes:
  - sfd
  - cld
can_write_to_local_sandbox: false   # Opt-in. Omitted means denied.
# supported_providers omitted — allows the full set (config.agentProviders). The
# built-in agents omit it so OpenRouter brands added in config.js apply automatically.
# To restrict, list a subset, e.g.:
#   supported_providers:
#     - anthropic             # Claude (direct Anthropic API)
#     - google                # Gemini (direct Google API)
#     - zai                   # GLM (via OpenRouter)
---
```

**`agent_mode`** controls the loop strategy — it does _not_ select the LLM provider:
- `sdk` — uses a managed agent framework (Anthropic Agent SDK, Google ADK, or OpenRouter Agent SDK) that handles iteration and tool calling internally
- `manual` — uses an explicit `while` loop that calls the provider API directly

**`supported_providers`** lists which LLM providers are valid for this agent. The client selects the actual provider at runtime via the `provider` field in `select_agent`. If the list has exactly one entry, that provider is always used. If the field is absent, all providers are allowed (`config.agentProviders`) — the built-in agents omit it for exactly this reason, so a brand added to `config.openRouterAgentProviders` becomes available to every agent with no per-agent edit.

**`can_write_to_local_sandbox`** grants the agent permission to modify the worker's sandbox filesystem. It is an opt-in, and strictly so — anything other than a literal `true` is a denial, including omitting the field. Of the built-in agents only Merlin has it.

The grant covers `write_file` and `edit_file` on every route, plus the Agent SDK's native `Write`, `Edit`, `NotebookEdit` and `Bash`. Bash is in that set because a shell is a write tool — granting `Write` while withholding `bash -c 'echo … > f'` would be an arbitrary line. The flag is authoritative regardless of `agent_mode`: a `manual` agent that opts in gets `write_file` and `edit_file` like any other.

On the SDK route the tools are withheld via the query's `disallowedTools`, **not** by omission from `allowedTools`. `allowedTools` is an auto-approve list, not a whitelist — the SDK's own docs say restricting availability is what the `tools` option is for — and `permissionMode: 'bypassPermissions'` waives the approval it exists to pre-answer. Leaving a name out of `allowedTools` withholds nothing, which is how the native write tools stayed live behind a `/*'Edit', 'Write',*/` that looked like it had removed them.

Reading is never gated. `get_variable_data` writes simulation output to disk and the universal SFD instructions require the model to read those numbers back before interpreting them, so `read_file` and the SDK's native `Read` / `Glob` / `Grep` stay with every agent. The field is about what an agent may change, not what it may see.

Enforcement is in two places. `isToolAvailable` (see `agent/tools/toolAvailability.js`) withholds any tool marked `requiresSandboxWrite` from an agent without the grant, which keeps it out of every route's declaration list; and the manual execute paths refuse the call outright if it arrives anyway. The second guard matters on agent switch, where the previous agent's transcript is replayed into this agent's prompt — an agent without the grant can find itself reading worked examples of the tools Merlin has.

Provider IDs name the actual LLM brand the user is choosing. `anthropic` and `google` reach their vendor APIs directly. The OpenRouter-backed brands are defined entirely in `config.openRouterAgentProviders` (currently `qwen`, `deepseek`, `moonshotai`, `zai`) — the orchestrator shares one code path for all of them and resolves the model slug from each brand's `model` / `summaryModel` entry. Adding or removing a brand is a single edit to that object in `config.js`.

The Markdown body below the frontmatter is the agent's full system prompt/instructions.

---

## Visualization System

Visualizations are generated using Python/matplotlib and sent as raw SVG strings.

**Supported types:**
- `time_series` — Line plots of variables over time
- `phase_portrait` — State-space (stock vs. stock) diagrams
- `feedback_dominance` — Stacked area chart of loop influence over time
- `comparison` — Multi-run side-by-side comparison

**AI-custom visualizations:** Set `useAICustom: true` to have the AI generate custom matplotlib code for unique requirements.

**Output:** All visualizations are raw SVG strings — the `data` field in the `visualization` message is the SVG directly, not base64 or PNG.

---

## Example Client Implementation

### JavaScript/Node.js

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000/api/v1/agent');
let sessionId = null;

ws.on('message', (data) => {
  const message = JSON.parse(data);

  switch (message.type) {
    case 'session_created':
      sessionId = message.sessionId;
      ws.send(JSON.stringify({
        type: 'initialize_session',
        authenticationKey: 'your-key',
        clientProduct: 'my-client',
        clientVersion: '1.0.0',
        mode: 'sfd',
        model: {}
        // Optionally include custom tools here
      }));
      break;

    case 'session_ready':
      const agentId = message.defaults?.sfd || message.availableAgents[0]?.id;
      // Optionally specify a provider; omit to use the server default (anthropic).
      // Other supported values: 'google' plus the OpenRouter brands in
      // config.openRouterAgentProviders ('qwen', 'deepseek', 'moonshotai', 'zai').
      ws.send(JSON.stringify({ type: 'select_agent', sessionId, agentId, provider: 'anthropic' }));
      break;

    case 'agent_selected':
      ws.send(JSON.stringify({
        type: 'chat',
        sessionId,
        message: 'Build me a simple population model'
      }));
      break;

    case 'tool_call_request':
      handleToolCallRequest(message);
      break;

    case 'feedback_request':
      handleFeedbackRequest(message);
      break;

    case 'agent_text':
      console.log('Agent:', message.content);
      break;

    case 'visualization':
      // message.format === 'svg', message.data is a raw SVG string
      displaySVG(message.data, message.title, message.description);
      break;

    case 'agent_complete':
      console.log('Done:', message.status, message.finalMessage);
      break;

    case 'error':
      console.error('Error:', message.error);
      break;
  }
});

function handleToolCallRequest(message) {
  let result;
  switch (message.toolName) {
    case 'get_current_model':
      result = { model: currentModel };
      break;
    case 'update_model':
      currentModel = message.arguments.modelData;
      result = { success: true };
      break;
    case 'run_model':
      result = { runId: runSimulation() };
      break;
    case 'get_run_info':
      // runs: [{ id, name, isExternal?, variables? }, ...]
      result = { runs: getAllRuns() };
      break;
    case 'get_variable_data':
      // { [runId]: { [varName]: { times: number[], values: number[] } } }
      result = getVariableData(message.arguments);
      break;
    default:
      // Custom registered tool
      result = executeCustomTool(message.toolName, message.arguments);
  }
  ws.send(JSON.stringify({
    type: 'tool_call_response',
    sessionId,
    callId: message.callId,
    result,
    isError: false
  }));
}

function handleFeedbackRequest(message) {
  const feedbackContent = getFeedbackLoops(message.runIds);
  ws.send(JSON.stringify({
    type: 'tool_call_response',
    sessionId,
    callId: message.requestId,
    result: { feedbackContent, runIds: message.runIds },
    isError: false
  }));
}

function stopAgent() {
  ws.send(JSON.stringify({ type: 'stop_iteration', sessionId }));
}
```

---

## Security & Scalability

### Authentication

Set `AUTHENTICATION_KEY` environment variable to enable authentication:

```bash
export AUTHENTICATION_KEY="your-secret-key"
```

Clients must include this in `initialize_session`. If the env var is not set, authentication is disabled.

### Stateless Design

- No user data persisted server-side
- Sessions exist only in RAM, but do make use of a temporary directory for large model edits and visualization generation
- Per-session temp directory created on connect, deleted on disconnect
- Safe for multi-user deployment

### Scaling

- Horizontal scaling supported with sticky sessions at the load balancer

---

## Development

### Running the Server

```bash
npm start
```

WebSocket server available at: `ws://localhost:3000/api/v1/agent`
