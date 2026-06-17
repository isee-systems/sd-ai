import { WorkerSpawner, SandboxUnavailableError } from './WorkerSpawner.js';
import { AgentConfigurationManager } from './utilities/AgentConfigurationManager.js';
import {
  validateClientMessage,
  createSessionCreatedMessage,
  createSessionReadyMessage,
  createAgentSelectedMessage,
  createAgentTextMessage,
  createErrorMessage,
  createFileAddedMessage,
  createFileRemovedMessage
} from './utilities/MessageProtocol.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { randomBytes } from 'crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import logger from '../utilities/logger.js';
import utils from '../utilities/utils.js';
import config from '../config.js';
import { ProviderDisplayNames } from '../utilities/TokenUsageReporter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cached result of the agent-config scan. Agent .md files don't change at
// runtime, so we read + parse once on first call and reuse for every session
// (originally scanned twice per session — initialize_session and select_agent).
let _availableAgentsCache = null;

function getAvailableAgents() {
  if (_availableAgentsCache) return _availableAgentsCache;

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
            supportedProviders: (metadata.supported_providers?.length ? metadata.supported_providers : config.agentProviders)
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

  _availableAgentsCache = { agents, defaults };
  return _availableAgentsCache;
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
  // True once the first select_agent has succeeded. Differentiates a true
  // agent-switch (need to fetch context from old worker, kill it, spawn new)
  // from the first select_agent where the worker may already be prewarmed.
  #agentSelected = false;

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

    // Pre-warm the worker process in parallel with the client's
    // initialize_session/select_agent round-trips. Clients always select an
    // agent, so we'd spawn this worker anyway — doing it now overlaps the
    // bwrap startup + Node module load with the network handshake. Saves
    // ~1-1.5s of user-perceived session-start latency on the common case.
    this.#prewarmWorker();
  }

  /**
   * Spawn a sandboxed worker eagerly on WS connect (before select_agent
   * arrives). The worker's IPC socket is up by the time the client sends
   * its first select_agent, so the only remaining latency is the two IPC
   * sends (initialize + select_agent).
   *
   * Errors are non-fatal: if the prewarmed spawn fails (bwrap diagnostics,
   * retries exhausted), #handleSelectAgent falls back to a fresh spawn that
   * surfaces the error to the client.
   */
  #prewarmWorker() {
    const tempDir = this.#sessionManager.getSessionTempDir(this.#sessionId);
    const spawnPromise = WorkerSpawner.spawn(this.#sessionId, tempDir);
    this.#workerSpawnPromise = spawnPromise;

    spawnPromise
      .then(w => {
        // Cleanup path may have moved on (WS closed during spawn, or an
        // agent-switch replaced this promise) — the orphan worker must be
        // killed so it doesn't sit around eating resources.
        if (this.#workerSpawnPromise !== spawnPromise) {
          try { killWorkerProcess(w, 'SIGKILL'); } catch { /* already dead */ }
          return;
        }
        this.#worker = w;
        liveWorkers.add(w);
        this.#setupWorkerRelay(w);
        this.#sessionManager.setWorkerTeardown(this.#sessionId, () => this.#killWorker());
        this.#workerSpawnPromise = null;
      })
      .catch(err => {
        logger.warn(`[session:${this.#sessionId}] Worker prewarm failed: ${err.message} — select_agent will retry`);
        if (this.#workerSpawnPromise === spawnPromise) {
          this.#workerSpawnPromise = null;
        }
      });
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
        case 'add_file':
          await this.#handleAddFile(message);
          break;
        case 'remove_file':
          await this.#handleRemoveFile(message);
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

        // Historical-message summarization runs before any orchestrator (and
        // its provider choice) exists — fall back to the default provider's
        // summary API.
        await this.#sessionManager.cleanupContext(this.#sessionId, config.agentMaxContextTokens, config.agentDefaultProvider);
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
          supportedProviders: (metadata.supported_providers?.length ? metadata.supported_providers : config.agentProviders)
            .map(id => ({ id, name: ProviderDisplayNames[id] ?? id }))
        };
      } else {
        const { agents } = getAvailableAgents();
        selectedAgent = agents.find(agent => agent.id === message.agentId);
        if (!selectedAgent) {
          throw new Error(`Agent '${message.agentId}' not found. Available agents: ${agents.map(a => a.id).join(', ')}`);
        }
      }

      // First select_agent uses the prewarmed worker (or falls back to fresh
      // spawn if the prewarm failed). Subsequent select_agents are switches.
      const isSwitching = this.#agentSelected;

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

      // Await prewarm if it's still in flight; on success #worker is already
      // set up (liveWorkers, relay, teardown hook all wired in #prewarmWorker).
      if (this.#workerSpawnPromise) {
        try { await this.#workerSpawnPromise; }
        catch { /* prewarm rejected; fall through to fresh spawn below */ }
      }

      if (!this.#worker) {
        // Prewarm failed, or this is an agent-switch that just killed the
        // prior worker. Spawn fresh. Publish the in-flight spawn so
        // #onClose/#onError/disconnect can await it before deleteSession runs
        // rmSync on tempDir.
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
      } else if (this.#ws.readyState !== 1) {
        // Prewarmed worker was set up successfully, but the WS closed while
        // we were waiting on agent-switch teardown or upstream awaits. Reap
        // the orphan to free the sandbox.
        await this.#killWorker();
        if (!this.#sessionManager.getSession(this.#sessionId)) {
          this.#sessionManager.cleanupSessionTempDir(tempDir);
        }
        return;
      }

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
        // RAG: the new worker reconciles these against on-disk artifacts (which
        // survive an agent switch) so it reloads rather than re-embeds.
        attachedFiles: this.#sessionManager.getAttachedFiles(this.#sessionId),
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
      // A SandboxUnavailableError is permanent for the lifetime of this process
      // (bwrap is broken with no fallback). Returning a retryable
      // AGENT_SELECTION_ERROR here invites a client hot-loop: the client
      // re-sends select_agent on error, spawn fails instantly (no retry delay
      // once #bwrapBroken is latched), and the same socket logs tens of
      // thousands of identical failures per minute. Close the connection
      // instead so there's nothing to retry against on this socket.
      if (error instanceof SandboxUnavailableError) {
        if (this.#ws.readyState === 1) this.#ws.close(1011, 'Worker sandbox unavailable');
        return;
      }
      await this.#sendToClient(createErrorMessage(this.#sessionId, `Agent selection failed: ${error.message}`, 'AGENT_SELECTION_ERROR'));
    }
  }

  async #handleChat(message) {
    try {
      if (!this.#worker) {
        throw new Error('No agent selected. Send select_agent first.');
      }
      this.#worker.send({ type: 'chat', message: message.message });
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

  // RAG: client attaches a file. The main process is authoritative for "the
  // bytes exist": it writes them to the host temp dir (== the worker's /session
  // bind-mount source), tracks metadata, acks immediately with the full file
  // snapshot, then forwards a lightweight notification to the worker which does
  // the extraction/embedding and reports back via rag_file_processed.
  async #handleAddFile(message) {
    try {
      const fileId = message.fileId || `file_${randomBytes(8).toString('hex')}`;

      const existing = this.#sessionManager.getAttachedFiles(this.#sessionId);
      const isNew = !existing.some(f => f.fileId === fileId);
      if (isNew && existing.length >= config.ragMaxFilesPerSession) {
        await this.#sendToClient(createErrorMessage(this.#sessionId, `Attached file limit reached (${config.ragMaxFilesPerSession}).`, 'FILE_LIMIT_EXCEEDED'));
        return;
      }

      const buffer = Buffer.from(message.content, message.encoding === 'base64' ? 'base64' : 'utf8');
      if (buffer.length > config.ragMaxFileBytes) {
        await this.#sendToClient(createErrorMessage(this.#sessionId, `File '${message.name}' exceeds the maximum size of ${config.ragMaxFileBytes} bytes.`, 'FILE_TOO_LARGE'));
        return;
      }

      const tempDir = this.#sessionManager.getSessionTempDir(this.#sessionId);
      const fileDir = join(tempDir, 'rag', fileId);
      mkdirSync(fileDir, { recursive: true });
      writeFileSync(join(fileDir, 'original.bin'), buffer);

      const addedAt = new Date().toISOString();
      this.#sessionManager.addAttachedFile(this.#sessionId, {
        fileId,
        name: message.name,
        mimeType: message.mimeType,
        bytes: buffer.length,
        tokenCount: null,
        tier: null,
        chunkCount: 0,
        status: 'processing',
        addedAt
      });

      // Immediate ack (status: processing). A second file_added snapshot follows
      // from the worker's rag_file_processed once extraction/embedding completes.
      await this.#sendToClient(createFileAddedMessage(this.#sessionId, this.#sessionManager.getAttachedFiles(this.#sessionId)));

      this.#worker?.send({ type: 'add_file', fileId, name: message.name, mimeType: message.mimeType, addedAt });
    } catch (error) {
      logger.error(`Error adding file for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, error.message, 'ADD_FILE_ERROR'));
    }
  }

  // RAG: client removes a file. Drop metadata + on-disk artifacts (covers the
  // no-worker case) and forward to the worker so it drops its in-memory vectors.
  async #handleRemoveFile(message) {
    try {
      const tempDir = this.#sessionManager.getSessionTempDir(this.#sessionId);
      this.#sessionManager.removeAttachedFile(this.#sessionId, message.fileId);
      try { rmSync(join(tempDir, 'rag', message.fileId), { recursive: true, force: true }); } catch { /* already gone */ }
      await this.#sendToClient(createFileRemovedMessage(this.#sessionId, this.#sessionManager.getAttachedFiles(this.#sessionId)));
      this.#worker?.send({ type: 'remove_file', fileId: message.fileId });
    } catch (error) {
      logger.error(`Error removing file for session ${this.#sessionId}:`, error);
      await this.#sendToClient(createErrorMessage(this.#sessionId, error.message, 'REMOVE_FILE_ERROR'));
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
      } else if (msg.type === 'rag_file_processed') {
        // The worker finished extraction/embedding. Update the authoritative
        // metadata and push a refreshed snapshot so the client sees the final
        // status (and so a future agent switch re-initializes correctly).
        if (this.#worker === w) {
          // Drop a late result for a file that's no longer tracked: a quick
          // attach-then-remove deletes the shared rag/<id> bytes out from under
          // the still-queued add_file, so the worker reports it (errored) after
          // the main already removed it. Re-adding here would resurrect a
          // removed file in the client's snapshot.
          const stillTracked = this.#sessionManager.getAttachedFiles(this.#sessionId).some(f => f.fileId === msg.fileId);
          if (!stillTracked) {
            logger.log(`[session:${this.#sessionId}] Ignoring RAG result for untracked file ${msg.fileId} (removed before processing finished)`);
          } else {
            this.#sessionManager.addAttachedFile(this.#sessionId, msg.meta);
            if (this.#ws.readyState === 1) {
              this.#ws.send(JSON.stringify(createFileAddedMessage(this.#sessionId, this.#sessionManager.getAttachedFiles(this.#sessionId))));
            }
          }
        }
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
