import { VisualizationEngine } from '../utilities/VisualizationEngine.js';
import { MediaStore } from '../utilities/MediaStore.js';
import { toolResultToText, toMcpContentResult, mediaBlocksOf } from '../utilities/ToolResultFormatter.js';
import { sanitizeSchemaForGemini } from './builtin/toolHelpers.js';
import { isToolAvailable, isToolActive, modelStateGate } from './toolAvailability.js';

// Lazy-loaded provider SDK symbols. Each tool provider serves multiple agent
// loops (SDK, ADK, manual) but only one is selected per session — eagerly
// importing both costs ~500ms (dominated by @google/adk).
// MCP's own McpServer (hoisted @modelcontextprotocol/sdk). Used in place of the
// Claude Agent SDK's tool()/createSdkMcpServer because the agent SDK bundles an
// older MCP whose zod→JSON-Schema converter silently strips field descriptions
// from advertised tool schemas. MCP 1.29's converter is zod-v4-aware and keeps
// them, which the model needs to call rich tools correctly.
let _McpServer;
const loadMcpServer = async () =>
  _McpServer ??= (await import('@modelcontextprotocol/sdk/server/mcp.js')).McpServer;
let _FunctionTool;
const loadFunctionTool = async () =>
  _FunctionTool ??= (await import('@google/adk')).FunctionTool;
import logger from '../../utilities/logger.js';
import {
  createGenerateQuantitativeModelTool,
  createGenerateQualitativeModelTool,
  createDiscussModelWithSeldonTool,
  createDiscussModelAcrossRunsTool,
  createGenerateLtmNarrativeTool,
  createDiscussWithMentorTool,
  createGetFeedbackInformationTool,
  createGetCurrentModelTool,
  createUpdateModelTool,
  createRunModelTool,
  createGetRunInfoTool,
  createGetVariableDataTool,
  createVisualizationTool,
  createDrawCausalLoopDiagramTool,
  createReadModelSectionTool,
  createEditVariablesTool,
  createEditRelationshipsTool,
  createEditSpecsTool,
  createEditModulesTool,
  createGenerateImageTool,
  createViewMediaTool,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createSearchDocumentsTool,
  createErrorResponse
} from './builtin/index.js';

// Builtins the Claude Agent SDK already provides natively, and which therefore must
// not also be registered on its MCP server — a duplicate pair means the model picks
// between two tools that do the same thing, and the mcp__builtin__ copy bypasses the
// SDK's own file tracking. Exported so the orchestrator's allowedTools filter derives
// its exclusions from the same list rather than repeating the names.
export const SDK_FILE_TOOL_TWINS = new Set(['read_file', 'write_file', 'edit_file']);

/**
 * BuiltInToolProvider
 * Provides all built-in SD-AI engine tools plus visualization
 *
 * Handles:
 * - Providing all built-in SD-AI engine tools
 * - Tool creation based on model size limits
 * - Tool collection format for use with Anthropic SDK
 *
 * Tools provided:
 * - generate_quantitative_model
 * - generate_qualitative_model
 * - discuss_model_with_seldon
 * - discuss_model_across_runs
 * - discuss_with_mentor
 * - generate_ltm_narrative
 * - create_visualization
 * - draw_causal_loop_diagram
 * - get_feedback_information
 * - get_current_model
 * - update_model
 * - run_model
 * - get_run_info
 * - get_variable_data
 * - read_model_section (for reading parts of large models)
 * - edit_variables, edit_relationships, edit_specs, edit_modules (for editing parts of large models)
 */
export class BuiltInToolProvider {
  // mediaStore is required, and injected by AgentOrchestrator, which shares one
  // instance across both tool providers and its own image-block hydration. vizEngine
  // is constructed here instead because nothing outside this provider uses it; media
  // is used everywhere, which is the difference. Required rather than defaulted so
  // there is exactly one construction site to reason about.
  // canWriteToLocalSandbox comes from the agent's own frontmatter, not the session:
  // it is a property of who the agent is, fixed for the provider's whole lifetime,
  // which is why it is a constructor argument rather than something re-read per pass
  // the way the media gates read the client's declarations.
  // agentProfile is `{provider, intelligence}` and is the orchestrator's LIVE object,
  // not a copy: setIntelligence() mutates it in place. The tools below capture it once
  // at registration but only read it inside their handlers, so a level change mid
  // conversation reaches the next tool call without re-registering anything. A bare
  // provider string is still accepted (selectEngineModel normalizes it) so existing
  // callers and tests keep working.
  constructor(sessionManager, sessionId, sendToClient, agentProfile, mediaStore, canWriteToLocalSandbox) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.agentProfile = agentProfile;
    this.vizEngine = new VisualizationEngine(sessionManager, sessionId);
    this.mediaStore = mediaStore;
    this.canWriteToLocalSandbox = canWriteToLocalSandbox;

    // Images a built-in tool produced on the google-sdk (ADK) route, waiting to be
    // pushed onto the next request. Drained by the orchestrator's
    // beforeModelCallback, which drains both providers' queues.
    this.pendingAdkMedia = [];

    // MCP handles for the tools whose availability follows the model, keyed by name:
    // { registered, toolDef }. Populated by getMcpServer, read by
    // syncModelStateGates. Empty on every other route, which rebuilds its tool list
    // instead of toggling one.
    this.#mcpModelStateTools = new Map();
  }

  // Private because nothing outside this class may hold an MCP handle: enabling a
  // tool is how it becomes callable, and that decision belongs to one predicate.
  #mcpModelStateTools;

  /**
   * Bring the MCP tool list back in line with the model, and tell the client it
   * moved. Called after any change to the model, from any source.
   *
   * This is the half of "withhold what cannot be used" that a static list cannot do.
   * The Agent SDK's MCP server is built once per query, so a tool filtered out at
   * registration stays gone for the rest of the turn no matter what the agent does to
   * the model in the meantime — which is how an agent that had just inserted an
   * assembly came to tell a user it could not edit an equation. Toggling the
   * registration instead means MCP recomputes tools/list and notifies the client
   * (autoRefresh, debounced), so the tool appears in the agent's next request.
   *
   * A no-op on every other route: their maps are empty because they rebuild their
   * declarations per turn (and per iteration, in the manual loops) from isToolActive.
   */
  syncModelStateGates() {
    if (this.#mcpModelStateTools.size === 0) return;

    const session = this.#session();

    for (const [toolName, { registered, toolDef }] of this.#mcpModelStateTools) {
      const shouldBeLive = !modelStateGate(toolDef, session);
      // Only on an actual transition: MCP fires a tools/list_changed notification on
      // every update() call, and a model edited in a loop would otherwise notify the
      // client once per edit with nothing to report.
      if (shouldBeLive === registered.enabled) continue;

      shouldBeLive ? registered.enable() : registered.disable();
      logger.log(`${shouldBeLive ? 'Restored' : 'Withheld'} ${toolName} — model state changed`);
    }
  }

  /**
   * Create the tool collection with all built-in tools
   */
  #createToolCollection() {
    return this.#applyModelStateGates({
      name: 'builtin_core_tools',
      tools: {
        generate_quantitative_model: createGenerateQuantitativeModelTool(this.sessionManager, this.sessionId, this.sendToClient, this.agentProfile),
        generate_qualitative_model: createGenerateQualitativeModelTool(this.sessionManager, this.sessionId, this.sendToClient, this.agentProfile),
        discuss_model_with_seldon: createDiscussModelWithSeldonTool(this.sessionManager, this.sessionId, this.sendToClient, this.agentProfile),
        discuss_model_across_runs: createDiscussModelAcrossRunsTool(this.sessionManager, this.sessionId, this.sendToClient, this.agentProfile),
        generate_ltm_narrative: createGenerateLtmNarrativeTool(this.sessionManager, this.sessionId, this.sendToClient, this.agentProfile),
        discuss_with_mentor: createDiscussWithMentorTool(this.sessionManager, this.sessionId, this.sendToClient, this.agentProfile),
        get_feedback_information: createGetFeedbackInformationTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_current_model: createGetCurrentModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        update_model: createUpdateModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        run_model: createRunModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_run_info: createGetRunInfoTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_variable_data: createGetVariableDataTool(this.sessionManager, this.sessionId, this.sendToClient),
        create_visualization: createVisualizationTool(this.sessionManager, this.sessionId, this.sendToClient, this.vizEngine, this.agentProfile),
        draw_causal_loop_diagram: createDrawCausalLoopDiagramTool(this.sessionManager, this.sessionId, this.sendToClient, this.vizEngine, this.agentProfile),
        read_model_section: createReadModelSectionTool(this.sessionManager, this.sessionId),
        edit_variables: createEditVariablesTool(this.sessionManager, this.sessionId, this.sendToClient),
        edit_relationships: createEditRelationshipsTool(this.sessionManager, this.sessionId, this.sendToClient),
        edit_specs: createEditSpecsTool(this.sessionManager, this.sessionId, this.sendToClient),
        edit_modules: createEditModulesTool(this.sessionManager, this.sessionId, this.sendToClient),
        read_file: createReadFileTool(this.sessionManager, this.sessionId),
        // Built unconditionally and withdrawn by isToolAvailable unless the agent's
        // frontmatter grants can_write_to_local_sandbox — the collection is the
        // catalogue of what exists, the predicate decides what this agent may see.
        // This is what lets a future manual-mode agent opt in and actually get them.
        write_file: createWriteFileTool(this.sessionManager, this.sessionId),
        edit_file: createEditFileTool(this.sessionManager, this.sessionId),
        search_documents: createSearchDocumentsTool(this.sessionManager, this.sessionId),
        generate_image: createGenerateImageTool(this.sessionManager, this.sessionId, this.mediaStore, this.agentProfile),
        view_media: createViewMediaTool(this.mediaStore)
      }
    });
  }

  /**
   * Wrap every handler in the model-shaped gates, so they are decided against the
   * model as it stands when the tool is CALLED.
   *
   * Applied to the collection rather than at each route's registration because the
   * collection is what all five routes build from — the MCP server, ADK, and the
   * three manual loops all reach the same handler through it, and a gate installed
   * anywhere else would have to be installed five times.
   *
   * The refusal comes back as an ordinary error envelope, which each route already
   * knows how to deliver: the SDK's wrapper throws it, ADK turns it into text, the
   * manual loops hand it back as a tool result. In every case the model reads a
   * sentence naming what to do instead and can act on it in the same turn.
   */
  #applyModelStateGates(toolCollection) {
    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (!toolDef.requiresModelContent && !toolDef.maxModelTokens) continue;

      const inner = toolDef.handler;
      toolDef.handler = async (args) => {
        const refusal = modelStateGate(toolDef, this.#session());
        if (refusal) {
          logger.log(`Withheld ${toolName} at call time: ${refusal}`);
          return createErrorResponse(`${toolName} cannot run right now — ${refusal}`);
        }
        return inner(args);
      };
    }

    return toolCollection;
  }

  /**
   * Get the tool collection
   */
  getTools() {
    return this.#createToolCollection();
  }

  // Read fresh on each filtering pass rather than cached in the constructor: the
  // provider outlives initialize_session, and the client's tool list is what the
  // media gates are derived from.
  #session() {
    return this.sessionManager.getSession(this.sessionId);
  }

  /**
   * Create MCP server from tool instances (for SDK mode)
   *
   * Session-fixed constraints — mode, sandbox grant, media capability — are filtered
   * HERE, at registration time, NOT via the SDK query's allowedTools. Under
   * permissionMode 'bypassPermissions' the Agent SDK auto-approves every registered
   * tool regardless of allowedTools (allowedTools only pre-approves; it never removes
   * a tool the model can see). A tool left on the server — e.g.
   * draw_causal_loop_diagram, which is sfd-only, in cld mode — would still be
   * advertised and callable. Omitting it from the server is the only reliable way
   * to keep it unavailable. Mirrors the filtering in getAdkTools.
   *
   * Model-SIZE constraints are deliberately not applied here. This server is built
   * once per query and cannot be re-registered while the query runs. A tool gated on
   * the model is registered here whether or not it is usable yet, and then disabled —
   * MCP omits a disabled tool from tools/list and refuses a call to it, so the agent
   * does not see it, and syncModelStateGates can bring it back the moment the model
   * makes it legal. Registering only the live ones would leave nothing to revive.
   * @returns {Object} MCP server instance
   */
  async getMcpServer(mode) {
    const McpServer = await loadMcpServer();
    const toolCollection = this.#createToolCollection();
    const server = new McpServer({ name: 'builtin', version: '1.0.0' });
    const session = this.#session();
    let count = 0;
    let withheld = 0;

    this.#mcpModelStateTools = new Map();

    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (toolDef.nonSdkOnly) continue;
      // The Claude Agent SDK — getMcpServer's only caller — provides native Read,
      // Write and Edit, so these three builtins are redundant here. They must be
      // excluded at registration (not just from the query's allowedTools):
      // bypassPermissions ignores allowedTools, so a registered read_file stays
      // callable alongside native Read. (They can't be flagged nonSdkOnly — the
      // Gemini ADK and manual paths have no native equivalents and genuinely need
      // them; that is the whole point of SDK_FILE_TOOL_TWINS being a route fact
      // rather than a property of the tools.)
      if (SDK_FILE_TOOL_TWINS.has(toolName)) continue;
      if (!isToolAvailable(toolDef, { mode, session, canWriteToLocalSandbox: this.canWriteToLocalSandbox })) continue;

      // Tools in SDK mode need to throw errors instead of returning error responses
      const sdkHandler = async (args) => {
        const result = await toolDef.handler(args);
        if (result.isError) {
          throw new Error(toolResultToText(result));
        }
        // Converted, not returned raw. MCP validates the content array against its
        // own union — text | image | audio | resource_link | resource — and our
        // internal media handle block is none of those, so returning it unconverted
        // makes MCP reject the whole call with an invalid_union error. This is where
        // a generated picture becomes an MCP image block the model can see.
        return toMcpContentResult(result, this.mediaStore);
      };

      // Register via MCP's own registerTool so MCP 1.29's zod-v4-aware converter
      // builds the advertised schema (preserving field descriptions and full
      // structure). registerTool takes the raw zod shape and wraps it internally.
      const registered = server.registerTool(toolName, {
        description: toolDef.description,
        inputSchema: toolDef.inputSchema.shape
      }, sdkHandler);
      count++;

      if (!toolDef.requiresModelContent && !toolDef.maxModelTokens) continue;

      // Held so syncModelStateGates can flip it later. Disabling before the server is
      // connected is silent by design — MCP's sendToolListChanged is a no-op until
      // there is a client — so a tool that starts dead is simply never advertised,
      // rather than advertised and then retracted in front of the agent.
      this.#mcpModelStateTools.set(toolName, { registered, toolDef });
      if (modelStateGate(toolDef, session)) {
        registered.disable();
        withheld++;
      }
    }

    logger.log(`Creating builtin MCP server with ${count - withheld} tools (${withheld} withheld pending model state)`);
    // Match the shape the Agent SDK's createSdkMcpServer returns; query() consumes
    // `instance` as a generic MCP server over a transport (no class check).
    return { type: 'sdk', name: 'builtin', instance: server };
  }

  async getAdkTools(mode) {
    const FunctionTool = await loadFunctionTool();
    const toolCollection = this.getTools();
    const session = this.#session();
    const adkTools = [];

    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (toolDef.nonSdkOnly) continue;
      if (!isToolActive(toolDef, { mode, session, canWriteToLocalSandbox: this.canWriteToLocalSandbox })) continue;

      adkTools.push(new FunctionTool({
        name: toolName,
        description: toolDef.description,
        parameters: sanitizeSchemaForGemini(toolDef.inputSchema.toJSONSchema()),
        execute: async (args) => {
          const result = await toolDef.handler(args);
          if (result.isError) throw new Error(toolResultToText(result));

          // ADK has no way to return an image from a tool at all — see
          // DynamicToolProvider.getAdkTools. Without queueing it here, a picture
          // from generate_image or view_media would be silently dropped and the
          // model would never see anything it drew on this route.
          for (const media of mediaBlocksOf(result)) {
            this.pendingAdkMedia.push(media);
          }

          return toolResultToText(result);
        }
      }));
    }

    // Debug, not log: the ADK route resolves this before every model request now
    // (see createAdkLiveToolset), so an info-level line here would narrate every pass.
    logger.debug(`Built ${adkTools.length} ADK tools for mode=${mode}`);
    return adkTools;
  }

  /**
   * Get list of built-in tool names
   */
  getToolNames() {
    const toolCollection = this.#createToolCollection();
    return Object.keys(toolCollection.tools);
  }
}
