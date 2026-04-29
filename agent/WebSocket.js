import { WorkerSpawner } from './WorkerSpawner.js';
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
import logger from '../utilities/logger.js';
import utils from '../utilities/utils.js';
import config from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);
  if (!match) return {};

  const metadata = {};
  const lines = match[1].split('\n');
  let currentArray = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('- ') && currentArray) {
      currentArray.push(trimmed.substring(2).trim());
    } else if (trimmed.includes(':')) {
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      if (value === '') {
        currentArray = [];
        metadata[key] = currentArray;
      } else {
        let parsedValue = value.replace(/^["']|["']$/g, '');
        if (!isNaN(parsedValue) && parsedValue !== '') parsedValue = Number(parsedValue);
        metadata[key] = parsedValue;
        currentArray = null;
      }
    }
  }

  return metadata;
}

function getAvailableAgents() {
  const configDir = join(__dirname, 'config');
  const agents = [];

  try {
    const files = readdirSync(configDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = readFileSync(join(configDir, file), 'utf8');
        const metadata = parseFrontmatter(content);

        if (metadata?.name) {
          agents.push({
            id: file.replace('.md', ''),
            name: metadata.name || file.replace('.md', ''),
            role: metadata.role || 'Agent',
            supportedModes: metadata.supported_modes || [],
            description: metadata.description || ''
          });
        }
      } catch (err) {
        logger.warn(`Failed to load agent config from ${file}:`, err.message);
      }
    }
  } catch (err) {
    logger.error('Failed to scan agent config directory:', err);
  }

  // Hardcoded defaults - socrates is the default agent for all model types
  const defaults = {
    sfd: 'socrates',
    cld: 'socrates'
  };

  return { agents, defaults };
}

export class WebSocketHandler {
  #ws;
  #sessionManager;
  #sessionId = null;
  #worker = null;
  // True on the first chat message after a select_agent — tells worker to bridge context
  #pendingAgentSwitch = false;

  constructor(ws, sessionManager) {
    this.#ws = ws;
    this.#sessionManager = sessionManager;
    this.#setup();
  }

  #setup() {
    try {
      this.#sessionId = this.#sessionManager.createSession(this.#ws);
      this.#ws.send(JSON.stringify(createSessionCreatedMessage(this.#sessionId)));
      logger.log(`WebSocket connected: ${this.#sessionId}`);
    } catch (error) {
      logger.error('Failed to create session:', error);
      this.#ws.close(1011, error.message);
      return;
    }

    this.#ws.on('message', (data) => this.#onMessage(data));
    this.#ws.on('close', (code, reason) => this.#onClose(code, reason));
    this.#ws.on('error', (error) => this.#onError(error));
  }

  async #sendToClient(message) {
    if (this.#ws.readyState === 1) {
      this.#ws.send(JSON.stringify(message));
    }
  }

  async #onMessage(data) {
    try {
      const rawMessage = JSON.parse(data.toString());
      const validation = validateClientMessage(rawMessage);
      if (!validation.success) {
        await this.#sendToClient(createErrorMessage(this.#sessionId, `Invalid message: ${validation.error}`, 'INVALID_MESSAGE'));
        return;
      }

      const message = validation.data;

      switch (message.type) {
        case 'initialize_session':
          await this.#handleInitializeSession(message);
          break;
        case 'select_agent':
          await this.#handleSelectAgent(message);
          break;
        case 'chat':
          await this.#handleChat(message);
          break;
        case 'tool_call_response':
          await this.#handleToolCallResponse(message);
          break;
        case 'model_updated_notification':
          await this.#handleModelUpdated(message);
          break;
        case 'stop_iteration':
          await this.#handleStopIteration(message);
          break;
        case 'disconnect':
          this.#killWorker();
          this.#sessionManager.deleteSession(this.#sessionId);
          this.#ws.close(1000, 'Client requested disconnect');
          break;
        default:
          await this.#sendToClient(createErrorMessage(this.#sessionId, `Unknown message type: ${message.type}`, 'UNKNOWN_MESSAGE_TYPE'));
      }
    } catch (error) {
      logger.error(`Error handling message for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, error.message, 'MESSAGE_PROCESSING_ERROR'));
    }
  }

  async #handleInitializeSession(message) {
    try {
      const authenticationKey = process.env.AUTHENTICATION_KEY;
      if (authenticationKey) {
        if (message.authenticationKey !== authenticationKey) {
          this.#ws.close(1008, 'Unauthorized, please pass valid Authentication key.');
          return;
        }
      }

      if (!utils.supportedPlatform(message.clientProduct, message.clientVersion)) {
        this.#ws.close(1008, 'Your client application is not currently supported.');
        return;
      }

      if (!message.mode || !['cld', 'sfd'].includes(message.mode)) {
        throw new Error('Invalid or missing mode. Must be "cld" or "sfd".');
      }

      this.#sessionManager.initializeSession(this.#sessionId, message.mode, message.model, message.tools, message.context);

      if (message.historicalMessages && message.historicalMessages.length > 0) {
        for (const histMsg of message.historicalMessages) {
          let role = 'assistant';
          let content = '';

          switch (histMsg.type) {
            case 'user_text':
              role = 'user';
              content = histMsg.content || '';
              break;
            case 'agent_text':
            case 'agent_complete':
              role = 'assistant';
              content = histMsg.content || '';
              break;
            case 'visualization':
              role = 'assistant';
              content = `[Created visualization: ${histMsg.visualizationTitle || 'Untitled'}]`;
              if (histMsg.visualizationDescription) content += ` ${histMsg.visualizationDescription}`;
              break;
          }

          if (content) {
            this.#sessionManager.addToConversationHistory(this.#sessionId, { role, content });
          }
        }

        await this.#sessionManager.cleanupContext(this.#sessionId, config.agentMaxContextTokens);
        logger.log(`Loaded ${message.historicalMessages.length} historical messages for session ${this.#sessionId}`);
      }

      const { agents, defaults } = getAvailableAgents();
      await this.#sendToClient(createSessionReadyMessage(this.#sessionId, agents, defaults));
      logger.log(`Session initialized: ${this.#sessionId}`);
    } catch (error) {
      logger.error(`Failed to initialize session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, `Initialization failed: ${error.message}`, 'INITIALIZATION_ERROR'));
    }
  }

  async #handleSelectAgent(message) {
    try {
      const { agents } = getAvailableAgents();
      const selectedAgent = agents.find(agent => agent.id === message.agentId);

      if (!selectedAgent) {
        throw new Error(`Agent '${message.agentId}' not found. Available agents: ${agents.map(a => a.id).join(', ')}`);
      }

      const isSwitching = this.#worker !== null;

      // When switching agents, ask the running worker for its current conversation
      // history so the new worker can bridge context across the handoff.
      let conversationHistory = this.#sessionManager.getConversationContext(this.#sessionId);
      if (isSwitching) {
        try {
          conversationHistory = await this.#getWorkerContext(this.#worker);
        } catch (err) {
          logger.warn(`[session:${this.#sessionId}] Could not retrieve context from old worker: ${err.message}`);
        }
        this.#killWorker();
      }

      const tempDir = this.#sessionManager.getSessionTempDir(this.#sessionId);
      this.#worker = WorkerSpawner.spawn(this.#sessionId, tempDir);
      this.#setupWorkerRelay(this.#worker);

      const session = this.#sessionManager.getSession(this.#sessionId);
      this.#worker.send({
        type: 'initialize',
        mode: session.mode,
        model: session.clientModel,
        tools: session.clientTools,
        context: session.context,
        conversationHistory,
        isAgentSwitch: isSwitching,
      });

      this.#worker.send({ type: 'select_agent', agentId: message.agentId });
      this.#pendingAgentSwitch = isSwitching;

      await this.#sendToClient(createAgentSelectedMessage(this.#sessionId, selectedAgent.id, selectedAgent.name));
      if (isSwitching) {
        await this.#sendToClient(createAgentTextMessage(this.#sessionId, `I've switched to ${selectedAgent.name}. How can I help you?`, false));
        logger.log(`Agent switched to: ${message.agentId} for session ${this.#sessionId}`);
      } else {
        await this.#sendToClient(createAgentTextMessage(this.#sessionId, 'What can I do for you today?', false));
        logger.log(`Agent selected: ${message.agentId} for session ${this.#sessionId}`);
      }
    } catch (error) {
      logger.error(`Failed to select agent for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, `Agent selection failed: ${error.message}`, 'AGENT_SELECTION_ERROR'));
    }
  }

  async #handleChat(message) {
    try {
      if (!this.#worker) {
        throw new Error('No agent selected. Send select_agent first.');
      }
      this.#worker.send({ type: 'chat', message: message.message });
      // isAgentSwitch flag is carried in the worker's own pendingIsAgentSwitch state,
      // set during initialize — no need to pass it again here.
      this.#pendingAgentSwitch = false;
    } catch (error) {
      logger.error(`Error in chat for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, error.message, 'CHAT_ERROR'));
    }
  }

  // Forward to worker which owns all pending promise maps
  async #handleToolCallResponse(message) {
    try {
      if (!this.#worker) {
        logger.warn(`Received tool_call_response for ${message.callId} but no worker is running`);
        return;
      }
      this.#worker.send({
        type: 'tool_response',
        callId: message.callId,
        result: message.result,
        isError: message.isError,
      });
    } catch (error) {
      logger.error(`Error forwarding tool response for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, error.message, 'TOOL_RESPONSE_ERROR'));
    }
  }

  async #handleModelUpdated(message) {
    try {
      // Keep main-process SessionManager in sync (used to initialize new workers on agent switch)
      this.#sessionManager.updateClientModel(this.#sessionId, message.model);
      // Forward to worker so AgentOrchestrator sees the updated model token count
      this.#worker?.send({ type: 'model_updated', model: message.model });
      logger.log(`Model updated for session ${this.#sessionId}: ${message.changeReason}`);
    } catch (error) {
      logger.error(`Error updating model for session ${this.#sessionId}:`, error);
    }
  }

  async #handleStopIteration() {
    try {
      if (!this.#worker) {
        throw new Error('No active agent to stop');
      }
      logger.log(`Stop iteration requested for session ${this.#sessionId}`);
      this.#worker.send({ type: 'stop' });
    } catch (error) {
      logger.error(`Error stopping iteration for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, error.message, 'STOP_ITERATION_ERROR'));
    }
  }

  #onClose(code, reason) {
    logger.log(`WebSocket closed: ${this.#sessionId} (code: ${code}, reason: ${reason})`);
    if (this.#sessionId) {
      this.#killWorker();
      this.#sessionManager.deleteSession(this.#sessionId);
    }
  }

  #onError(error) {
    logger.error(`WebSocket error for session ${this.#sessionId}:`, error);
    if (this.#sessionId) {
      this.#killWorker();
      this.#sessionManager.deleteSession(this.#sessionId);
    }
  }

  #killWorker() {
    if (this.#worker) {
      this.#worker.send({ type: 'shutdown' });
      // Give it a moment to exit cleanly; force-kill if it doesn't
      const w = this.#worker;
      const t = setTimeout(() => w.kill('SIGKILL'), 2000);
      this.#worker.once('exit', () => clearTimeout(t));
      this.#worker = null;
    }
  }

  /**
   * Wire up the IPC relay for a freshly spawned worker.
   * - Forwards all to_client messages to the WebSocket.
   * - Logs worker stdout/stderr.
   * - Cleans up on unexpected exit.
   */
  #setupWorkerRelay(w) {
    w.on('message', async (msg) => {
      if (msg.type === 'to_client') {
        if (this.#ws.readyState === 1) this.#ws.send(JSON.stringify(msg.message));
      } else if (msg.type === 'worker_error') {
        logger.error(`[worker:${this.#sessionId}] ${msg.error}`);
      }
      // context_response is handled inside #getWorkerContext via its own listener
    });

    w.stdout?.on('data', (d) => logger.log(`[worker:${this.#sessionId}] ${d.toString().trim()}`));
    w.stderr?.on('data', (d) => logger.error(`[worker:${this.#sessionId}] ${d.toString().trim()}`));

    w.on('exit', (code, signal) => {
      logger.log(`[worker:${this.#sessionId}] exited (code=${code} signal=${signal})`);
      if (this.#worker === w) this.#worker = null;
    });
  }

  /**
   * Ask a running worker for its current conversation context.
   * Returns a promise that resolves with the history array.
   */
  #getWorkerContext(w) {
    return new Promise((resolve, reject) => {
      const requestId = `ctx_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        w.off('message', handler);
        reject(new Error('Context request timed out'));
      }, 5000);

      function handler(msg) {
        if (msg.type === 'context_response' && msg.requestId === requestId) {
          clearTimeout(timeout);
          w.off('message', handler);
          resolve(msg.context);
        }
      }

      w.on('message', handler);
      w.send({ type: 'get_context', requestId });
    });
  }
}
