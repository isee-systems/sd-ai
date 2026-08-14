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
 * The gates that depend on the MODEL rather than the session, checked when a tool is
 * CALLED rather than when it is registered.
 *
 * They are here, and not in isToolAvailable, because the model changes inside a turn
 * while a route's tool list does not. Every route builds its tool list once, at the
 * top of the turn — and on the Agent SDK route it is an MCP server that cannot be
 * re-registered mid-query at all. Deciding a model-shaped gate there freezes an
 * answer that was only true of the model as it stood before the agent touched it: an
 * agent that inserted an assembly into an empty model spent the rest of that turn
 * believing it had no way to edit an equation, and told the user to go and
 * double-click the converters by hand.
 *
 * So these two are decided against the live session at call time, and every route
 * registers the tools they gate unconditionally. The cost is one wasted call when a
 * tool is genuinely out of range — paid back by the message, which names the tool to
 * use instead.
 *
 * @param {Object} toolDef  Entry from BuiltInToolProvider's tool collection
 * @param {Object} session  The session record, read live — not a snapshot
 * @returns {string|null}   Why the call must be refused, or null to let it through
 */
export function modelStateGate(toolDef, session) {
  if (!toolDef) return null;

  if (toolDef.requiresModelContent && !modelHasContent(session?.clientModel)) {
    return 'the model is empty and a targeted edit needs something to edit. Build the structure first with generate_quantitative_model (SFD) or generate_qualitative_model (CLD), then edit it.';
  }

  if (toolDef.maxModelTokens) {
    // Kept current by SessionManager.updateClientModel, which recomputes it on every
    // model change from any source — a generate_* call, a targeted edit, or a model
    // the client pushed after its own user edited it.
    const tokens = session?.modelTokenCount ?? 0;
    if (tokens > toolDef.maxModelTokens) {
      return `this model is ~${tokens} tokens, past the ${toolDef.maxModelTokens}-token ceiling for the generative engines. Change it with the targeted-edit tools instead: edit_variables, edit_relationships, edit_specs, edit_modules.`;
    }
  }

  return null;
}
