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
 * @param {Object} toolDef        Entry from BuiltInToolProvider's tool collection
 * @param {Object} options
 * @param {string} [options.mode]             'sfd' | 'cld'
 * @param {number} [options.modelTokenCount]  Size of the current model, for the token-range gates
 * @param {Object} [options.session]          Session record, for capability gates
 * @param {boolean} [options.canWriteToLocalSandbox]  The agent's can_write_to_local_sandbox
 *        frontmatter flag. Only tools marked `requiresSandboxWrite` consult it, and it is
 *        read as a grant rather than a default — omitting it withholds those tools.
 */
export function isToolAvailable(toolDef, { mode, modelTokenCount = 0, session = null, canWriteToLocalSandbox } = {}) {
  if (!toolDef) return false;

  if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) return false;
  if (toolDef.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) return false;
  if (toolDef.minModelTokens && modelTokenCount < toolDef.minModelTokens) return false;

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
