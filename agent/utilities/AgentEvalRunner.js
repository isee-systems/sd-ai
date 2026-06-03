import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AgentOrchestrator } from '../AgentOrchestrator.js';
import { SessionManager } from './SessionManager.js';
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';
import PySDSimulator from '../../evals/utilities/simulator/PySDSimulator.js';
import logger from '../../utilities/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_CONFIG_DIR = join(__dirname, '../config');

const EVAL_MODE_INSTRUCTION = `
## EVAL MODE: No User Present
You are running in automated evaluation mode. There is NO user. You MUST:
- Never ask the user questions or for clarification
- Never stop to request input or confirmation
- Make your best judgment and proceed autonomously
- Iterate until the task is fully complete
- If you are uncertain about a requirement, make a reasonable assumption and continue
`;

/**
 * Find all simple cycles in a directed graph using DFS.
 * Each cycle is found exactly once (starting from its lexicographically-smallest node).
 */
export function findFeedbackLoops(relationships) {
  const adj = {};
  for (const rel of (relationships || [])) {
    if (!adj[rel.from]) adj[rel.from] = [];
    adj[rel.from].push({ to: rel.to, polarity: rel.polarity || '+' });
  }

  const allNodes = [...new Set([
    ...Object.keys(adj),
    ...(relationships || []).map(r => r.to)
  ])].sort();

  const nodeIndex = {};
  allNodes.forEach((n, i) => { nodeIndex[n] = i; });

  const loops = [];
  let loopCounter = 0;

  for (let startIdx = 0; startIdx < allNodes.length; startIdx++) {
    const startNode = allNodes[startIdx];
    const path = [startNode];
    const pathPolarities = [];
    const inPath = new Set([startNode]);

    function dfs(node) {
      for (const { to, polarity } of (adj[node] || [])) {
        if (to === startNode && path.length > 1) {
          // Found a cycle back to start — record it
          const cyclePolarities = [...pathPolarities, polarity];
          const negativeCount = cyclePolarities.filter(p => p === '-').length;
          const loopPolarity = negativeCount % 2 === 0 ? '+' : '-';
          loopCounter++;
          const links = [];
          for (let i = 0; i < path.length; i++) {
            links.push({
              from: path[i],
              to: i + 1 < path.length ? path[i + 1] : startNode,
              polarity: cyclePolarities[i]
            });
          }
          loops.push({
            identifier: `L${loopCounter}`,
            name: `Loop ${loopCounter}`,
            links,
            polarity: loopPolarity
          });
        } else if (!inPath.has(to) && nodeIndex[to] > startIdx) {
          inPath.add(to);
          path.push(to);
          pathPolarities.push(polarity);
          dfs(to);
          path.pop();
          pathPolarities.pop();
          inPath.delete(to);
        }
      }
    }

    dfs(startNode);
  }

  return loops;
}

/**
 * Patch a markdown string's frontmatter.
 * Replaces max_iterations and optionally agent_mode, then appends eval instructions.
 */
export function patchAgentConfig(markdownContent, agentMode) {
  // Patch max_iterations to effectively unlimited
  let patched = markdownContent.replace(
    /^max_iterations:\s*\d+/m,
    'max_iterations: 9999'
  );

  // Optionally override agent_mode
  if (agentMode) {
    patched = patched.replace(
      /^agent_mode:\s*.+/m,
      `agent_mode: ${agentMode}`
    );
  }

  // Append eval-mode instruction to the body (after closing ---)
  const frontmatterEnd = patched.indexOf('\n---\n');
  if (frontmatterEnd !== -1) {
    const insertAt = frontmatterEnd + 5; // after '\n---\n'
    patched = patched.slice(0, insertAt) + EVAL_MODE_INSTRUCTION + patched.slice(insertAt);
  } else {
    patched += EVAL_MODE_INSTRUCTION;
  }

  return patched;
}

/**
 * Resolve a pending request stored in a Map (pendingModelRequests or pendingFeedbackRequests).
 * Clears the timeout and removes the entry before resolving/rejecting.
 */
function resolvePending(map, requestId, value) {
  const pending = map?.get(requestId);
  if (pending) {
    clearTimeout(pending.timeout);
    map.delete(requestId);
    pending.resolve(value);
  }
}

function rejectPending(map, requestId, error) {
  const pending = map?.get(requestId);
  if (pending) {
    clearTimeout(pending.timeout);
    map.delete(requestId);
    pending.reject(error);
  }
}

/**
 * Run the agent to completion for eval purposes.
 *
 * @param {string} prompt - The user prompt
 * @param {Object} currentModel - The current SD model (sdjson)
 * @param {Object} parameters - Engine parameters including agentName, agentMode, provider, mode,
 *                              problemStatement, backgroundKnowledge, feedbackContent
 * @returns {{ lastModel: Object|null, explanation: string }}
 */
export async function runAgent(prompt, currentModel, parameters) {
  const {
    agentName = 'merlin',
    agentMode,
    provider = 'anthropic',
    mode = 'sfd',
    problemStatement,
    backgroundKnowledge,
    feedbackContent
  } = parameters;

  // Derive base session mode (strip -discuss suffix)
  const baseMode = mode.replace(/-discuss$/, '');

  // 1. Load and patch agent config
  const configPath = join(AGENT_CONFIG_DIR, `${agentName}.md`);
  let markdownContent;
  try {
    markdownContent = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Agent config not found: ${configPath}`);
  }
  markdownContent = patchAgentConfig(markdownContent, agentMode);

  // 2. Set up session
  const sessionManager = new SessionManager({ disableCleanup: true });
  const sessionId = sessionManager.createSession({ readyState: 1, send: () => {} });
  sessionManager.initializeSession(
    sessionId,
    baseMode,
    currentModel || { variables: [], relationships: [] },
    [],
    {
      supportsArrays: true,
      supportsModules: true,
      supportsSubTypes: false
    },
    'eval-client'
  );

  // 3. In-memory run storage
  const storedRuns = new Map();
  let runCounter = 0;

  const textParts = [];
  let resolveComplete;
  let rejectComplete;
  const completionPromise = new Promise((res, rej) => {
    resolveComplete = res;
    rejectComplete = rej;
  });

  // 4. Mock sendToClient
  const sendToClient = async (message) => {
    const session = sessionManager.getSession(sessionId);

    switch (message.type) {
      case 'get_current_model': {
        // setImmediate: sendToClient is awaited BEFORE the tool stores its resolver in the
        // pending Map, so we must defer resolution until after the current call stack unwinds.
        // Read from session (not the closure) so updates pushed via update_model are visible.
        const gcmReqId = message.requestId;
        setImmediate(() => {
          const latestModel = sessionManager.getClientModel(sessionId) || { variables: [], relationships: [] };
          resolvePending(sessionManager.getSession(sessionId)?.pendingModelRequests, gcmReqId, latestModel);
        });
        break;
      }

      case 'update_model': {
        const modelData = message.modelData;
        const umReqId = message.requestId;
        setImmediate(() => resolvePending(sessionManager.getSession(sessionId)?.pendingModelRequests, umReqId, modelData));
        break;
      }

      case 'run_model': {
        const model = sessionManager.getClientModel(sessionId);
        let runId = `eval-run-${++runCounter}`;
        try {
          const xmileContent = SDJsonToXMILE(model, {
            modelName: 'eval-model',
            vendor: 'sd-ai-evals',
            product: 'sd-ai-evals',
            version: '1.0'
          });
          
          const varNames = (model?.variables || [])
            .map(v => v.name?.replace(/\s+/g, '_'))
            .filter(Boolean);

          if (varNames.length > 0) {
            const sim = new PySDSimulator(xmileContent);
            const results = await sim.simulate(varNames);
            storedRuns.set(runId, results);
          } else {
            storedRuns.set(runId, {});
          }
        } catch (err) {
          logger.warn(`[AgentEvalRunner] Simulation failed for run ${runId}: ${err.message}`);
          runId = `eval-run-failed-${runCounter}`;
          storedRuns.set(runId, {});
        }
        // run_model awaits simulation above, so sendToClient returns after the async work.
        // The tool creates its promise immediately after sendToClient returns, so
        // setImmediate fires after the resolver is in the Map.
        const rmRunId = runId;
        const rmReqId = message.requestId;
        setImmediate(() => resolvePending(sessionManager.getSession(sessionId)?.pendingModelRequests, rmReqId, { runId: rmRunId }));
        break;
      }

      case 'get_run_info': {
        const runs = Array.from(storedRuns.entries()).map(([id, data]) => ({
          id,
          name: id,
          variables: Object.keys(data).filter(k => k !== 'time')
        }));
        const griReqId = message.requestId;
        setImmediate(() => resolvePending(sessionManager.getSession(sessionId)?.pendingModelRequests, griReqId, { runs }));
        break;
      }

      case 'get_variable_data': {
        const { variableNames = [], runIds = [], detailed = false } = message;
        const targetPoints = detailed ? 200 : 50;
        const result = {};
        for (const runId of runIds) {
          const runData = storedRuns.get(runId);
          if (runData) {
            result[runId] = {};
            const timeArr = runData.time;
            if (timeArr && timeArr.length > targetPoints) {
              const indices = Array.from({ length: targetPoints }, (_, i) =>
                Math.round(i * (timeArr.length - 1) / (targetPoints - 1))
              );
              result[runId].time = indices.map(i => timeArr[i]);
              for (const varName of variableNames) {
                const arr = runData[varName];
                if (arr !== undefined) result[runId][varName] = indices.map(i => arr[i]);
              }
            } else {
              if (timeArr) result[runId].time = timeArr;
              for (const varName of variableNames) {
                if (runData[varName] !== undefined) result[runId][varName] = runData[varName];
              }
            }
          }
        }
        const gvdReqId = message.requestId;
        setImmediate(() => resolvePending(sessionManager.getSession(sessionId)?.pendingModelRequests, gvdReqId, result));
        break;
      }

      case 'feedback_request': {
        let resolvedFeedbackContent;
        if (feedbackContent) {
          resolvedFeedbackContent = feedbackContent;
        } else {
          const model = sessionManager.getClientModel(sessionId);
          resolvedFeedbackContent = { feedbackLoops: findFeedbackLoops(model?.relationships) };
        }
        const frReqId = message.requestId;
        const frPayload = { feedbackContent: resolvedFeedbackContent, runIds: message.runIds };
        setImmediate(() => resolvePending(sessionManager.getSession(sessionId)?.pendingFeedbackRequests, frReqId, frPayload));
        break;
      }

      case 'agent_text': {
        if (!message.isThinking && message.content) {
          textParts.push(message.content);
        }
        break;
      }

      case 'agent_complete': {
        resolveComplete(message.status);
        break;
      }

      case 'error': {
        rejectComplete(new Error(message.error || 'Agent error'));
        break;
      }

      default:
        break;
    }
  };

  // 5. Compose user message (problemStatement → backgroundKnowledge → prompt)
  const parts = [];
  if (problemStatement) {
    parts.push(
      `The user has stated that they are conducting this modeling exercise to understand the following problem better.\n\n${problemStatement}`
    );
  }
  if (backgroundKnowledge) {
    parts.push(
      `Please be sure to consider the following critically important background information when you give your answer. You MUST use ONLY this background information to answer — do not draw on your own training knowledge or make assumptions beyond what is explicitly stated here. You MUST use the exact variable names as written — do not rename, paraphrase, or substitute any variable name that is explicitly referenced in this information.\n\n${backgroundKnowledge}`
    );
  }
  parts.push(prompt);
  const userMessage = parts.join('\n\n');

  // 6. Run the agent
  const orchestrator = new AgentOrchestrator(
    sessionManager,
    sessionId,
    sendToClient,
    { markdownContent },
    provider
  );

  await Promise.all([
    orchestrator.startConversation(userMessage),
    completionPromise
  ]);

  return {
    lastModel: sessionManager.getClientModel(sessionId),
    explanation: textParts.join('\n\n')
  };
}
