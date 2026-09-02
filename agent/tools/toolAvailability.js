import { countTokens } from '@anthropic-ai/tokenizer';

/**
 * The one place that decides whether a built-in tool is offered to the model.
 *
 * Every provider route builds its own tool list — the Agent SDK's MCP server, ADK,
 * the four manual loops, and OpenRouter's agent — and each used to repeat the same
 * three checks inline. Seven copies of a predicate is seven chances
 * for a fourth condition to land in six of them, and a tool that stays advertised
 * on one route after being withdrawn everywhere else is exactly the kind of bug
 * that only shows up on the provider nobody tested. Add a condition here and every
 * route gets it.
 *
 * Route-specific exclusions (nonSdkOnly, the SDK's native Read shadowing read_file)
 * deliberately stay at their call sites: they are facts about the route, not about
 * the tool's availability in this session.
 */

/**
 * What media this session can actually do, read off the client's own declarations.
 *
 * Two independent questions, because the two media tools need different answers.
 * A client tool that takes a handle is somewhere a picture can *go*; one that
 * returns media is somewhere a picture can *come from*. A session with neither has
 * no way for an image to exist or be used, however capable the client claims to be.
 */
export function mediaCapability(session) {
  const clientTools = session?.clientTools ?? [];

  return {
    // The client's own statement that it can decode and display images at all.
    // Absent on every client that predates media, which is why it gates rather
    // than merely informs: silence means no.
    declared: session?.supportsMedia === true,
    hasSink: clientTools.some(tool => (tool?.media?.inputs?.length ?? 0) > 0),
    hasSource: clientTools.some(tool => tool?.media?.returnsMedia === true)
  };
}

/**
 * Whether a built-in tool should be advertised for this session.
 *
 * Everything decided here is fixed for the session: which mode it opened in, what the
 * agent's frontmatter grants, what the client declared it can display. The gates that
 * depend on the MODEL are deliberately NOT here — see modelStateGate.
 *
 * @param {Object} toolDef        Entry from BuiltInToolProvider's tool collection
 * @param {Object} options
 * @param {string} [options.mode]             'sfd' | 'cld'
 * @param {Object} [options.session]          Session record, for capability gates
 * @param {boolean} [options.canWriteToLocalSandbox]  The agent's can_write_to_local_sandbox
 *        frontmatter flag. Only tools marked `requiresSandboxWrite` consult it, and it is
 *        read as a grant rather than a default — omitting it withholds those tools.
 */
export function isToolAvailable(toolDef, { mode, session = null, canWriteToLocalSandbox } = {}) {
  if (!toolDef) return false;

  if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) return false;

  // The agent's own grant to modify the sandbox, absent unless its frontmatter asks
  // for it. Reading is never gated here — see AgentConfigurationManager.
  if (toolDef.requiresSandboxWrite && !canWriteToLocalSandbox) return false;

  // 'sink' — the tool produces a picture, so it needs somewhere to put one.
  // 'any'  — the tool operates on pictures that already exist, so it needs either
  //          a sink (which makes generate_image available, which makes handles) or
  //          a source (a client tool that hands one back).
  if (toolDef.requiresMedia) {
    const { declared, hasSink, hasSource } = mediaCapability(session);
    if (!declared) return false;
    if (toolDef.requiresMedia === 'sink' && !hasSink) return false;
    if (toolDef.requiresMedia === 'any' && !hasSink && !hasSource) return false;
  }

  return true;
}

/**
 * Does this model have anything in it to edit?
 *
 * Variables, specifically — relationships and modules are arrangements OF variables,
 * so a model carrying only those is either empty or malformed, and in both cases
 * there is nothing for a targeted edit to land on.
 */
export function modelHasContent(model) {
  return (model?.variables?.length ?? 0) > 0;
}

/**
 * How big this session's model is in tokens, measured at most once per version of it.
 *
 * Cached on the session and invalidated by SessionManager.updateClientModel, because
 * the two frequencies are nothing alike: a model changes on every edit in a long
 * building loop, while the number is read only when a tool list is built or a gated
 * tool is called. Measuring on write tokenized a whole model to answer a question
 * nobody had asked yet.
 *
 * Pretty-printed to match what the routes measure, so a count filled in by a route at
 * the top of a turn and one computed here are the same quantity.
 */
export function measureModelTokens(session) {
  if (!session) return 0;

  if (session.modelTokenCount == null) {
    session.modelTokenCount = session.clientModel
      ? countTokens(JSON.stringify(session.clientModel, null, 2))
      : 0;
  }

  return session.modelTokenCount;
}

/**
 * Whether a tool should be in the agent's tool list right now: allowed for this
 * session AND usable against the model as it currently stands.
 *
 * What a route builds its declaration list from WHEN it can rebuild that list before
 * every model request AND can survive being wrong about it: the four manual loops,
 * which answer a call to a name they no longer offer with an ordinary "Tool not found"
 * result. Three routes do not use this:
 *
 * - the Claude Agent SDK's MCP registration, which has to register a tool it intends
 *   to withhold so it has something to re-enable later, and so composes the same two
 *   predicates itself;
 * - the OpenRouter agent SDK, which is handed one tool array per run and offers no
 *   hook to replace it, and so advertises the isToolAvailable superset and leans on
 *   the call-time gate. See #buildOpenRouterTools.
 * - the ADK route, which CAN rebuild its list per request but cannot survive an
 *   unresolvable call: ADK throws out of its own function dispatch and the invocation
 *   ends. It advertises the superset for that reason. See getAdkTools.
 */
export function isToolActive(toolDef, options = {}) {
  return isToolAvailable(toolDef, options) && !modelStateGate(toolDef, options.session);
}

/**
 * The gates that depend on the MODEL rather than the session.
 *
 * Separate from isToolAvailable because they are not answered once. A session's mode
 * and grants hold for its whole life; the model changes inside a single turn — a
 * generate_* call, a targeted edit, an assembly the user's application inserted
 * through a client tool. A tool gated on the model is therefore live or dead at a
 * moment, not for a session, and both states have to reach the agent as they happen:
 * a dead tool withheld from its list, a revived one put back into it. What used to
 * happen instead was that an agent watched an assembly land in an empty model and
 * spent the rest of that turn believing it had no way to edit an equation, because
 * edit_variables had been filtered out when the turn began.
 *
 * Callers use this three ways, one per shape of route:
 *
 * - The four manual loops rebuild their declaration list before every model request and
 *   treat a refusal as "withhold this tool" (see isToolActive). They can, because a call
 *   to a name they did not offer comes back to the model as "Tool not found".
 * - The Claude Agent SDK's MCP server is built once per query and cannot be rebuilt
 *   while the query runs, so it registers the tool and toggles it instead, which MCP
 *   reports to the client as a tools/list change.
 * - The OpenRouter and ADK routes advertise the superset and let the refusal below do
 *   the work, because a tool wrongly offered costs one call while a tool wrongly
 *   withheld costs the run. OpenRouter has no choice — one array per run, no hook to
 *   replace it. ADK could rebuild per request but must not withhold: it throws
 *   `Function <name> is not found in the toolsDict` for a call it cannot resolve, and
 *   that kills the invocation. Both rely entirely on the refusal reaching the model as
 *   a tool result, which is what makes the wording below load-bearing rather than
 *   advisory — it is the only thing telling the agent what to do instead.
 *
 * All three rely on the handler re-checking when it runs, since no list is perfectly
 * current at the instant of the call.
 *
 * @param {Object} toolDef  Entry from BuiltInToolProvider's tool collection
 * @param {Object} session  The session record, read live — not a snapshot
 * @returns {string|null}   Why the tool is dead right now, or null if it is live
 */
export function modelStateGate(toolDef, session) {
  if (!toolDef) return null;

  if (toolDef.requiresModelContent && !modelHasContent(session?.clientModel)) {
    return 'the model is empty and a targeted edit needs something to edit. Build the structure first with generate_quantitative_model (SFD) or generate_qualitative_model (CLD), then edit it.';
  }

  if (toolDef.maxModelTokens) {
    // Measured against the model as it stands: SessionManager.updateClientModel drops
    // the cached count on every change from any source — a generate_* call, a targeted
    // edit, or a model the client pushed after its own user edited it.
    const tokens = measureModelTokens(session);
    if (tokens > toolDef.maxModelTokens) {
      return `this model is ~${tokens} tokens, past the ${toolDef.maxModelTokens}-token ceiling for the generative engines. Change it with the targeted-edit tools instead: edit_variables, edit_relationships, edit_specs, edit_modules.`;
    }
  }

  return null;
}

/**
 * A toolset whose contents ADK re-resolves before every model request.
 *
 * Lives here rather than beside the ADK route because it is the ADK answer to the
 * question this file exists to ask. The route builds its agent once per turn, so a
 * plain `tools: [...]` array is frozen for the whole turn: whatever the session looked
 * like when the turn began is what the model keeps seeing for the rest of it.
 *
 * What it deliberately does NOT re-resolve is the model-state gates. Withholding is
 * only safe on a route that can answer a call to a name it stopped offering, and ADK
 * cannot: getToolAndContext throws `Function <name> is not found in the toolsDict`,
 * the invocation ends there, and the agent loses the turn rather than a call. So
 * getAdkTools resolves the isToolAvailable superset here and lets the call-time gate
 * refuse in words the model can act on — see modelStateGate above. Re-resolving still
 * earns its place for everything else the list is built from, which is read off the
 * live session rather than a snapshot taken when the turn opened.
 *
 * ADK's own answer is BaseToolset. LlmAgent.runOneStepAsync builds a fresh LlmRequest
 * per model call and resolves every entry of `tools` through convertToolUnionToTools,
 * which calls `getTools()` on anything that is not already a BaseTool. Handing it a
 * toolset instead of an array therefore moves the filtering decision from
 * once-per-turn to once-per-pass, which is where it belongs.
 *
 * Lazy like every other @google/adk symbol in this codebase: the class cannot be
 * declared until the module is loaded, and loading it costs ~500ms that a session on
 * any other provider must not pay. Memoized at module scope so the import lands once
 * per worker process.
 *
 * @param {() => Promise<Array>} resolveTools  Called before every model request; returns
 *        the ADK FunctionTools the model should see right now.
 */
let _AdkLiveToolset;

export async function createAdkLiveToolset(resolveTools) {
  if (!_AdkLiveToolset) {
    const { BaseToolset } = await import('@google/adk');

    _AdkLiveToolset = class AdkLiveToolset extends BaseToolset {
      constructor(resolve) {
        // No static toolFilter: the resolver already returns exactly the live set, and
        // a second predicate here would be a second place to keep in sync.
        super([]);
        this.resolve = resolve;
      }

      async getTools() {
        return this.resolve();
      }

      // Nothing to release — these tools hold no connections or handles of their own.
      // Required because BaseToolset declares it abstract, and Runner calls close() on
      // every toolset it can reach when an agent server winds down.
      async close() {}
    };
  }

  return new _AdkLiveToolset(resolveTools);
}
