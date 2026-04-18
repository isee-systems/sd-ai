import { AgentOrchestrator } from './AgentOrchestrator.js';
import {
  validateClientMessage,
  createSessionCreatedMessage,
  createSessionReadyMessage,
  createAgentSelectedMessage,
  createAgentTextMessage,
  createErrorMessage
} from './utilities/MessageProtocol.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readdirSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import logger from '../utilities/logger.js';
import utils from '../utilities/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Scan the config directory and return available agents
 */
function getAvailableAgents() {
  const configDir = join(__dirname, 'config');
  const agents = [];

  try {
    const files = readdirSync(configDir).filter(f => f.endsWith('.yaml'));

    for (const file of files) {
      try {
        const content = readFileSync(join(configDir, file), 'utf8');
        const config = yaml.load(content);

        if (config?.agent) {
          agents.push({
            id: file.replace('.yaml', ''),
            name: config.agent.name || file.replace('.yaml', ''),
            supports: config.agent.supports || [],
            description: config.agent.description || ''
          });
        }
      } catch (err) {
        logger.warn(`Failed to load agent config from ${file}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('Failed to scan agent config directory:', err);
  }

  // Hardcoded defaults - myrddin is the default agent for all model types
  const defaults = {
    sfd: 'myrddin',
    cld: 'myrddin'
  };

  return { agents, defaults };
}

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

        case 'select_agent':
          await handleSelectAgent(message);
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
          // Destroy orchestrator if it exists
          if (orchestrator) {
            orchestrator.destroy();
            orchestrator = null;
          }

          // Delete session (this cleans up pending calls, temp dirs, etc.)
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
      // Validate authentication key
      const authenticationKey = process.env.AUTHENTICATION_KEY;
      if (authenticationKey) {
        const expectedAuthKey = process.env.AUTHENTICATION_KEY;
        if (!expectedAuthKey || message.authenticationKey !== expectedAuthKey) {
          ws.close(1008, 'Unauthorized, please pass valid Authentication key.');
          return;
        }
      }

      // Validate client product and version
      if (!utils.supportedPlatform(message.clientProduct, message.clientVersion)) {
        ws.close(1008, 'Your client application is not currently supported.');
        return;
      }

      // Validate model type
      if (!message.modelType || !['cld', 'sfd'].includes(message.modelType)) {
        throw new Error('Invalid or missing modelType. Must be "cld" or "sfd".');
      }

      // Initialize session with model type, model, tools, and context
      sessionManager.initializeSession(
        sessionId,
        message.modelType,
        message.model,
        message.tools,
        message.context
      );

      // Process historical messages if provided
      if (message.historicalMessages && message.historicalMessages.length > 0) {
        for (const histMsg of message.historicalMessages) {
          let role = 'assistant'; // Default to assistant
          let content = '';

          switch (histMsg.type) {
            case 'user_text':
              role = 'user';
              content = histMsg.content || '';
              break;

            case 'agent_text':
              role = 'assistant';
              content = histMsg.content || '';
              break;

            case 'agent_complete':
              role = 'assistant';
              content = histMsg.content || '';
              break;

            case 'visualization':
              // For visualizations, create a summary message
              role = 'assistant';
              content = `[Created visualization: ${histMsg.visualizationTitle || 'Untitled'}]`;
              if (histMsg.visualizationDescription) {
                content += ` ${histMsg.visualizationDescription}`;
              }
              break;
          }

          if (content) {
            // Add to conversation history
            sessionManager.addToConversationHistory(sessionId, {
              role: role,
              content: content
            });
          }
        }

        logger.log(`Loaded ${message.historicalMessages.length} historical messages for session ${sessionId}`);
      }

      // Get available agents from config directory
      const { agents, defaults } = getAvailableAgents();

      // Send session ready with available agents and defaults
      await sendToClient(createSessionReadyMessage(sessionId, agents, defaults));

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

  // Handle select_agent (also handles switching agents mid-session)
  async function handleSelectAgent(message) {
    try {
      // Validate that the agent exists
      const { agents } = getAvailableAgents();
      const selectedAgent = agents.find(agent => agent.id === message.agentId);

      if (!selectedAgent) {
        throw new Error(`Agent '${message.agentId}' not found. Available agents: ${agents.map(a => a.id).join(', ')}`);
      }

      // Get the agent config path
      const configPath = join(__dirname, 'config', `${message.agentId}.yaml`);

      // Check if we're switching agents (orchestrator already exists)
      const isSwitching = orchestrator !== null;

      // Create new agent orchestrator (replaces existing if switching)
      orchestrator = new AgentOrchestrator(
        sessionManager,
        sessionId,
        sendToClient,
        configPath
      );

      // Get session to access tools
      const session = sessionManager.getSession(sessionId);

      // Send agent selected message
      await sendToClient(createAgentSelectedMessage(sessionId, selectedAgent.id, selectedAgent.name));

      // Send appropriate greeting message
      if (isSwitching) {
        await sendToClient(createAgentTextMessage(sessionId, `I've switched to ${selectedAgent.name}. How can I help you?`, false));
        logger.log(`Agent switched to: ${message.agentId} for session ${sessionId}`);
      } else {
        await sendToClient(createAgentTextMessage(sessionId, 'What can I do for you today?', false));
        logger.log(`Agent selected: ${message.agentId} for session ${sessionId}`);
      }

    } catch (error) {
      logger.error(`Failed to select agent for session ${sessionId}:`, error);
      await sendToClient(createErrorMessage(
        sessionId,
        `Agent selection failed: ${error.message}`,
        'AGENT_SELECTION_ERROR',
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

      // Start conversation
      const session = sessionManager.getSession(sessionId);
      await orchestrator.startConversation(
        message.message
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
        } else if (session?.pendingModelRequests?.has(message.callId)) {
          // Check if it's a model request response (get_current_model, update_model, run_model, get_run_info, get_variable_data)
          const pending = session.pendingModelRequests.get(message.callId);
          clearTimeout(pending.timeout);

          if (message.isError) {
            pending.reject(new Error(message.result));
          } else {
            pending.resolve(message.result);
          }

          session.pendingModelRequests.delete(message.callId);
          logger.log(`Resolved model request: ${message.callId}`);
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
      // Destroy orchestrator if it exists
      if (orchestrator) {
        orchestrator.destroy();
        orchestrator = null;
      }

      // Delete session (this cleans up pending calls, temp dirs, etc.)
      sessionManager.deleteSession(sessionId);
    }
  });

  // Handle error
  ws.on('error', (error) => {
    logger.error(`WebSocket error for session ${sessionId}:`, error);
    if (sessionId) {
      // Destroy orchestrator if it exists
      if (orchestrator) {
        orchestrator.destroy();
        orchestrator = null;
      }

      // Delete session (this cleans up pending calls, temp dirs, etc.)
      sessionManager.deleteSession(sessionId);
    }
  });
}
