import { AgentOrchestrator } from './AgentOrchestrator.js';
import {
  validateClientMessage,
  createSessionCreatedMessage,
  createSessionReadyMessage,
  createErrorMessage
} from './utilities/MessageProtocol.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from '../utilities/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Handle WebSocket connection
 * Sets up message handlers and manages agent lifecycle
 */
export function handleWebSocketConnection(ws, sessionManager) {
  let sessionId = null;
  let orchestrator = null;

  // Create session
  try {
    sessionId = sessionManager.createSession(ws);

    // Send session created message
    const sessionCreatedMsg = createSessionCreatedMessage(sessionId);
    ws.send(JSON.stringify(sessionCreatedMsg));

    logger.log(`WebSocket connected: ${sessionId}`);
  } catch (error) {
    logger.error('Failed to create session:', error);
    ws.close(1011, error.message);
    return;
  }

  // Helper to send messages to client
  const sendToClient = async (message) => {
    if (ws.readyState === 1) {  // OPEN
      ws.send(JSON.stringify(message));
    }
  };

  // Message handler
  ws.on('message', async (data) => {
    try {
      // Parse message
      const rawMessage = JSON.parse(data.toString());

      // Validate message
      const validation = validateClientMessage(rawMessage);
      if (!validation.success) {
        await sendToClient(createErrorMessage(
          sessionId,
          `Invalid message: ${validation.error}`,
          'INVALID_MESSAGE',
          true
        ));
        return;
      }

      const message = validation.data;

      // Handle different message types
      switch (message.type) {
        case 'initialize_session':
          await handleInitializeSession(message);
          break;

        case 'chat':
          await handleChat(message);
          break;

        case 'tool_call_response':
          await handleToolCallResponse(message);
          break;

        case 'model_updated_notification':
          await handleModelUpdated(message);
          break;

        case 'disconnect':
          sessionManager.deleteSession(sessionId);
          ws.close(1000, 'Client requested disconnect');
          break;

        default:
          await sendToClient(createErrorMessage(
            sessionId,
            `Unknown message type: ${message.type}`,
            'UNKNOWN_MESSAGE_TYPE',
            true
          ));
      }
    } catch (error) {
      logger.error(`Error handling message for session ${sessionId}:`, error);
      await sendToClient(createErrorMessage(
        sessionId,
        error.message,
        'MESSAGE_PROCESSING_ERROR',
        true
      ));
    }
  });

  // Handle initialize_session
  async function handleInitializeSession(message) {
    try {
      // Validate model type
      if (!message.modelType || !['cld', 'sfd'].includes(message.modelType)) {
        throw new Error('Invalid or missing modelType. Must be "cld" or "sfd".');
      }

      // Initialize session with model type, model, tools, and config
      sessionManager.initializeSession(
        sessionId,
        message.modelType,
        message.model,
        message.tools,
        message.sessionConfig,
        message.context
      );

      // Get agent ID from session config, default to myrddin
      const agentId = message.sessionConfig?.agentId || 'myrddin';
      const configPath = join(__dirname, 'config', `${agentId}.yaml`);

      // Create agent orchestrator
      orchestrator = new AgentOrchestrator(
        sessionManager,
        sessionId,
        sendToClient,
        configPath
      );

      // Initialize tools
      orchestrator.initializeTools(message.tools);

      // Get capabilities
      const capabilities = orchestrator.getAgentCapabilities();

      // Send session ready
      await sendToClient(createSessionReadyMessage(sessionId, capabilities));

      logger.log(`Session initialized: ${sessionId}`);
    } catch (error) {
      logger.error(`Failed to initialize session ${sessionId}:`, error);
      await sendToClient(createErrorMessage(
        sessionId,
        `Initialization failed: ${error.message}`,
        'INITIALIZATION_ERROR',
        false
      ));
    }
  }

  // Handle chat
  async function handleChat(message) {
    try {
      if (!orchestrator) {
        throw new Error('Session not initialized. Send initialize_session first.');
      }

      // Set runtime directives if present
      if (message.directives) {
        orchestrator.setRuntimeDirectives(message.directives);
      }

      // Start conversation
      const session = sessionManager.getSession(sessionId);
      await orchestrator.startConversation(
        message.message,
        session.sessionConfig
      );

    } catch (error) {
      logger.error(`Error in chat for session ${sessionId}:`, error);
      await sendToClient(createErrorMessage(
        sessionId,
        error.message,
        'CHAT_ERROR',
        true
      ));
    }
  }

  // Handle tool_call_response
  async function handleToolCallResponse(message) {
    try {
      // First try to resolve as a regular tool call
      const resolved = sessionManager.resolvePendingToolCall(
        sessionId,
        message.callId,
        message.result,
        message.isError
      );

      // If not a regular tool call, check if it's a feedback request response
      if (!resolved) {
        const session = sessionManager.getSession(sessionId);
        if (session?.pendingFeedbackRequests?.has(message.callId)) {
          const pending = session.pendingFeedbackRequests.get(message.callId);
          clearTimeout(pending.timeout);

          if (message.isError) {
            pending.reject(new Error(message.result));
          } else {
            pending.resolve(message.result);
          }

          session.pendingFeedbackRequests.delete(message.callId);
          logger.log(`Resolved feedback request: ${message.callId}`);
        } else {
          logger.warn(`Received response for unknown call ID: ${message.callId}`);
        }
      }
    } catch (error) {
      logger.error(`Error handling tool response for session ${sessionId}:`, error);
      await sendToClient(createErrorMessage(
        sessionId,
        error.message,
        'TOOL_RESPONSE_ERROR',
        true
      ));
    }
  }

  // Handle model_updated_notification
  async function handleModelUpdated(message) {
    try {
      // Update session with new model
      sessionManager.updateClientModel(sessionId, message.model);

      logger.log(`Model updated for session ${sessionId}: ${message.changeReason}`);
    } catch (error) {
      logger.error(`Error updating model for session ${sessionId}:`, error);
    }
  }

  // Handle close
  ws.on('close', (code, reason) => {
    logger.log(`WebSocket closed: ${sessionId} (code: ${code}, reason: ${reason})`);
    if (sessionId) {
      sessionManager.deleteSession(sessionId);
    }
  });

  // Handle error
  ws.on('error', (error) => {
    logger.error(`WebSocket error for session ${sessionId}:`, error);
    if (sessionId) {
      sessionManager.deleteSession(sessionId);
    }
  });
}
