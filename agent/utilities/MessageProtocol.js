import { timeout } from 'async';
import { z } from 'zod';

/**
 * Message Protocol Schemas
 * Defines all WebSocket message types and their validation schemas
 */

// ============================================================================
// SHARED SCHEMAS
// ============================================================================

/**
 * SD-JSON Model Schema
 * Accepts any model structure (CLD or SFD) with minimal validation
 * Uses catchall to allow additional fields defined by LLMWrapper schemas
 */
const SDVariableSchema = z.object({
  name: z.string(),
  type: z.string()
}).catchall(z.any());

const SDRelationshipSchema = z.object({
  from: z.string(),
  to: z.string()
}).catchall(z.any());

const FeedbackLoopSchema = z.object({
  identifier: z.string(),
  name: z.string(),
  links: z.array(z.object({
    from: z.string(),
    to: z.string(),
    polarity: z.string()
  })),
  polarity: z.string(),
  loopset: z.number().optional(),
  'Percent of Model Behavior Explained By Loop': z.array(z.object({
    time: z.number(),
    value: z.number()
  })).optional()
});

export const FeedbackContentSchema = z.object({
  feedbackLoops: z.array(FeedbackLoopSchema),
  dominantLoopsByPeriod: z.array(z.object({
    dominantLoops: z.array(z.string()),
    startTime: z.number(),
    endTime: z.number()
  })).optional()
}).describe('Feedback loop analysis data');

const RunSchema = z.object({
  id: z.any().describe('Unique identifier for the run'),
  name: z.string().describe('Display name for the run'),
  isExternal: z.boolean().optional().describe('Whether the run is from an external source'),
  variables: z.array(z.string()).optional().describe('Names of variables available in this run')
}).catchall(z.any());

export const GetRunInfoResponseSchema = z.object({
  runs: z.array(RunSchema).describe('List of simulation runs')
}).catchall(z.any());

export const SDModelSchema = z.object({
  variables: z.array(SDVariableSchema).optional(),
  relationships: z.array(SDRelationshipSchema).optional(),
  specs: z.record(z.string(), z.any()).optional(),
  modules: z.array(z.any()).optional(),
  errors: z.array(z.any()).optional(),
  explanation: z.string().optional(),
  title: z.string().optional()
}).catchall(z.any()).describe('SD-JSON model structure (CLD or SFD)');

export const GetCurrentModelResponseSchema = SDModelSchema;

export const UpdateModelResponseSchema = z.object({}).catchall(z.any())
  .describe('Response from the client after updating the model');

export const RunModelResponseSchema = z.object({
  runId: z.any().describe('ID of the completed simulation run')
}).catchall(z.any()).describe('Response from the client after running the model');

// ============================================================================
// CLIENT → SERVER MESSAGES
// ============================================================================

const ToolDefinitionSchema = z.object({
  name: z.string().describe('Unique name identifier for the tool'),
  description: z.string().describe('Human-readable description of what the tool does'),
  timeout: z.number().optional().describe('The number of miliseconds to wait for this tool to execute'),
  inputSchema: z.object({
    type: z.literal('object').describe('Schema type, must be "object"'),
    properties: z.record(z.string(), z.any()).describe('Map of parameter names to their schema definitions'),
    required: z.array(z.string()).optional().describe('Array of required parameter names')
  }).describe('JSON Schema defining the tool input parameters')
});

const HistoricalMessageSchema = z.object({
  type: z.enum(['agent_text', 'visualization', 'agent_complete', 'user_text']).describe('Type of historical message'),
  content: z.string().optional().describe('Text content (for agent_text, agent_complete, and user_text messages)'),
  isThinking: z.boolean().optional().describe('Whether this is thinking text (for agent_text messages)'),
  visualizationId: z.string().optional().describe('Unique ID for the visualization (for visualization messages)'),
  visualizationTitle: z.string().optional().describe('Title of the visualization (for visualization messages)'),
  visualizationDescription: z.string().optional().describe('Description of the visualization (for visualization messages)'),
  svgData: z.string().optional().describe('Image data (for visualization messages)'),
  status: z.string().optional().describe('Status for agent_complete messages')
}).catchall(z.any()).describe('Historical message from a previous session');

export const InitializeSessionMessageSchema = z.object({
  type: z.literal('initialize_session').describe('Message type identifier'),
  sessionId: z.string().optional().describe('Optional session ID to resume an existing session. If not provided, a new session will be created.'),
  authenticationKey: z.string().describe('Authentication key for server access'),
  clientProduct: z.string().describe('Client product name (e.g., "sd-web", "sd-desktop")'),
  clientVersion: z.string().describe('Client version (e.g., "1.0.0")'),
  clientId: z.string().describe('A unique identifier for the end user of this session.  Currently un-used'),
  mode: z.enum(['cld', 'sfd']).describe('Model type: CLD (Causal Loop Diagram) or SFD (Stock Flow Diagram). This cannot be changed during the session.'),
  model: SDModelSchema,
  tools: z.array(ToolDefinitionSchema).describe('Array of client-side tools available for the agent to call'),
  historicalMessages: z.array(HistoricalMessageSchema).optional().describe('Optional array of historical messages from a previous session to provide context'),
  context: z.record(z.string(), z.any()).optional().describe('Optional context information (metadata, user preferences, etc.)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

const SelectAgentMessageSchema = z.object({
  type: z.literal('select_agent').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  agentId: z.string().describe('Agent ID to use (e.g., "merlin", "socrates")'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ChatMessageSchema = z.object({
  type: z.literal('chat').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  message: z.string().describe('The user chat message text to send to the agent'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

const ToolCallResponseMessageSchema = z.object({
  type: z.literal('tool_call_response').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  callId: z.string().describe('The call ID from the tool_call_request being responded to'),
  result: z.any().describe('The result data from executing the tool, or error message if isError is true'),
  isError: z.boolean().optional().default(false).describe('Whether the tool execution resulted in an error'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ModelUpdatedNotificationSchema = z.object({
  type: z.literal('model_updated_notification').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  model: SDModelSchema,
  changeReason: z.string().describe('Human-readable explanation of why the model was updated'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

const StopIterationMessageSchema = z.object({
  type: z.literal('stop_iteration').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

const DisconnectMessageSchema = z.object({
  type: z.literal('disconnect').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier for the session to disconnect')
});

const ClientMessageSchema = z.discriminatedUnion('type', [
  InitializeSessionMessageSchema,
  SelectAgentMessageSchema,
  ChatMessageSchema,
  ToolCallResponseMessageSchema,
  ModelUpdatedNotificationSchema,
  StopIterationMessageSchema,
  DisconnectMessageSchema
]);

// ============================================================================
// MESSAGE VALIDATION HELPERS
// ============================================================================

export function validateClientMessage(message) {
  try {
    return {
      success: true,
      data: ClientMessageSchema.parse(message)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.errors
    };
  }
}

// ============================================================================
// MESSAGE BUILDERS
// ============================================================================

export function createSessionCreatedMessage(sessionId) {
  return {
    type: 'session_created',
    sessionId,
    timestamp: new Date().toISOString()
  };
}

export function createSessionReadyMessage(sessionId, availableAgents, defaults) {
  return {
    type: 'session_ready',
    sessionId,
    availableAgents,
    defaults,
    timestamp: new Date().toISOString()
  };
}

export function createAgentSelectedMessage(sessionId, agentId, agentName) {
  return {
    type: 'agent_selected',
    sessionId,
    agentId,
    agentName,
    timestamp: new Date().toISOString()
  };
}

export function createAgentTextMessage(sessionId, content, isThinking = false) {
  return {
    type: 'agent_text',
    sessionId,
    content,
    isThinking,
    timestamp: new Date().toISOString()
  };
}

export function createToolCallNotificationMessage(sessionId, callId, toolName, args, isBuiltIn) {
  return {
    type: 'tool_call_notification',
    sessionId,
    callId,
    toolName,
    arguments: args,
    isBuiltIn,
    timestamp: new Date().toISOString()
  };
}

export function createToolCallCompletedMessage(sessionId, callId, toolName, result, isError = false, responseType = null) {
  return {
    type: 'tool_call_completed',
    sessionId,
    callId,
    toolName,
    result,
    isError,
    ...(responseType && { responseType }),
    timestamp: new Date().toISOString()
  };
}

export function createAgentCompleteMessage(sessionId, status, finalMessage) {
  return {
    type: 'agent_complete',
    sessionId,
    finalMessage,
    status,
    timestamp: new Date().toISOString()
  };
}

export function createErrorMessage(sessionId, error, errorCode) {
  return {
    type: 'error',
    sessionId,
    error: typeof error === 'string' ? error : error.message,
    errorCode,
    timestamp: new Date().toISOString()
  };
}

export function createFeedbackRequestMessage(sessionId, requestId, runIds) {
  return {
    type: 'feedback_request',
    sessionId,
    requestId,
    runIds,
    timestamp: new Date().toISOString()
  };
}

export function createGetCurrentModelMessage(sessionId, requestId) {
  return {
    type: 'get_current_model',
    sessionId,
    requestId,
    timestamp: new Date().toISOString()
  };
}

export function createUpdateModelMessage(sessionId, requestId, modelData) {
  return {
    type: 'update_model',
    sessionId,
    requestId,
    modelData,
    timestamp: new Date().toISOString()
  };
}

export function createRunModelMessage(sessionId, requestId) {
  return {
    type: 'run_model',
    sessionId,
    requestId,
    timestamp: new Date().toISOString()
  };
}

export function createGetRunInfoMessage(sessionId, requestId) {
  return {
    type: 'get_run_info',
    sessionId,
    requestId,
    timestamp: new Date().toISOString()
  };
}

export function createGetVariableDataMessage(sessionId, requestId, variableNames, runIds, detailed) {
  return {
    type: 'get_variable_data',
    sessionId,
    requestId,
    variableNames,
    runIds,
    detailed,
    timestamp: new Date().toISOString()
  };
}
