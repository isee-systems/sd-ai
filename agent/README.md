# WebSocket AI Agent Server

AI-powered agent for building and modifying System Dynamics models via WebSocket.

## Overview

This WebSocket server provides an AI agent (powered by Claude) that helps users build, modify, and analyze System Dynamics models. The agent uses built-in SD-AI engine tools and communicates with the client for model state, simulation runs, feedback loop data, and variable time-series.

**Key Features:**
- Stateless server architecture (all user data lives client-side)
- Built-in tools for model interaction — no tool registration required for core operations
- Optional custom client tool registration for application-specific behavior
- Configurable agent behavior via Markdown files in `agent/config/`
- AI-powered custom visualizations (SVG)
- Multiple agent personalities (Ganos Lal, Myrddin, etc.)
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

### Model Type Enforcement

Each session works with ONE model type that cannot be changed:
- **CLD** (Causal Loop Diagram) — Conceptual models with feedback loops
- **SFD** (Stock Flow Diagram) — Quantitative models with stocks, flows, and equations

The model type is declared at session initialization and enforced throughout.

### Message Flow

```
Client ← WebSocket → Server ← Tools → SD-AI Engines
   ↓                                        ↑
 Model,                              Quantitative,
 Runs,                               Qualitative,
 History                             Seldon, etc.
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
5. **Client sends** `select_agent` to choose an agent (e.g., `"ganos-lal"`, `"myrddin"`)
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
    }
  ],
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
- `mode` — Either `"cld"` or `"sfd"` — **cannot be changed during session**
- `model` — Initial model state (can be empty)
- `tools` — Optional array of custom client tool definitions (see Client Tool Registration below). Core model operations are all built-in and do not need to be registered here.
- `historicalMessages` — Optional array of previous messages to seed conversation context
- `context` — Optional contextual information for the agent

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

Chooses which agent personality to use.

```json
{
  "type": "select_agent",
  "sessionId": "sess_abc123",
  "agentId": "ganos-lal"
}
```

Available agents are returned in `session_ready`. Agents are discovered from `.md` files in `agent/config/`.

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

#### 7. Disconnect

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
      "id": "ganos-lal",
      "name": "Ganos Lal",
      "supportedModes": ["sfd", "cld"],
      "description": "System Dynamics mentor who uses Socratic questioning..."
    },
    {
      "id": "myrddin",
      "name": "Myrddin",
      "supportedModes": ["sfd", "cld"],
      "description": "..."
    }
  ],
  "defaults": {
    "sfd": "myrddin",
    "cld": "myrddin"
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
  "agentId": "ganos-lal",
  "agentName": "Ganos Lal",
  "timestamp": "2025-01-15T10:30:00.200Z"
}
```

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
    "errors": []
  }
}
```

`errors` is an array of strings set by the client to report any simulation or validation errors on the current model state. Pass an empty array if there are no errors.

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
    { "id": "run_abc123", "name": "Baseline" },
    { "id": "run_def456", "name": "Policy" }
  ]
}
```

**`get_variable_data`** — return time-series data for requested variables and runs
```json
{
  "variableData": {
    "run_abc123": {
      "Population": [
        { "time": 0, "value": 1000 },
        { "time": 1, "value": 1020 }
      ],
      "Births": [
        { "time": 0, "value": 20 },
        { "time": 1, "value": 20.4 }
      ]
    }
  }
}
```

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

**Client response** — send `tool_call_response` with `callId` set to the `requestId` and the `variableData` shape shown in §6 above.

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

Note that receiving an `error` message does not mean the agent has stopped — the agent may still continue iterating. Wait for `agent_complete` before treating the agent as idle.

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
  timeout?: number           // Milliseconds to wait for client response (default: 30000)
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

When the agent calls a custom tool, the server sends a `tool_call_request` and the client must respond with `tool_call_response`.

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
| `minModelTokens` | `number` | If the current model's token count is below this value, the tool is excluded. Used for tools that only make sense for large models (e.g., `read_model_section`, `edit_model_section`). |

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

### Documentation
- **generate_documentation** — Auto-document model variables
- **generate_ltm_narrative** — Feedback loop dominance narratives (LTM)

### Visualization
- **create_visualization** — Create SVG charts; supports `time_series`, `phase_portrait`, `feedback_dominance`, `comparison`, and AI-custom types

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
- **edit_model_section** — Edit a section of a large model in place

---

## Agent Configuration

Agents are configured via Markdown files in `agent/config/`. The server automatically discovers any `.md` file with a `name` frontmatter field.

```
agent/config/
  ganos-lal.md
  myrddin.md
```

**Frontmatter fields:**

```yaml
---
name: "Ganos Lal"
description: "System Dynamics mentor who uses Socratic questioning..."
version: "1.0"
max_iterations: 20
supported_modes:
  - sfd
  - cld
---
```

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
      ws.send(JSON.stringify({ type: 'select_agent', sessionId, agentId }));
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
      result = { runs: getAllRuns() };
      break;
    case 'get_variable_data':
      result = { variableData: getVariableData(message.arguments) };
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

### Testing

Use the included test client: `agent/test-client.html`

Open in a browser and connect to test all message types.
