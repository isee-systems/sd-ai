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
 * Uses passthrough to allow additional fields defined by LLMWrapper schemas
 */
export const SDModelSchema = z.object({
  variables: z.array(z.any()).optional(),
  relationships: z.array(z.any()).optional(),
  specs: z.object({}).passthrough().optional(),
  modules: z.array(z.any()).optional(),
  explanation: z.string().optional(),
  title: z.string().optional()
}).passthrough().describe('SD-JSON model structure (CLD or SFD)');

// ============================================================================
// CLIENT → SERVER MESSAGES
// ============================================================================

export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal('object'),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional()
  })
});

export const InitializeSessionMessageSchema = z.object({
  type: z.literal('initialize_session'),
  sessionId: z.string().optional(),
  authenticationKey: z.string().describe('Authentication key for server access'),
  clientProduct: z.string().describe('Client product name (e.g., "sd-web", "sd-desktop")'),
  clientVersion: z.string().describe('Client version (e.g., "1.0.0")'),
  modelType: z.enum(['cld', 'sfd']).describe('Model type: CLD (Causal Loop Diagram) or SFD (Stock Flow Diagram). This cannot be changed during the session.'),
  model: SDModelSchema,
  tools: z.array(ToolDefinitionSchema),
  context: z.record(z.any()).optional(),
  timestamp: z.string().optional()
});

export const SelectAgentMessageSchema = z.object({
  type: z.literal('select_agent'),
  sessionId: z.string(),
  agentId: z.string().describe('Agent ID to use (e.g., "myrddin", "ganos-lal")'),
  timestamp: z.string().optional()
});

export const ChatMessageSchema = z.object({
  type: z.literal('chat'),
  sessionId: z.string(),
  message: z.string(),
  timestamp: z.string().optional()
});

export const ToolCallResponseMessageSchema = z.object({
  type: z.literal('tool_call_response'),
  sessionId: z.string(),
  callId: z.string(),
  result: z.any(),
  isError: z.boolean().optional().default(false),
  timestamp: z.string().optional()
});

export const ModelUpdatedNotificationSchema = z.object({
  type: z.literal('model_updated_notification'),
  sessionId: z.string(),
  model: SDModelSchema,
  changeReason: z.string(),
  timestamp: z.string().optional()
});

export const DisconnectMessageSchema = z.object({
  type: z.literal('disconnect'),
  sessionId: z.string()
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  InitializeSessionMessageSchema,
  SelectAgentMessageSchema,
  ChatMessageSchema,
  ToolCallResponseMessageSchema,
  ModelUpdatedNotificationSchema,
  DisconnectMessageSchema
]);

// ============================================================================
// SERVER → CLIENT MESSAGES
// ============================================================================

export const SessionCreatedMessageSchema = z.object({
  type: z.literal('session_created'),
  sessionId: z.string(),
  timestamp: z.string().optional()
});

export const SessionReadyMessageSchema = z.object({
  type: z.literal('session_ready'),
  sessionId: z.string(),
  availableAgents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string()
  })),
  timestamp: z.string().optional()
});

export const AgentSelectedMessageSchema = z.object({
  type: z.literal('agent_selected'),
  sessionId: z.string(),
  agentId: z.string(),
  agentName: z.string(),
  timestamp: z.string().optional()
});

export const AgentTextMessageSchema = z.object({
  type: z.literal('agent_text'),
  sessionId: z.string(),
  content: z.string(),
  isThinking: z.boolean().optional().default(false),
  timestamp: z.string().optional()
});

export const ToolCallNotificationMessageSchema = z.object({
  type: z.literal('tool_call_notification'),
  sessionId: z.string(),
  callId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.any()),
  isBuiltIn: z.boolean().describe('Whether this is a built-in tool (true) or client tool (false)'),
  timestamp: z.string().optional()
});

export const ToolCallRequestMessageSchema = z.object({
  type: z.literal('tool_call_request'),
  sessionId: z.string(),
  callId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.any()),
  timeout: z.number().optional().default(30000).describe('Timeout for client tool execution in milliseconds'),
  timestamp: z.string().optional()
});

export const ToolCallCompletedMessageSchema = z.object({
  type: z.literal('tool_call_completed'),
  sessionId: z.string(),
  callId: z.string(),
  toolName: z.string(),
  result: z.any(),
  isError: z.boolean().optional().default(false),
  responseType: z.enum(['model', 'discuss', 'ltm-discuss', 'other']).optional(),
  timestamp: z.string().optional()
});

export const VisualizationMessageSchema = z.object({
  type: z.literal('visualization'),
  sessionId: z.string(),
  visualizationId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  format: z.enum(['plotly', 'image', 'vega']),
  data: z.union([
    // Plotly format
    z.object({
      data: z.array(z.any()),
      layout: z.record(z.any()),
      config: z.record(z.any()).optional()
    }),
    // Image format
    z.object({
      encoding: z.literal('base64'),
      mimeType: z.string(),
      content: z.string(),
      width: z.number(),
      height: z.number()
    })
  ]),
  thumbnail: z.string().optional(),
  metadata: z.object({
    createdBy: z.string(),
    runId: z.string().optional(),
    variables: z.array(z.string()).optional(),
    timeRange: z.object({
      start: z.number(),
      end: z.number()
    }).optional()
  }).optional(),
  timestamp: z.string().optional()
});

export const AgentCompleteMessageSchema = z.object({
  type: z.literal('agent_complete'),
  sessionId: z.string(),
  finalMessage: z.string().optional(),
  status: z.enum(['success', 'error', 'awaiting_user']),
  timestamp: z.string().optional()
});

export const ErrorMessageSchema = z.object({
  type: z.literal('error'),
  sessionId: z.string(),
  error: z.string(),
  errorCode: z.string().optional(),
  recoverable: z.boolean().optional().default(true),
  timestamp: z.string().optional()
});

export const ShowIntermediateModelMessageSchema = z.object({
  type: z.literal('show_intermediate_model'),
  sessionId: z.string(),
  modelType: z.enum(['cld', 'sfd']),
  model: SDModelSchema,
  purpose: z.string().describe('Why this intermediate model is being shown'),
  displayMode: z.enum(['separate_window', 'inline', 'background']).describe('How the client should display this'),
  timestamp: z.string().optional()
});

export const FeedbackRequestMessageSchema = z.object({
  type: z.literal('feedback_request'),
  sessionId: z.string(),
  requestId: z.string(),
  runId: z.string().optional().describe('Simulation run ID for single-run feedback'),
  comparative: z.boolean().optional().default(false).describe('Whether to request comparative feedback for all runs'),
  timestamp: z.string().optional()
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
  ShowIntermediateModelMessageSchema,
  FeedbackRequestMessageSchema,
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

export function createSessionReadyMessage(sessionId, availableAgents) {
  return {
    type: 'session_ready',
    sessionId,
    availableAgents,
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

export function createVisualizationMessage(sessionId, vizId, title, format, data, options = {}) {
  return {
    type: 'visualization',
    sessionId,
    visualizationId: vizId,
    title,
    description: options.description,
    format,
    data,
    thumbnail: options.thumbnail,
    metadata: options.metadata,
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

export function createShowIntermediateModelMessage(sessionId, modelType, model, purpose, displayMode = 'separate_window') {
  return {
    type: 'show_intermediate_model',
    sessionId,
    modelType,
    model,
    purpose,
    displayMode,
    timestamp: new Date().toISOString()
  };
}

export function createFeedbackRequestMessage(sessionId, requestId, runId = null, comparative = false) {
  return {
    type: 'feedback_request',
    sessionId,
    requestId,
    ...(runId && { runId }),
    comparative,
    timestamp: new Date().toISOString()
  };
}
