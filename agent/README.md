# WebSocket AI Agent Server

AI-powered agent for building and modifying System Dynamics models via WebSocket.

## Overview

This WebSocket server provides an AI agent (powered by Claude Agent SDK) that helps users build, modify, and analyze System Dynamics models. The agent uses existing SD-AI engines as tools and allows clients to dynamically register their own tools for model execution and data retrieval.

**Key Features:**
- Stateless server architecture (all user data lives client-side)
- Session-specific temp folders for Python visualizations
- Built-in SD-AI engine tools
- Dynamic client tool registration
- Configurable agent behavior via YAML
- AI-powered custom visualizations

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
- Pending tool calls
- Session-specific temp folders

### Model Type Enforcement

**CRITICAL:** Each session works with ONE model type that cannot be changed:
- **CLD** (Causal Loop Diagram) - Conceptual models with feedback loops
- **SFD** (Stock Flow Diagram) - Quantitative models with stocks, flows, and equations

The model type is declared at session initialization and enforced throughout:
- Agent will only use tools appropriate for that model type
- If building an SFD requires a conceptual CLD first, the CLD will be shown in a separate window
- Prevents confusion and maintains workflow consistency

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

### HTTP Monitoring

```
GET /api/v1/agent/stats
```

Returns active session statistics, memory usage, and temp folder info.

## WebSocket Protocol

### Client → Server Messages

#### 1. Initialize Session

```json
{
  "type": "initialize_session",
  "model": {
    "variables": [...],
    "relationships": [...],
    "specs": {...}
  },
  "tools": [
    {
      "name": "run_model",
      "description": "Creates a new simulation run",
      "inputSchema": {...}
    },
    {
      "name": "get_variable_data",
      "description": "Retrieves time series data from existing run",
      "inputSchema": {...}
    },
    {
      "name": "get_feedback_loop_analysis",
      "description": "Analyzes feedback loop dominance",
      "inputSchema": {...}
    },
    {
      "name": "get_current_model",
      "description": "Returns current model state",
      "inputSchema": {}
    },
    {
      "name": "update_model",
      "description": "Applies model changes",
      "inputSchema": {...}
    }
  ],
  "sessionConfig": {
    "agentInstructions": {
      "role": "...",
      "constraints": [...],
      "goals": [...]
    }
  }
}
```

#### 2. Chat Message

```json
{
  "type": "chat",
  "sessionId": "sess_abc123",
  "message": "Add immigration to my model"
}
```

#### 3. Tool Call Response

```json
{
  "type": "tool_call_response",
  "sessionId": "sess_abc123",
  "callId": "call_xyz789",
  "result": {
    "runId": "run_12345",
    "data": {...}
  },
  "isError": false
}
```

### Server → Client Messages

#### Session Created

```json
{
  "type": "session_created",
  "sessionId": "sess_abc123"
}
```

#### Agent Text

```json
{
  "type": "agent_text",
  "sessionId": "sess_abc123",
  "content": "I'll add immigration to your model...",
  "isThinking": true
}
```

#### Tool Call Request (client must execute)

```json
{
  "type": "tool_call_request",
  "sessionId": "sess_abc123",
  "callId": "call_abc456",
  "toolName": "run_model",
  "arguments": {
    "variables": ["Population", "Births", "Deaths"]
  },
  "timeout": 30000
}
```

#### Visualization

```json
{
  "type": "visualization",
  "sessionId": "sess_abc123",
  "visualizationId": "viz_12345",
  "title": "Population Growth Over Time",
  "format": "plotly",
  "data": {
    "data": [...],
    "layout": {...}
  }
}
```

## Built-In Tools

The agent has access to these SD-AI engine tools:

1. **generate_quantitative_model** - Generate Stock Flow Diagrams
2. **generate_qualitative_model** - Generate Causal Loop Diagrams
3. **discuss_model_with_seldon** - Expert SD discussion
4. **discuss_model_across_runs** - User-friendly discussion with ability to compare runs
5. **generate_documentation** - Auto-document variables
6. **generate_ltm_narrative** - Feedback loop narratives
7. **create_visualization** - Create Plotly or Python/matplotlib charts

## Client Tool Requirements

Clients **must** implement these tools:

### 1. run_model

Creates a new simulation run using the client's current model.

**Input:** `{ variables?: string[], timeRange?: {...} }`

**Output:**
```json
{
  "runId": "run_12345",
  "modelSnapshot": {...},
  "data": {
    "time": [0, 1, 2, ...],
    "Population": [1000, 1020, ...],
    ...
  }
}
```

### 2. get_variable_data

Retrieves time series data from an existing run.

**Input:** `{ runId: string, variables: string[], startTime?: number, endTime?: number }`

**Output:**
```json
{
  "time": [0, 1, 2, ...],
  "Population": [1000, 1020, ...],
  ...
}
```

### 3. get_feedback_loop_analysis

Analyzes feedback loop dominance for a run.

**Input:** `{ runId: string }`

**Output:**
```json
{
  "feedbackLoops": [...],
  "dominantLoopsByPeriod": [...]
}
```

### 4. get_current_model

Returns the client's current model state.

**Input:** `{}`

**Output:** `{ model: {...} }`

### 5. update_model

Applies changes to the client's model.

**Input:**
```json
{
  "changes": {
    "addVariables": [...],
    "removeVariables": [...],
    "modifyVariables": [...],
    "addRelationships": [...],
    "removeRelationships": [...]
  },
  "reasoning": "..."
}
```

**Output:**
```json
{
  "success": true,
  "updatedModel": {...},
  "appliedChanges": [...],
  "warnings": []
}
```

## Agent Configuration

Agent behavior is configured via `agent/config/agent-config.yaml`.

**Key sections:**
- `instructions` - General guidelines, workflows, validation rules
- `actionSequence` - Step-by-step workflows for different scenarios
- `toolPolicies` - When and how to use each tool
- `communication` - Response style and format
- `errorHandling` - How to handle failures
- `constraints` - Model complexity limits

See [agent-config.yaml](config/agent-config.yaml) for the full configuration.

## Visualization System

The agent can create visualizations using three modes:

### 1. Plotly (Default)

Generates Plotly JSON specifications (no temp files).

```javascript
{
  type: 'time_series',
  variables: ['Population', 'Births'],
  title: 'Population Dynamics'
}
```

### 2. Python/Matplotlib

Generates Python scripts using predefined templates.

```javascript
{
  type: 'time_series',
  variables: ['Population'],
  usePython: true
}
```

### 3. AI-Custom

Uses AI to write custom Python/matplotlib code.

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

## Dependencies

### Node.js Dependencies

Installed via `npm install`:
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK
- `ws` - WebSocket server
- `zod` - Schema validation
- `js-yaml` - YAML config parsing
- All existing SD-AI dependencies

### Python Dependencies (for Visualizations)

Required for Python/matplotlib visualizations:
```bash
pip install matplotlib numpy
```

These are likely already installed if PySD is working.

## Development

### Running the Server

```bash
npm start
```

WebSocket server available at: `ws://localhost:3000/api/v1/agent`

### Monitoring

```bash
curl http://localhost:3000/api/v1/agent/stats
```

Shows:
- Active sessions
- Total messages/tool calls
- Temp folder sizes
- Memory usage

### Testing

Create a test client (see [test-client.js](test-client.js) example):

```javascript
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3000/api/v1/agent');

ws.on('open', () => {
  // Send initialize_session
  ws.send(JSON.stringify({
    type: 'initialize_session',
    model: {...},
    tools: [...]
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message.type);

  if (message.type === 'tool_call_request') {
    // Execute tool and respond
    const result = executeClientTool(message.toolName, message.arguments);
    ws.send(JSON.stringify({
      type: 'tool_call_response',
      callId: message.callId,
      result
    }));
  }
});
```

## Security & Scalability

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
- Client must respond within 30 seconds
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

## License

Same as main SD-AI project.
