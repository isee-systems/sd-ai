/**
 * Agent Worker Process
 *
 * Runs inside a bwrap sandbox on Linux (or unsandboxed on dev platforms).
 * Receives IPC messages from the main process, runs AgentOrchestrator, and
 * relays all outbound client messages back over IPC.
 *
 * IPC messages IN  (main → worker):
 *   initialize    – session data; must arrive before select_agent
 *   select_agent  – agentId; creates/replaces AgentOrchestrator
 *   chat          – user message; starts an agent conversation
 *   stop          – abort the current agent iteration
 *   tool_response – callId + result; resolves a pending client tool promise
 *   model_updated – new client model object
 *   get_context   – requestId; worker replies with current conversation history
 *   shutdown      – clean exit
 *
 * IPC messages OUT (worker → main):
 *   to_client      – relay to the WebSocket client verbatim
 *   context_response – reply to get_context
 *   worker_error   – unhandled top-level error
 */

import { AgentOrchestrator } from './AgentOrchestrator.js';
import { SessionManager } from './utilities/SessionManager.js';
import logger from '../utilities/logger.js';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

  // Set on first chat after an agent switch so AgentOrchestrator can bridge context
  // from the previous agent into the new session.
  #pendingIsAgentSwitch = false;

  constructor() {
    process.on('message', (msg) => this.#handleMessage(msg));

    process.on('uncaughtException', (err) => {
      logger.error(`[worker:${SESSION_ID}] Uncaught exception:`, err);
      this.#toMain({ type: 'worker_error', error: err.message });
    });

    process.on('unhandledRejection', (reason) => {
      logger.error(`[worker:${SESSION_ID}] Unhandled rejection:`, reason);
      this.#toMain({ type: 'worker_error', error: String(reason) });
    });
  }

  #toMain(msg) { process.send(msg); }
  #toClient(msg) { this.#toMain({ type: 'to_client', message: msg }); }

  async #handleMessage(msg) {
    try {
      switch (msg.type) {

        case 'initialize': {
          this.#sessionManager.createSessionWithId(SESSION_ID, this.#mockWs, SESSION_TEMP_DIR);
          this.#sessionManager.initializeSession(SESSION_ID, msg.mode, msg.model, msg.tools, msg.context);
          for (const h of (msg.conversationHistory || [])) {
            this.#sessionManager.addToConversationHistory(SESSION_ID, h);
          }
          this.#pendingIsAgentSwitch = msg.isAgentSwitch ?? false;
          break;
        }

        case 'select_agent': {
          const configPath = join(__dirname, 'config', `${msg.agentId}.md`);
          this.#orchestrator = new AgentOrchestrator(this.#sessionManager, SESSION_ID, (m) => this.#toClient(m), configPath);
          break;
        }

        case 'chat': {
          if (!this.#orchestrator) {
            this.#toClient({ type: 'error', sessionId: SESSION_ID, error: 'No agent selected', code: 'NO_AGENT' });
            break;
          }
          // When switching agents, pass the live session context reference so that
          // AgentOrchestrator's manual-mode pop() correctly modifies the session history.
          const previousContext = this.#pendingIsAgentSwitch
            ? this.#sessionManager.getConversationContext(SESSION_ID)
            : null;
          this.#pendingIsAgentSwitch = false;
          await this.#orchestrator.startConversation(msg.message, previousContext);
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
              isError ? pending.reject(new Error(result)) : pending.resolve(result);
              session.pendingFeedbackRequests.delete(callId);
            // Try model requests (clientInteractionTools, generateQuantitativeModel, etc.)
            } else if (session.pendingModelRequests?.has(callId)) {
              const pending = session.pendingModelRequests.get(callId);
              clearTimeout(pending.timeout);
              isError ? pending.reject(new Error(result)) : pending.resolve(result);
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

        case 'get_context': {
          const context = this.#sessionManager.getConversationContext(SESSION_ID);
          this.#toMain({ type: 'context_response', requestId: msg.requestId, context });
          break;
        }

        case 'shutdown': {
          const session = this.#sessionManager.getSession(SESSION_ID);
          if (session) this.#sessionManager.deleteSession(SESSION_ID);
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
