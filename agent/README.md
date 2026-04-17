# WebSocket AI Agent Server

AI-powered agent for building and modifying System Dynamics models via WebSocket.

## Overview

This WebSocket server provides an AI agent (powered by Claude) that helps users build, modify, and analyze System Dynamics models. The agent uses existing SD-AI engines as tools and allows clients to dynamically register their own tools for model execution and data retrieval.

**Key Features:**
- Stateless server architecture (all user data lives client-side)
- Session-specific temp folders for Python visualizations
- Built-in SD-AI engine tools
- Dynamic client tool registration
- Configurable agent behavior via YAML
- AI-powered custom visualizations
- Multiple agent personalities (Ganos Lal, Myrddin, etc.)

## Architecture

### Client-Owned Model

The **client** owns and maintains:
- Complete model state (SD-JSON format)
- All simulation run data
- Full conversation history
- Visualization history

The **server** maintains (in-memory only):
- Active WebSocket sessions
- Model type (CLD or SFD) - set once, never changes
- Conversation context
- Pending tool calls and feedback requests
- Session-specific temp folders

### Model Type Enforcement

Each session works with ONE model type that cannot be changed:
- **CLD** (Causal Loop Diagram) - Conceptual models with feedback loops
- **SFD** (Stock Flow Diagram) - Quantitative models with stocks, flows, and equations

The model type is declared at session initialization and enforced throughout:
- Agent will only use tools appropriate for that model type
- If building an SFD requires a conceptual CLD first, the CLD will be shown in a separate window

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
3. **Client sends** `initialize_session` with auth, model type, initial model, and tools
4. **Server validates** and sends `session_ready` with available agents
5. **Client sends** `select_agent` to choose an agent (e.g., "ganos-lal", "myrddin")
6. **Server sends** `agent_selected` confirmation
7. **Normal conversation** begins with `chat` messages

### Client → Server Messages

All client messages include a `sessionId` (except `initialize_session` which receives one).

#### 1. Initialize Session

Establishes a session with authentication, model type, initial model, client tools, and context.

```json
{
  "type": "initialize_session",
  "authenticationKey": "your-auth-key",
  "clientProduct": "sd-web",
  "clientVersion": "1.0.0",
  "modelType": "sfd",
  "model": {
    "variables": [],
    "relationships": [],
    "specs": {}
  },
  "tools": [
    {
      "name": "get_current_model",
      "description": "Returns the current model state from the client",
      "inputSchema": {
        "type": "object",
        "properties": {}
      }
    },
    {
      "name": "update_model",
      "description": "Updates the client's model with changes",
      "inputSchema": {
        "type": "object",
        "properties": {
          "model": { "type": "object" },
          "explanation": { "type": "string" }
        }
      }
    },
    {
      "name": "run_model",
      "description": "Runs a simulation and returns time series data",
      "inputSchema": {
        "type": "object",
        "properties": {
          "timeRange": { "type": "object" }
        }
      }
    },
    {
      "name": "show_intermediate_model",
      "description": "Shows an intermediate model in a separate window",
      "inputSchema": {
        "type": "object",
        "properties": {
          "model": { "type": "object" },
          "displayMode": { "type": "string" }
        }
      }
    }
  ],
  "context": {
    "description": "Optional context about the modeling task"
  }
}
```

**Fields:**
- `authenticationKey` - Server authentication (can be disabled in config)
- `clientProduct` - Client identifier (e.g., "sd-web", "sd-desktop")
- `clientVersion` - Client version for compatibility checking
- `modelType` - Either `"cld"` or `"sfd"` - **cannot be changed during session**
- `model` - Initial model state (can be empty)
- `tools` - Array of client tool definitions (see Client Tool Registration below)
- `context` - Optional contextual information

#### 2. Select Agent

Chooses which agent personality to use for the session.

```json
{
  "type": "select_agent",
  "sessionId": "sess_abc123",
  "agentId": "ganos-lal"
}
```

**Available Agents:**
- `ganos-lal` - Helpful mentor who guides users through modeling
- `myrddin` - Expert modeler focused on technical excellence

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

Responds to a `tool_call_request` with execution results.

```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "call_xyz789",
  "result": {
    "model": {
      "variables": [...],
      "relationships": [...]
    }
  },
  "isError": false
}
```

**Error Response:**
```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "call_xyz789",
  "result": "Model validation failed: missing required field 'name'",
  "isError": true
}
```

#### 5. Model Updated Notification

Notifies the server when the client updates the model externally (e.g., user manual edit).

```json
{
  "type": "model_updated_notification",
  "sessionId": "sess_abc123",
  "model": {
    "variables": [...],
    "relationships": [...]
  },
  "changeReason": "User manually added a new variable"
}
```

#### 6. Disconnect

Gracefully closes the session.

```json
{
  "type": "disconnect",
  "sessionId": "sess_abc123"
}
```

### Server → Client Messages

#### 1. Session Created

Sent immediately upon WebSocket connection. Provides the session ID for all subsequent messages.

```json
{
  "type": "session_created",
  "sessionId": "sess_abc123",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

#### 2. Session Ready

Sent after successful initialization. Lists available agents for selection.

```json
{
  "type": "session_ready",
  "sessionId": "sess_abc123",
  "availableAgents": [
    {
      "id": "ganos-lal",
      "name": "Ganos Lal",
      "supports": ["sfd", "cld"],
      "description": "A helpful mentor who guides you through building models"
    },
    {
      "id": "myrddin",
      "name": "Myrddin",
      "supports": ["sfd", "cld"],
      "description": "An expert modeler focused on technical excellence"
    }
  ],
  "defaults": {
    "sfd": "ganos-lal",
    "cld": "ganos-lal"
  },
  "timestamp": "2025-01-15T10:30:00.100Z"
}
```

**Fields:**
- `availableAgents` - Array of agent definitions with their supported model types
- `defaults` - Object mapping model types to their default agent IDs

#### 3. Agent Selected

Confirms that an agent has been selected and is ready.

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

Text response from the agent (thinking or final response).

```json
{
  "type": "agent_text",
  "sessionId": "sess_abc123",
  "content": "I'll help you build a population model with births and deaths...",
  "isThinking": false,
  "timestamp": "2025-01-15T10:30:01.000Z"
}
```

**Fields:**
- `isThinking` - `true` if this is internal reasoning (optional to display), `false` for final response

#### 5. Tool Call Notification

Informs the client that a tool is being called (for UI display purposes). Sent for ALL tools (built-in and client).

```json
{
  "type": "tool_call_notification",
  "sessionId": "sess_abc123",
  "callId": "call_abc456",
  "toolName": "generate_quantitative_model",
  "arguments": {
    "prompt": "Create a simple population model",
    "modelType": "sfd"
  },
  "isBuiltIn": true,
  "timestamp": "2025-01-15T10:30:02.000Z"
}
```

**Fields:**
- `isBuiltIn` - `true` for server-side tools, `false` for client tools
- **Client Action:** Display in UI, show loading state, log the tool call

#### 6. Tool Call Request

**Only sent for client tools.** Requests the client to execute one of their registered tools and return results.

```json
{
  "type": "tool_call_request",
  "sessionId": "sess_abc123",
  "callId": "call_xyz789",
  "toolName": "run_model",
  "arguments": {
    "timeRange": {
      "start": 0,
      "end": 100,
      "dt": 1
    }
  },
  "timeout": 30000,
  "timestamp": "2025-01-15T10:30:03.000Z"
}
```

**Fields:**
- `timeout` - Milliseconds before request times out (default: 30000)
- **Client Action:** Execute the tool and send back `tool_call_response`

**Important:** Client will receive BOTH `tool_call_notification` (for UI) AND `tool_call_request` (for execution) for client tools.

#### 7. Tool Call Completed

Sent after a tool completes execution (built-in or client tool).

```json
{
  "type": "tool_call_completed",
  "sessionId": "sess_abc123",
  "callId": "call_abc456",
  "toolName": "generate_quantitative_model",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"model\": {...}, \"supportingInfo\": {...}}"
      }
    ]
  },
  "isError": false,
  "responseType": "model",
  "timestamp": "2025-01-15T10:30:04.000Z"
}
```

**Fields:**
- `isError` - Whether the tool execution failed
- `responseType` - One of: `"model"`, `"discuss"`, `"ltm-discuss"`, `"other"`

#### 8. Visualization

Sends visualization data to the client as base64 encoded PNG images.

```json
{
  "type": "visualization",
  "sessionId": "sess_abc123",
  "visualizationId": "viz_12345",
  "title": "Population Growth Over Time",
  "description": "Shows exponential growth pattern",
  "format": "image",
  "data": "iVBORw0KGgoAAAANSUhEUgAAA...",
  "metadata": {
    "createdBy": "generate_quantitative_model",
    "variables": ["Population"]
  },
  "timestamp": "2025-01-15T10:30:05.000Z"
}
```

**Format:**
- All visualizations are returned as base64-encoded PNG images
- The `data` field contains the base64 string directly

#### 9. Show Intermediate Model

Asks the client to display an intermediate model (e.g., a CLD created before building an SFD).

```json
{
  "type": "show_intermediate_model",
  "sessionId": "sess_abc123",
  "modelType": "cld",
  "model": {
    "variables": [...],
    "relationships": [...]
  },
  "purpose": "This CLD shows the conceptual structure before we build the quantitative SFD",
  "displayMode": "separate_window",
  "timestamp": "2025-01-15T10:30:06.000Z"
}
```

**Display Modes:**
- `"separate_window"` - Show in a new window/dialog
- `"inline"` - Display within the conversation
- `"background"` - Load silently without interrupting

#### 10. Feedback Request

Requests feedback loop analysis data from the client (used by Seldon engine for enhanced discussions).

```json
{
  "type": "feedback_request",
  "sessionId": "sess_abc123",
  "requestId": "feedback_xyz789",
  "runId": "run_12345",
  "comparative": false,
  "timestamp": "2025-01-15T10:30:07.000Z"
}
```

**Fields:**
- `runId` - Specific run ID for single-run feedback (optional)
- `comparative` - If `true`, request feedback for ALL runs for comparison

**Client Response:** Send `tool_call_response` with:
```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "feedback_xyz789",
  "result": {
    "feedbackContent": {
      "loops": [
        {
          "id": "loop_1",
          "name": "Population Growth Loop",
          "type": "reinforcing",
          "polarity": "R",
          "variables": ["Population", "Births"],
          "strength": 0.85,
          "dominance": [
            { "time": 0, "value": 0.3 },
            { "time": 10, "value": 0.8 }
          ]
        }
      ]
    }
  }
}
```

#### 11. Agent Complete

Signals that the agent has finished processing the current request.

```json
{
  "type": "agent_complete",
  "sessionId": "sess_abc123",
  "status": "success",
  "finalMessage": "I've completed building your population model.",
  "timestamp": "2025-01-15T10:30:08.000Z"
}
```

**Status Values:**
- `"success"` - Task completed successfully
- `"error"` - Task failed
- `"awaiting_user"` - Waiting for user input

#### 12. Error

Reports errors during message processing or tool execution.

```json
{
  "type": "error",
  "sessionId": "sess_abc123",
  "error": "Tool 'run_model' timed out after 30 seconds",
  "errorCode": "TOOL_TIMEOUT",
  "recoverable": true,
  "timestamp": "2025-01-15T10:30:09.000Z"
}
```

**Fields:**
- `recoverable` - If `true`, the session can continue; if `false`, reconnection may be needed

## Client Tool Registration

Clients register their tools during `initialize_session`. Each tool must follow this schema:

```typescript
{
  name: string,              // Unique tool name
  description: string,       // What the tool does (for AI)
  inputSchema: {             // JSON Schema for parameters
    type: "object",
    properties: {
      // Parameter definitions
    },
    required?: string[]      // Required parameters
  }
}
```

### Recommended Client Tools

#### 1. get_current_model

**Purpose:** Returns the current model state from the client.

```json
{
  "name": "get_current_model",
  "description": "Get the current model from the client",
  "inputSchema": {
    "type": "object",
    "properties": {}
  }
}
```

**Expected Response:**
```json
{
  "model": {
    "variables": [...],
    "relationships": [...],
    "specs": {...}
  }
}
```

#### 2. update_model

**Purpose:** Updates the client's model with changes or a complete replacement.

```json
{
  "name": "update_model",
  "description": "Update the client model with changes or replace it entirely",
  "inputSchema": {
    "type": "object",
    "properties": {
      "model": {
        "type": "object",
        "description": "Complete model to set (replaces current model)"
      },
      "explanation": {
        "type": "string",
        "description": "Human-readable explanation of what changed"
      }
    },
    "required": ["model"]
  }
}
```

**Expected Response:**
```json
{
  "success": true,
  "model": {
    "variables": [...],
    "relationships": [...]
  }
}
```

#### 3. run_model

**Purpose:** Executes a simulation and returns time series data.

```json
{
  "name": "run_model",
  "description": "Run model simulation and return time series data",
  "inputSchema": {
    "type": "object",
    "properties": {
      "timeRange": {
        "type": "object",
        "description": "Simulation time configuration"
      }
    }
  }
}
```

**Expected Response:**
```json
{
  "success": true,
  "results": {
    "series": [
      { "time": 0, "Population": 1000, "Births": 20 },
      { "time": 1, "Population": 1020, "Births": 20.4 }
    ]
  }
}
```

#### 4. show_intermediate_model

**Purpose:** Displays an intermediate model in a separate window.

```json
{
  "name": "show_intermediate_model",
  "description": "Show intermediate model in separate window",
  "inputSchema": {
    "type": "object",
    "properties": {
      "model": { "type": "object" },
      "displayMode": { "type": "string" }
    }
  }
}
```

## Built-In Tools

The agent has access to these SD-AI engine tools:

### Model Generation

1. **generate_quantitative_model** - Generate Stock Flow Diagrams (SFD)
   - Creates fully quantitative models with stocks, flows, and equations
   - Returns SD-JSON format model

2. **generate_qualitative_model** - Generate Causal Loop Diagrams (CLD)
   - Creates conceptual models showing causal relationships
   - Returns SD-JSON format model

### Discussion & Analysis

3. **discuss_model_with_seldon** - Expert SD discussion with Seldon
   - Deep technical discussions about model structure and behavior
   - Can request and use feedback loop analysis for enhanced insights

4. **discuss_model_across_runs** - User-friendly discussion with run comparison
   - Compare behavior across different simulation runs
   - Explain why different scenarios produce different outcomes

5. **discuss_with_mentor** - Friendly mentoring discussions
   - User-friendly explanations without jargon
   - Educational approach to modeling concepts

### Documentation

6. **generate_documentation** - Auto-document model variables
   - Generates descriptions and metadata for model elements
   - Ensures model is well-documented

7. **generate_ltm_narrative** - Feedback loop narratives
   - Creates Loop Transition Matrices (LTM) narratives
   - Analyzes feedback loop dominance over time

### Visualization

8. **create_visualization** - Create charts and plots
   - Returns base64-encoded PNG images only
   - Python/matplotlib for all visualizations
   - AI-generated custom visualization code

## Agent Configuration

Each agent is configured via YAML files in `agent/config/`:

- `ganos-lal.yaml` - Helpful mentor personality
- `myrddin.yaml` - Expert modeler personality

**Key Configuration Sections:**

```yaml
agent:
  name: "Ganos Lal"
  description: "A helpful mentor..."

instructions:
  role: |
    You are a friendly Systems Dynamics expert...

  constraints:
    - "Never modify the model without explaining why"
    - "Always validate before running simulations"

  workflows:
    build_model: |
      1. Understand user requirements
      2. Create conceptual CLD first
      3. Build quantitative SFD
      4. Validate and test

toolPolicies:
  generate_quantitative_model:
    when: "Building or significantly modifying an SFD model"
    bestPractices:
      - "Always show intermediate CLD first"
      - "Validate all equations"
```

## Visualization System

The agent creates visualizations using Python/matplotlib and always returns base64-encoded PNG images.

### 1. Template-Based Visualizations (Default)

Generates Python scripts using predefined templates for common visualization types.

```javascript
{
  type: 'time_series',
  variables: ['Population', 'Births'],
  title: 'Population Dynamics'
}
```

**Supported types:**
- `time_series` - Time series line plots
- `phase_portrait` - Phase space diagrams
- `comparison` - Compare runs side-by-side

### 2. AI-Custom Visualizations

Uses AI to write custom Python/matplotlib code for unique requirements.

```javascript
{
  variables: ['Population', 'Births'],
  useAICustom: true,
  dataDescription: 'Population shows exponential growth...',
  visualizationGoal: 'Highlight the divergence between births and deaths',
  customRequirements: 'Use a log scale for the y-axis'
}
```

**Temp File Management:**
- Session-specific folder: `/tmp/sd-agent-{sessionId}/`
- Files deleted immediately after visualization creation
- Folder cleaned up on session disconnect

**Output:**
- All visualizations return base64-encoded PNG strings
- No JSON specs or other formats - images only

## Example Client Implementation

### JavaScript/Node.js

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000/api/v1/agent');
let sessionId = null;

ws.on('open', () => {
  console.log('Connected to agent server');
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message.type);

  switch (message.type) {
    case 'session_created':
      sessionId = message.sessionId;
      // Send initialization
      ws.send(JSON.stringify({
        type: 'initialize_session',
        authenticationKey: 'your-key',
        clientProduct: 'my-client',
        clientVersion: '1.0.0',
        modelType: 'sfd',
        model: {},
        tools: [
          {
            name: 'get_current_model',
            description: 'Get current model',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'update_model',
            description: 'Update model',
            inputSchema: {
              type: 'object',
              properties: {
                model: { type: 'object' }
              }
            }
          }
        ]
      }));
      break;

    case 'session_ready':
      // Select agent
      ws.send(JSON.stringify({
        type: 'select_agent',
        sessionId: sessionId,
        agentId: 'ganos-lal'
      }));
      break;

    case 'agent_selected':
      // Start conversation
      ws.send(JSON.stringify({
        type: 'chat',
        sessionId: sessionId,
        message: 'Build me a simple population model'
      }));
      break;

    case 'tool_call_notification':
      console.log(`Tool ${message.toolName} is being called (built-in: ${message.isBuiltIn})`);
      break;

    case 'tool_call_request':
      // Execute client tool
      const result = executeClientTool(message.toolName, message.arguments);
      ws.send(JSON.stringify({
        type: 'tool_call_response',
        sessionId: sessionId,
        callId: message.callId,
        result: result,
        isError: false
      }));
      break;

    case 'agent_text':
      console.log('Agent:', message.content);
      break;

    case 'visualization':
      console.log('Received visualization:', message.title);
      // Display visualization using message.data
      break;

    case 'agent_complete':
      console.log('Agent finished:', message.status);
      break;
  }
});

function executeClientTool(toolName, args) {
  switch (toolName) {
    case 'get_current_model':
      return { model: currentModel };

    case 'update_model':
      currentModel = args.model;
      return { success: true, model: currentModel };

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
```

## Security & Scalability

### Authentication

Set `AUTHENTICATION_KEY` environment variable to enable authentication:

```bash
export AUTHENTICATION_KEY="your-secret-key"
```

Clients must include this in `initialize_session`.

### Stateless Design

- No user data persisted server-side
- Sessions exist only in RAM
- Automatic cleanup on disconnect
- Safe for multi-user deployment

### Resource Limits

- Max sessions: 1000 (configurable)
- Session timeout: 30 minutes inactive
- Max session age: 8 hours
- Temp folder monitoring

### Scaling

- Horizontal scaling supported
- Use sticky sessions at load balancer
- OR: Use shared session store (Redis)

## Troubleshooting

### WebSocket won't connect

- Check firewall allows WebSocket connections
- Verify path is `/api/v1/agent`
- Check server logs for errors

### Tool call timeout

- Client must respond within 30 seconds (configurable)
- Check client tool implementation
- Verify WebSocket connection is stable

### Temp files not cleaned up

- Check session cleanup logs
- Verify graceful shutdown handlers
- Monitor `/tmp/sd-agent-*/` directories

### Visualization fails

- Python 3 must be available
- matplotlib must be installed
- Check temp folder permissions

## Development

### Running the Server

```bash
npm start
```

WebSocket server available at: `ws://localhost:3000/api/v1/agent`


### Testing

Use the included test client: `agent/test-client.html`

Open in a browser and connect to test all message types.
