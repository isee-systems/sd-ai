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
export const SDVariableSchema = z.object({
  name: z.string(),
  type: z.enum(["stock", "flow", "variable"])
}).catchall(z.any());

export const SDRelationshipSchema = z.object({
  from: z.string(),
  to: z.string()
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

/**
 * Feedback Content Schema
 * Used for feedback loop analysis data
 */
export const FeedbackContentSchema = z.object({
  feedbackLoops: z.array(z.object({
    identifier: z.string(),
    name: z.string(),
    links: z.array(z.object({
      from: z.string(),
      to: z.string(),
      polarity: z.enum(['+', '-', '?'])
    }).catchall(z.any())),
    polarity: z.enum(['+', '-', '?'])
  }).catchall(z.any())),
  dominantLoopsByPeriod: z.array(z.object({
    dominantLoops: z.array(z.string()),
    startTime: z.number(),
    endTime: z.number()
  })).optional()
}).catchall(z.any()).describe('Feedback loop analysis data including loops and optional dominant loops by period');

// ============================================================================
// CLIENT → SERVER MESSAGES
// ============================================================================

export const ToolDefinitionSchema = z.object({
  name: z.string().describe('Unique name identifier for the tool'),
  description: z.string().describe('Human-readable description of what the tool does'),
  inputSchema: z.object({
    type: z.literal('object').describe('Schema type, must be "object"'),
    properties: z.record(z.string(), z.any()).describe('Map of parameter names to their schema definitions'),
    required: z.array(z.string()).optional().describe('Array of required parameter names')
  }).describe('JSON Schema defining the tool input parameters')
});

export const HistoricalMessageSchema = z.object({
  type: z.enum(['agent_text', 'visualization', 'agent_complete', 'user_text']).describe('Type of historical message'),
  content: z.string().optional().describe('Text content (for agent_text, agent_complete, and user_text messages)'),
  isThinking: z.boolean().optional().describe('Whether this is thinking text (for agent_text messages)'),
  visualizationId: z.string().optional().describe('Unique ID for the visualization (for visualization messages)'),
  visualizationTitle: z.string().optional().describe('Title of the visualization (for visualization messages)'),
  visualizationDescription: z.string().optional().describe('Description of the visualization (for visualization messages)'),
  imageData: z.string().optional().describe('Base64-encoded image data (for visualization messages)'),
  status: z.string().optional().describe('Status for agent_complete messages')
}).describe('Historical message from a previous session');

export const InitializeSessionMessageSchema = z.object({
  type: z.literal('initialize_session').describe('Message type identifier'),
  sessionId: z.string().optional().describe('Optional session ID to resume an existing session. If not provided, a new session will be created.'),
  authenticationKey: z.string().describe('Authentication key for server access'),
  clientProduct: z.string().describe('Client product name (e.g., "sd-web", "sd-desktop")'),
  clientVersion: z.string().describe('Client version (e.g., "1.0.0")'),
  modelType: z.enum(['cld', 'sfd']).describe('Model type: CLD (Causal Loop Diagram) or SFD (Stock Flow Diagram). This cannot be changed during the session.'),
  model: SDModelSchema,
  tools: z.array(ToolDefinitionSchema).describe('Array of client-side tools available for the agent to call'),
  historicalMessages: z.array(HistoricalMessageSchema).optional().describe('Optional array of historical messages from a previous session to provide context'),
  context: z.record(z.string(), z.any()).optional().describe('Optional context information (metadata, user preferences, etc.)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const SelectAgentMessageSchema = z.object({
  type: z.literal('select_agent').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  agentId: z.string().describe('Agent ID to use (e.g., "myrddin", "ganos-lal")'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ChatMessageSchema = z.object({
  type: z.literal('chat').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  message: z.string().describe('The user chat message text to send to the agent'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ToolCallResponseMessageSchema = z.object({
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

export const StopIterationMessageSchema = z.object({
  type: z.literal('stop_iteration').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const DisconnectMessageSchema = z.object({
  type: z.literal('disconnect').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier for the session to disconnect')
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  InitializeSessionMessageSchema,
  SelectAgentMessageSchema,
  ChatMessageSchema,
  ToolCallResponseMessageSchema,
  ModelUpdatedNotificationSchema,
  StopIterationMessageSchema,
  DisconnectMessageSchema
]);

// ============================================================================
// SERVER → CLIENT MESSAGES
// ============================================================================

export const SessionCreatedMessageSchema = z.object({
  type: z.literal('session_created').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier for the newly created session'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const SessionReadyMessageSchema = z.object({
  type: z.literal('session_ready').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  availableAgents: z.array(z.object({
    id: z.string().describe('Unique agent identifier'),
    name: z.string().describe('Human-readable agent name'),
    description: z.string().describe('Description of the agent capabilities and personality')
  })).describe('List of available agents the client can select from'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const AgentSelectedMessageSchema = z.object({
  type: z.literal('agent_selected').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  agentId: z.string().describe('The ID of the agent that was selected'),
  agentName: z.string().describe('The human-readable name of the agent that was selected'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const AgentTextMessageSchema = z.object({
  type: z.literal('agent_text').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  content: z.string().describe('The text content from the agent (response, explanation, or thinking process)'),
  isThinking: z.boolean().optional().default(false).describe('Whether this is thinking/reasoning text (true) or final response text (false)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ToolCallNotificationMessageSchema = z.object({
  type: z.literal('tool_call_notification').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  callId: z.string().describe('Unique identifier for this tool call'),
  toolName: z.string().describe('Name of the tool being called'),
  arguments: z.record(z.any()).describe('Map of argument names to values being passed to the tool'),
  isBuiltIn: z.boolean().describe('Whether this is a built-in tool (true) or client tool (false)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ToolCallRequestMessageSchema = z.object({
  type: z.literal('tool_call_request').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  callId: z.string().describe('Unique identifier for this tool call, used to match with the response'),
  toolName: z.string().describe('Name of the client tool to execute'),
  arguments: z.record(z.any()).describe('Map of argument names to values to pass to the tool'),
  timeout: z.number().optional().default(30000).describe('Timeout for client tool execution in milliseconds'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ToolCallCompletedMessageSchema = z.object({
  type: z.literal('tool_call_completed').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  callId: z.string().describe('The call ID from the tool_call_request or tool_call_notification'),
  toolName: z.string().describe('Name of the tool that was executed'),
  result: z.any().describe('The result data from the tool execution, or error message if isError is true'),
  isError: z.boolean().optional().default(false).describe('Whether the tool execution resulted in an error'),
  responseType: z.enum(['model', 'discuss', 'ltm-discuss', 'other']).optional().describe('Type of response: model (model generation), discuss (Seldon discussion), ltm-discuss (LTM narrative), or other'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const VisualizationMessageSchema = z.object({
  type: z.literal('visualization').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  visualizationId: z.string().describe('Unique identifier for this visualization'),
  title: z.string().describe('Human-readable title of the visualization'),
  description: z.string().optional().describe('Optional detailed description of what the visualization shows'),
  format: z.literal('image').describe('Visualization format: image (base64-encoded static image)'),
  data: z.object({
    encoding: z.literal('base64').describe('Image encoding type'),
    mimeType: z.string().describe('MIME type of the image (e.g., "image/png")'),
    content: z.string().describe('Base64-encoded image data'),
    width: z.number().describe('Image width in pixels'),
    height: z.number().describe('Image height in pixels')
  }).describe('Image visualization data'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const AgentCompleteMessageSchema = z.object({
  type: z.literal('agent_complete').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  finalMessage: z.string().optional().describe('Optional final message from the agent summarizing the completion'),
  status: z.enum(['success', 'error', 'awaiting_user']).describe('Completion status: success (task completed), error (failed), or awaiting_user (waiting for user input)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  error: z.string().describe('Human-readable error message'),
  errorCode: z.string().optional().describe('Optional machine-readable error code for categorizing the error'),
  recoverable: z.boolean().optional().default(true).describe('Whether the error is recoverable (session can continue) or fatal (session must end)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const FeedbackRequestMessageSchema = z.object({
  type: z.literal('feedback_request').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  requestId: z.string().describe('Unique request identifier for tracking the response'),
  runIds: z.array(z.string()).describe('List of simulation run IDs to get feedback for. Empty array means the current/most recent run.'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const GetCurrentModelMessageSchema = z.object({
  type: z.literal('get_current_model').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  requestId: z.string().describe('Unique request identifier for tracking the response'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const UpdateModelMessageSchema = z.object({
  type: z.literal('update_model').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  requestId: z.string().describe('Unique request identifier for tracking the response'),
  modelData: z.any().describe('The model data to update in the client (can be complete model or partial update)'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const RunModelMessageSchema = z.object({
  type: z.literal('run_model').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  requestId: z.string().describe('Unique request identifier for tracking the response'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const GetRunInfoMessageSchema = z.object({
  type: z.literal('get_run_info').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  requestId: z.string().describe('Unique request identifier for tracking the response'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const GetVariableDataMessageSchema = z.object({
  type: z.literal('get_variable_data').describe('Message type identifier'),
  sessionId: z.string().describe('Unique session identifier'),
  requestId: z.string().describe('Unique request identifier for tracking the response'),
  variableNames: z.array(z.string()).describe('List of variable names to get data for'),
  runIds: z.array(z.string()).describe('List of run IDs to get variable data from'),
  timestamp: z.string().optional().describe('ISO 8601 timestamp of when the message was created')
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  SessionCreatedMessageSchema,
  SessionReadyMessageSchema,
  AgentSelectedMessageSchema,
  AgentTextMessageSchema,
  ToolCallNotificationMessageSchema,
  ToolCallRequestMessageSchema,
  ToolCallCompletedMessageSchema,
  VisualizationMessageSchema,
  FeedbackRequestMessageSchema,
  GetCurrentModelMessageSchema,
  UpdateModelMessageSchema,
  RunModelMessageSchema,
  GetRunInfoMessageSchema,
  GetVariableDataMessageSchema,
  AgentCompleteMessageSchema,
  ErrorMessageSchema
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

export function validateServerMessage(message) {
  try {
    return {
      success: true,
      data: ServerMessageSchema.parse(message)
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

export function createToolCallRequestMessage(sessionId, callId, toolName, args, timeout = 30000) {
  return {
    type: 'tool_call_request',
    sessionId,
    callId,
    toolName,
    arguments: args,
    timeout,
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

export function createVisualizationMessage(sessionId, vizId, title, data, description = undefined) {
  return {
    type: 'visualization',
    sessionId,
    visualizationId: vizId,
    title,
    ...(description && { description }),
    format: 'image',
    data,
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

export function createErrorMessage(sessionId, error, errorCode, recoverable = true) {
  return {
    type: 'error',
    sessionId,
    error: typeof error === 'string' ? error : error.message,
    errorCode,
    recoverable,
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

export function createGetVariableDataMessage(sessionId, requestId, variableNames, runIds) {
  return {
    type: 'get_variable_data',
    sessionId,
    requestId,
    variableNames,
    runIds,
    timestamp: new Date().toISOString()
  };
}
