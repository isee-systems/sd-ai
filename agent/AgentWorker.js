/**
 * Agent Worker Process
 *
 * Runs inside a bwrap sandbox on Linux (or unsandboxed on dev platforms).
 * Receives IPC messages from the main process, runs AgentOrchestrator, and
 * relays all outbound client messages back over IPC.
 *
 * IPC transport:
 *   - Sandboxed (bwrap): Unix domain socket at WORKER_IPC_SOCKET, newline-
 *     delimited JSON.  The socket lives in /session so it crosses the sandbox
 *     boundary without needing --forward-fd.
 *   - Unsandboxed (fork fallback): standard Node.js process IPC channel.
 *
 * IPC messages IN  (main → worker):
 *   initialize    – session data; must arrive before select_agent
 *   select_agent  – agentId; creates/replaces AgentOrchestrator
 *   chat          – user message; starts an agent conversation
 *   stop          – abort the current agent iteration
 *   tool_response – callId + result; resolves a pending client tool promise
 *   model_updated – new client model object
 *   add_file      – RAG: fileId + metadata; worker extracts/chunks/embeds the
 *                   bytes the main process already wrote to <session>/rag/<id>/
 *   remove_file   – RAG: fileId; worker deletes the file's artifacts + vectors
 *   get_context   – requestId; worker replies with current conversation history
 *   shutdown      – clean exit
 *
 * IPC messages OUT (worker → main):
 *   to_client          – relay to the WebSocket client verbatim
 *   context_response   – reply to get_context
 *   rag_file_processed – RAG: a file finished extraction/embedding (meta update)
 *   worker_error       – unhandled top-level error
 */

import { AgentOrchestrator } from './AgentOrchestrator.js';
import { SessionManager } from './utilities/SessionManager.js';
import { RagStore, createGeminiEmbedder } from './utilities/RagStore.js';
import logger from '../utilities/logger.js';
import config from '../config.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import net from 'net';
import { createInterface } from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SESSION_ID = process.env.SESSION_ID;
const SESSION_TEMP_DIR = process.env.SESSION_TEMP_DIR;

if (!SESSION_ID || !SESSION_TEMP_DIR) {
  process.stderr.write('AgentWorker: SESSION_ID and SESSION_TEMP_DIR must be set\n');
  process.exit(1);
}

class AgentWorker {
  // Mock WebSocket: SessionManager stores a ws-shaped object, but in the worker
  // all real sends go through toClient() which is passed directly to AgentOrchestrator.
  #mockWs = { readyState: 1, send: () => {} };

  // Worker has its own SessionManager. Cleanup timers are disabled — lifetime is
  // managed by the main process which kills this process on disconnect/timeout.
  #sessionManager = new SessionManager({ disableCleanup: true });

  #orchestrator = null;

  // Per-worker RAG store (one session per worker). Created on initialize.
  #ragStore = null;

  #conversationRunning = false;

  // IPC send function — overridden by #setupSocketIpc when using bwrap sandbox
  #sendToMain = (msg) => process.send(msg);

  constructor() {
    const ipcSocketPath = process.env.WORKER_IPC_SOCKET;
    if (ipcSocketPath) {
      this.#setupSocketIpc(ipcSocketPath);
    } else {
      process.on('message', (msg) => this.#handleMessage(msg));
    }

    process.on('uncaughtException', (err) => {
      logger.error(`[worker:${SESSION_ID}] Uncaught exception:`, err);
      this.#toMain({ type: 'worker_error', error: err.message });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error(`[worker:${SESSION_ID}] Unhandled rejection:`, reason);
      this.#toMain({ type: 'worker_error', error: String(reason) });
    });
  }

  #setupSocketIpc(socketPath) {
    const sock = net.createConnection(socketPath);

    sock.on('error', (err) => {
      logger.error(`[worker:${SESSION_ID}] IPC socket error: ${err.message}`);
      process.exit(1);
    });

    this.#sendToMain = (msg) => {
      if (!sock.destroyed) sock.write(JSON.stringify(msg) + '\n');
    };

    const rl = createInterface({ input: sock, crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try { this.#handleMessage(JSON.parse(line)); }
      catch (e) { logger.error(`[worker:${SESSION_ID}] IPC parse error: ${e.message}`); }
    });

    rl.on('close', () => process.exit(0));
  }

  #toMain(msg) { this.#sendToMain(msg); }
  #toClient(msg) { this.#toMain({ type: 'to_client', message: msg }); }

  // Extract/chunk/embed a newly added file off the critical path, then tell the
  // main process its final metadata so it can emit an updated file snapshot.
  // Extraction + embedding awaits yield the event loop so an in-flight agent
  // conversation keeps running.
  async #processRagFile(msg) {
    const fileMeta = { fileId: msg.fileId, name: msg.name, mimeType: msg.mimeType, addedAt: msg.addedAt };
    try {
      const meta = await this.#ragStore.processFile(this.#sessionManager, SESSION_ID, fileMeta);
      this.#toMain({ type: 'rag_file_processed', fileId: meta.fileId, meta });
    } catch (err) {
      logger.error(`[worker:${SESSION_ID}] Failed to process RAG file ${msg.fileId}:`, err);
      this.#toMain({
        type: 'rag_file_processed',
        fileId: msg.fileId,
        meta: { ...fileMeta, status: 'error', error: err.message }
      });
    }
  }

  async #handleMessage(msg) {
    try {
      switch (msg.type) {

        case 'initialize': {
          this.#sessionManager.createSessionWithId(SESSION_ID, this.#mockWs, SESSION_TEMP_DIR);
          const capabilities = {
            supportsArrays: msg.supportsArrays,
            supportsModules: msg.supportsModules,
            supportsSubTypes: msg.supportsSubTypes,
          };
          this.#sessionManager.initializeSession(SESSION_ID, msg.mode, msg.model, msg.tools, msg.context, msg.clientId, capabilities);
          for (const h of (msg.conversationHistory || [])) {
            this.#sessionManager.addToConversationHistory(SESSION_ID, h);
          }

          // RAG: stand up the per-worker store and reconcile files already on
          // disk. Files carried across an agent switch keep their extracted text
          // + embeddings (no re-embedding — just re-registered); files whose
          // bytes were written before any worker existed get processed now.
          this.#ragStore = new RagStore(createGeminiEmbedder(msg.clientId));
          this.#sessionManager.ragStore = this.#ragStore;
          const freshlyProcessed = await this.#ragStore.reconcile(this.#sessionManager, SESSION_ID, msg.attachedFiles || []);
          for (const meta of freshlyProcessed) {
            this.#toMain({ type: 'rag_file_processed', fileId: meta.fileId, meta });
          }
          break;
        }

        case 'select_agent': {
          const agentConfig = msg.agentConfig !== undefined
            ? { markdownContent: msg.agentConfig }
            : { path: join(__dirname, 'config', `${msg.agentId}.md`) };
          const provider = msg.provider ?? config.agentDefaultProvider;
          this.#orchestrator = new AgentOrchestrator(this.#sessionManager, SESSION_ID, (m) => this.#toClient(m), agentConfig, provider);
          break;
        }

        case 'chat': {
          if (!this.#orchestrator) {
            this.#toClient({ type: 'error', sessionId: SESSION_ID, error: 'No agent selected', code: 'NO_AGENT' });
            break;
          }
          if (this.#conversationRunning) {
            this.#orchestrator.queueMessage(msg.message);
            break;
          }
          // Pass the live session context whenever it has any history so SDK
          // routes can inject prior turns on their first call. Covers both
          // agent-switch handoffs and fresh sessions seeded with
          // historicalMessages via initialize_session. SDK routes self-gate on
          // their own session-id state, so re-passing on subsequent chats is a
          // no-op for them.
          const sessionCtx = this.#sessionManager.getConversationContext(SESSION_ID);
          const previousContext = sessionCtx.length > 0 ? sessionCtx : null;
          this.#conversationRunning = true;
          this.#orchestrator.startConversation(msg.message, previousContext)
            .finally(() => { this.#conversationRunning = false; });
          break;
        }

        case 'stop': {
          this.#orchestrator?.stopIteration();
          break;
        }

        case 'tool_response': {
          const { callId, result, isError } = msg;
          const session = this.#sessionManager.getSession(SESSION_ID);
          if (!session) break;

          // Try the standard pending tool calls (DynamicToolProvider)
          if (!this.#sessionManager.resolvePendingToolCall(SESSION_ID, callId, result, isError)) {
            // Try feedback requests (discussModelWithSeldon, discussModelAcrossRuns, getFeedbackInformation)
            if (session.pendingFeedbackRequests?.has(callId)) {
              const pending = session.pendingFeedbackRequests.get(callId);
              clearTimeout(pending.timeout);
              isError ? pending.reject(new Error(typeof result === 'string' ? result : JSON.stringify(result))) : pending.resolve(result);
              session.pendingFeedbackRequests.delete(callId);
            // Try model requests (clientInteractionTools, generateQuantitativeModel, etc.)
            } else if (session.pendingModelRequests?.has(callId)) {
              const pending = session.pendingModelRequests.get(callId);
              clearTimeout(pending.timeout);
              isError ? pending.reject(new Error(typeof result === 'string' ? result : JSON.stringify(result))) : pending.resolve(result);
              session.pendingModelRequests.delete(callId);
            } else {
              logger.warn(`[worker:${SESSION_ID}] Unknown callId in tool_response: ${callId}`);
            }
          }
          break;
        }

        case 'model_updated': {
          this.#sessionManager.updateClientModel(SESSION_ID, msg.model);
          break;
        }

        case 'add_file': {
          // If the store isn't up yet the bytes are safely on disk and will be
          // picked up by reconcile() on initialize. Otherwise process now.
          if (this.#ragStore) this.#processRagFile(msg);
          break;
        }

        case 'remove_file': {
          if (this.#ragStore) {
            try {
              this.#ragStore.removeFile(this.#sessionManager, SESSION_ID, msg.fileId);
            } catch (err) {
              logger.error(`[worker:${SESSION_ID}] Failed to remove RAG file ${msg.fileId}:`, err);
            }
          }
          break;
        }

        case 'get_context': {
          const context = this.#sessionManager.getConversationContext(SESSION_ID);
          this.#toMain({ type: 'context_response', requestId: msg.requestId, context });
          break;
        }

        case 'shutdown': {
          // Abort any in-flight conversation so the Agent SDK can clean up
          // the claude CLI subprocess it may have spawned.
          this.#orchestrator?.stopIteration();
          // Kill our entire process group. On the fork fallback (macOS/dev)
          // this catches grandchild processes (claude CLI) that would otherwise
          // be orphaned at 100% CPU. Inside a bwrap PID namespace this kills
          // all container processes. Safe because the fork is spawned with
          // detached:true (own process group) and bwrap runs in its own namespace.
          if (process.platform !== 'win32') {
            try { process.kill(-process.pid, 'SIGKILL'); } catch { /* already exiting */ }
          }
          // Temp-dir cleanup is the host SessionManager's responsibility.
          // Inside the bwrap sandbox /session is a bind mount and can't be
          // rmdir'd; in the fork fallback the host also calls deleteSession.
          process.exit(0);
          break;
        }

        default:
          logger.warn(`[worker:${SESSION_ID}] Unknown IPC message type: ${msg.type}`);
      }
    } catch (err) {
      logger.error(`[worker:${SESSION_ID}] Unhandled error processing ${msg.type}:`, err);
      this.#toMain({ type: 'worker_error', error: err.message });
    }
  }
}

new AgentWorker();
