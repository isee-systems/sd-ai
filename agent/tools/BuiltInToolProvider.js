import { VisualizationEngine } from '../utilities/VisualizationEngine.js';
import { MediaStore } from '../utilities/MediaStore.js';
import { toolResultToText, toMcpContentResult, mediaBlocksOf } from '../utilities/ToolResultFormatter.js';
import { sanitizeSchemaForGemini } from './builtin/toolHelpers.js';
import { isToolAvailable } from './toolAvailability.js';

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
  createSearchDocumentsTool
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
  constructor(sessionManager, sessionId, sendToClient, provider, mediaStore, canWriteToLocalSandbox) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.provider = provider;
    this.vizEngine = new VisualizationEngine(sessionManager, sessionId);
    this.mediaStore = mediaStore;
    this.canWriteToLocalSandbox = canWriteToLocalSandbox;

    // Images a built-in tool produced on the google-sdk (ADK) route, waiting to be
    // pushed onto the next request. Drained by the orchestrator's
    // beforeModelCallback, which drains both providers' queues.
    this.pendingAdkMedia = [];
  }

  /**
   * Create the tool collection with all built-in tools
   */
  #createToolCollection() {
    return {
      name: 'builtin_core_tools',
      tools: {
        generate_quantitative_model: createGenerateQuantitativeModelTool(this.sessionManager, this.sessionId, this.sendToClient, this.provider),
        generate_qualitative_model: createGenerateQualitativeModelTool(this.sessionManager, this.sessionId, this.sendToClient, this.provider),
        discuss_model_with_seldon: createDiscussModelWithSeldonTool(this.sessionManager, this.sessionId, this.sendToClient, this.provider),
        discuss_model_across_runs: createDiscussModelAcrossRunsTool(this.sessionManager, this.sessionId, this.sendToClient, this.provider),
        generate_ltm_narrative: createGenerateLtmNarrativeTool(this.sessionManager, this.sessionId, this.sendToClient, this.provider),
        discuss_with_mentor: createDiscussWithMentorTool(this.sessionManager, this.sessionId, this.sendToClient, this.provider),
        get_feedback_information: createGetFeedbackInformationTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_current_model: createGetCurrentModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        update_model: createUpdateModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        run_model: createRunModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_run_info: createGetRunInfoTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_variable_data: createGetVariableDataTool(this.sessionManager, this.sessionId, this.sendToClient),
        create_visualization: createVisualizationTool(this.sessionManager, this.sessionId, this.sendToClient, this.vizEngine, this.provider),
        draw_causal_loop_diagram: createDrawCausalLoopDiagramTool(this.sessionManager, this.sessionId, this.sendToClient, this.vizEngine, this.provider),
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
        generate_image: createGenerateImageTool(this.sessionManager, this.sessionId, this.mediaStore, this.provider),
        view_media: createViewMediaTool(this.mediaStore)
      }
    };
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
   * Tools are filtered by mode and model-token constraints HERE, at registration
   * time — NOT via the SDK query's allowedTools. Under permissionMode
   * 'bypassPermissions' the Agent SDK auto-approves every registered tool
   * regardless of allowedTools (allowedTools only pre-approves; it never removes a
   * tool the model can see). A tool left on the server — e.g.
   * draw_causal_loop_diagram, which is sfd-only, in cld mode — would still be
   * advertised and callable. Omitting it from the server is the only reliable way
   * to keep it unavailable. Mirrors the filtering in getAdkTools.
   * @returns {Object} MCP server instance
   */
  async getMcpServer(mode, modelTokenCount) {
    const McpServer = await loadMcpServer();
    const toolCollection = this.#createToolCollection();
    const server = new McpServer({ name: 'builtin', version: '1.0.0' });
    const session = this.#session();
    let count = 0;

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
      if (!isToolAvailable(toolDef, { mode, modelTokenCount, session, canWriteToLocalSandbox: this.canWriteToLocalSandbox })) continue;

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
      server.registerTool(toolName, {
        description: toolDef.description,
        inputSchema: toolDef.inputSchema.shape
      }, sdkHandler);
      count++;
    }

    logger.log(`Creating builtin MCP server with ${count} tools`);
    // Match the shape the Agent SDK's createSdkMcpServer returns; query() consumes
    // `instance` as a generic MCP server over a transport (no class check).
    return { type: 'sdk', name: 'builtin', instance: server };
  }

  async getAdkTools(mode, modelTokenCount) {
    const FunctionTool = await loadFunctionTool();
    const toolCollection = this.getTools();
    const session = this.#session();
    const adkTools = [];

    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (toolDef.nonSdkOnly) continue;
      if (!isToolAvailable(toolDef, { mode, modelTokenCount, session, canWriteToLocalSandbox: this.canWriteToLocalSandbox })) continue;

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

    logger.log(`Built ${adkTools.length} ADK tools for mode=${mode}`);
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
