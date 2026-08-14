import { countTokens } from '@anthropic-ai/tokenizer';

/**
 * The one place that decides whether a built-in tool is offered to the model.
 *
 * Every provider route builds its own tool list — the Agent SDK's MCP server, ADK,
 * the two manual loops, OpenRouter's agent and its manual twin — and each used to
 * repeat the same three checks inline. Seven copies of a predicate is seven chances
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
 * What every route builds its declaration list from. The one caller that cannot use
 * it is the SDK's MCP registration, which has to register a tool it intends to
 * withhold so it has something to re-enable later — it composes the same two
 * predicates itself.
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
 * Callers use this two ways. Routes that can rebuild a tool list — the manual loops,
 * and every route at the top of a turn — treat a refusal as "withhold this tool"
 * (see isToolActive). The SDK's MCP server, which is built once per query and cannot
 * be rebuilt while the query runs, registers the tool and toggles it instead, which
 * MCP reports to the client as a tools/list change. Either way the handler re-checks
 * when it runs, since no list is perfectly current at the instant of the call.
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
