import { WorkerSpawner } from './WorkerSpawner.js';
import { AgentConfigurationManager } from './utilities/AgentConfigurationManager.js';
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
import { ProviderDisplayNames } from '../utilities/TokenUsageReporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getAvailableAgents() {
  const configDir = join(__dirname, 'config');
  const agents = [];

  try {
    const files = readdirSync(configDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const content = readFileSync(join(configDir, file), 'utf8');
        const metadata = AgentConfigurationManager.parseContent(content).metadata;

        if (metadata?.name) {
          agents.push({
            id: file.replace('.md', ''),
            name: metadata.name || file.replace('.md', ''),
            role: metadata.role || 'Agent',
            supportedModes: metadata.supported_modes || [],
            supportedProviders: (metadata.supported_providers?.length ? metadata.supported_providers : ['anthropic', 'google'])
              .map(id => ({ id, name: ProviderDisplayNames[id] ?? id })),
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

// Registry of all live worker processes so signal handlers can kill them all.
const liveWorkers = new Set();

// Kill a worker and all its descendant processes.
//
// IpcWorker (bwrap sandbox): w.pid is undefined. We kill only the bwrap process;
// the kernel kills everything in the PID namespace when its init (bwrap) exits.
//
// ChildProcess (fork fallback): w.pid is a number. The fork is spawned with
// detached:true so it leads its own process group. Killing the group
// (process.kill(-pid, signal)) also kills grandchildren like the claude CLI
// subprocess launched by the Agent SDK — without this they become orphans at
// 100% CPU after the worker is gone.
function killWorkerProcess(w, signal) {
  if (typeof w.pid === 'number' && process.platform !== 'win32') {
    process.kill(-w.pid, signal);
  } else {
    w.kill(signal);
  }
}

export class WebSocketHandler {
  #ws;
  #sessionManager;
  #sessionId = null;
  #worker = null;
  // Promise for an in-flight WorkerSpawner.spawn(). #onClose/#onError/disconnect
  // must await this before deleteSession runs rmSync on the session temp dir —
  // otherwise the bwrap bind-mount source vanishes mid-spawn and the worker
  // hits ENOENT on /session/ipc-*.sock (during connect) or /session/model.sdjson
  // (during writes). Null when no spawn is in flight.
  #workerSpawnPromise = null;
  // True on the first chat message after a select_agent — tells worker to bridge context
  #pendingAgentSwitch = false;

  // SIGKILL every live worker immediately. Called by process signal handlers so
  // workers don't outlive the main process as orphans.
  static killAll() {
    for (const w of liveWorkers) {
      try { killWorkerProcess(w, 'SIGKILL'); } catch { /* already dead */ }
    }
    liveWorkers.clear();
  }

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
        case 'disconnect': {
          const sessionId = this.#sessionId;
          await this.#waitForSpawnAndKill();
          this.#sessionManager.deleteSession(sessionId);
          this.#ws.close(1000, 'Client requested disconnect');
          break;
        }
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

      const capabilities = {
        supportsArrays: message?.supportsArrays,
        supportsModules: message?.supportsModules,
        supportsSubTypes: message?.supportsSubTypes
      };

      if (message.clientProduct === 'Stella Architect Beta' && message.clientVersion === '4.3') {
        capabilities.supportsArrays = true;
        capabilities.supportsModules = true;
        capabilities.supportsSubTypes = false;
      }
      this.#sessionManager.initializeSession(this.#sessionId, message.mode, message.model, message.tools, message.context, message.clientId, capabilities);

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
      let selectedAgent;

      if (message.agentConfig) {
        const metadata = AgentConfigurationManager.parseContent(message.agentConfig).metadata;
        if (!metadata.name || !metadata.agent_mode) {
          throw new Error('agentConfig must have valid YAML frontmatter with name and agent_mode fields');
        }
        selectedAgent = {
          id: 'custom',
          name: metadata.name,
          supportedProviders: (metadata.supported_providers?.length ? metadata.supported_providers : ['anthropic', 'google'])
            .map(id => ({ id, name: ProviderDisplayNames[id] ?? id }))
        };
      } else {
        const { agents } = getAvailableAgents();
        selectedAgent = agents.find(agent => agent.id === message.agentId);
        if (!selectedAgent) {
          throw new Error(`Agent '${message.agentId}' not found. Available agents: ${agents.map(a => a.id).join(', ')}`);
        }
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
        // Must await — both spawn (below) and any concurrent #onClose use the
        // same tempDir. Spawning a new bwrap while the old worker is still
        // alive shares the bind-mount source; letting #onClose race ahead would
        // rmSync that source out from under either worker.
        await this.#killWorker();
      }

      // Guard: the WS may have closed during the async context fetch above.
      // #onClose already killed the worker and deleted the session — bail out
      // before spawning a new worker that would never be cleaned up.
      if (this.#ws.readyState !== 1) return;

      const tempDir = this.#sessionManager.getSessionTempDir(this.#sessionId);
      // Publish the in-flight spawn so #onClose/#onError/disconnect can await
      // it before deleteSession runs rmSync on tempDir. Without this, a WS
      // close arriving during bwrap retry delays (up to 9s) lets the cleanup
      // path rm the bind-mount source mid-spawn — the worker then hits
      // ENOENT on /session/ipc-*.sock the moment it tries to connect.
      const spawnPromise = WorkerSpawner.spawn(this.#sessionId, tempDir);
      this.#workerSpawnPromise = spawnPromise;
      try {
        this.#worker = await spawnPromise;
      } finally {
        if (this.#workerSpawnPromise === spawnPromise) {
          this.#workerSpawnPromise = null;
        }
      }

      // Guard: WS may have closed during bwrap retry delays (up to 9s).
      if (this.#ws.readyState !== 1) {
        // Await — the worker process is alive and bind-mounted to tempDir.
        // cleanupSessionTempDir below rmSync's that source synchronously, so
        // the worker must be reaped first or it'll write into a vanished
        // bind mount (root cause of the model.sdjson ENOENT).
        await this.#killWorker();
        // If the session was already deleted by #onClose, the spawn's
        // mkdirSync may have re-created the temp dir after deleteSession's
        // rmSync removed it. Clean it up so it doesn't become orphaned.
        if (!this.#sessionManager.getSession(this.#sessionId)) {
          this.#sessionManager.cleanupSessionTempDir(tempDir);
        }
        return;
      }

      liveWorkers.add(this.#worker);
      this.#setupWorkerRelay(this.#worker);

      // Let SessionManager's stale-cleanup path await worker exit before
      // rmSync'ing the bwrap bind-mount source.
      this.#sessionManager.setWorkerTeardown(this.#sessionId, () => this.#killWorker());

      const session = this.#sessionManager.getSession(this.#sessionId);
      if (!this.#worker.connected) {
        throw new Error('Worker process failed to start (sandbox may not be available)');
      }
      this.#worker.send({
        type: 'initialize',
        mode: session.mode,
        model: session.clientModel,
        tools: session.clientTools,
        context: session.context,
        clientId: session.clientId,
        conversationHistory,
        isAgentSwitch: isSwitching,
        supportsArrays: session.supportsArrays,
        supportsModules: session.supportsModules,
        supportsSubTypes: session.supportsSubTypes,
      });

      const supportedProviders = selectedAgent.supportedProviders; // [{id, name}]
      const provider = supportedProviders.length === 1
        ? supportedProviders[0].id
        : (message.provider ?? config.agentDefaultProvider);
      const workerSelectMsg = message.agentConfig
        ? { type: 'select_agent', agentConfig: message.agentConfig, provider }
        : { type: 'select_agent', agentId: message.agentId, provider };
      this.#worker.send(workerSelectMsg);
      this.#pendingAgentSwitch = isSwitching;

      await this.#sendToClient(createAgentSelectedMessage(this.#sessionId, selectedAgent.id, selectedAgent.name, selectedAgent.supportedProviders, provider));
      const providerLabel = ProviderDisplayNames[provider] ?? provider;
      if (isSwitching) {
        await this.#sendToClient(createAgentTextMessage(this.#sessionId, `I've switched to ${selectedAgent.name} (${providerLabel}). How can I help you?`, false));
        logger.log(`Agent switched to: ${selectedAgent.id} (${provider}) for session ${this.#sessionId}`);
      } else {
        await this.#sendToClient(createAgentTextMessage(this.#sessionId, `${selectedAgent.name} (${providerLabel}) — What can I do for you today?`, false));
        logger.log(`Agent selected: ${selectedAgent.id} (${provider}) for session ${this.#sessionId}`);
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

  async #onClose(code, reason) {
    logger.log(`WebSocket closed: ${this.#sessionId} (code: ${code}, reason: ${reason})`);
    if (this.#sessionId) {
      const sessionId = this.#sessionId;
      const startedAt = Date.now();
      await this.#waitForSpawnAndKill();
      const elapsed = Date.now() - startedAt;
      logger.log(`[session:${sessionId}] Worker shutdown completed in ${elapsed}ms; deleting session`);
      this.#sessionManager.deleteSession(sessionId);
    }
  }

  async #onError(error) {
    logger.error(`WebSocket error for session ${this.#sessionId}:`, error);
    if (this.#sessionId) {
      const sessionId = this.#sessionId;
      await this.#waitForSpawnAndKill();
      this.#sessionManager.deleteSession(sessionId);
    }
  }

  // Cleanup-path helper: wait for any in-flight WorkerSpawner.spawn() to settle,
  // then kill the resulting worker. Callers must use this (not bare #killWorker)
  // anywhere they're about to deleteSession or rmSync the session temp dir —
  // otherwise a WS close arriving mid-spawn lets the cleanup path race ahead of
  // bwrap's --bind setup and the worker hits ENOENT on /session.
  async #waitForSpawnAndKill() {
    if (this.#workerSpawnPromise) {
      try { await this.#workerSpawnPromise; } catch { /* spawn rejection is fine — nothing to kill */ }
    }
    await this.#killWorker();
  }

  // Returns a promise that resolves once the worker process has actually exited
  // (or after the SIGKILL fallback fires). Callers that destroy the session temp
  // directory MUST await this — bwrap's `--bind` source vanishing under a live
  // sandbox produces ENOENT on writes from inside the container.
  #killWorker() {
    if (!this.#worker) return Promise.resolve();
    const w = this.#worker;
    const sessionId = this.#sessionId;
    this.#worker = null;
    liveWorkers.delete(w);
    if (w.connected) {
      try { w.send({ type: 'shutdown' }); } catch { /* already dead */ }
    }
    return new Promise((resolve) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };

      const sigkillTimer = setTimeout(() => {
        logger.warn(`[worker:${sessionId}] did not exit within 2s of shutdown — sending SIGKILL`);
        try { killWorkerProcess(w, 'SIGKILL'); } catch { /* already dead */ }
      }, 2000);

      // Safety: if 'exit' was already emitted before we attached (or never
      // fires), don't hang the session-cleanup path forever.
      const fallbackTimer = setTimeout(() => {
        logger.warn(`[worker:${sessionId}] exit event not received 4s after shutdown — proceeding with cleanup`);
        settle();
      }, 4000);

      w.once('exit', () => {
        clearTimeout(sigkillTimer);
        clearTimeout(fallbackTimer);
        settle();
      });
    });
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
        // Only forward if this is still the active worker; drop stale messages
        // from a worker that has been replaced or is in its shutdown grace period.
        if (this.#worker === w && this.#ws.readyState === 1) {
          this.#ws.send(JSON.stringify(msg.message));
        }
      } else if (msg.type === 'worker_error') {
        logger.error(`[worker:${this.#sessionId}] ${msg.error}`);
      }
      // context_response is handled inside #getWorkerContext via its own listener
    });

    w.on('error', (err) => logger.error(`[worker:${this.#sessionId}] process error: ${err.message}`));
    
    w.on('exit', (code, signal) => {
      logger.log(`[worker:${this.#sessionId}] exited (code=${code} signal=${signal})`);
      liveWorkers.delete(w);
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
