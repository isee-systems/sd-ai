import { VisualizationEngine } from '../utilities/VisualizationEngine.js';
import { sanitizeSchemaForGemini } from './builtin/toolHelpers.js';

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
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createSearchDocumentsTool
} from './builtin/index.js';

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
  constructor(sessionManager, sessionId, sendToClient, provider) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.provider = provider;
    this.vizEngine = new VisualizationEngine(sessionManager, sessionId);
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
        read_file: createReadFileTool(),
        //write_file: createWriteFileTool(),
        //edit_file: createEditFileTool()
        search_documents: createSearchDocumentsTool(this.sessionManager, this.sessionId)
      }
    };
  }

  /**
   * Get the tool collection
   */
  getTools() {
    return this.#createToolCollection();
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
    let count = 0;

    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (toolDef.nonSdkOnly) continue;
      // The Claude Agent SDK — getMcpServer's only caller — provides a native Read
      // tool, so the builtin read_file is redundant here. It must be excluded at
      // registration (not just from the query's allowedTools): bypassPermissions
      // ignores allowedTools, so a registered read_file stays callable alongside
      // native Read. (read_file can't be flagged nonSdkOnly — the Gemini ADK path
      // has no native Read and genuinely needs it.)
      if (toolName === 'read_file') continue;
      if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) continue;
      if (toolDef.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) continue;
      if (toolDef.minModelTokens && modelTokenCount < toolDef.minModelTokens) continue;

      // Tools in SDK mode need to throw errors instead of returning error responses
      const sdkHandler = async (args) => {
        const result = await toolDef.handler(args);
        if (result.isError) {
          throw new Error(result.content[0].text);
        }
        return result;
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
    const adkTools = [];

    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (toolDef.nonSdkOnly) continue;
      if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) continue;
      if (toolDef.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) continue;
      if (toolDef.minModelTokens && modelTokenCount < toolDef.minModelTokens) continue;

      adkTools.push(new FunctionTool({
        name: toolName,
        description: toolDef.description,
        parameters: sanitizeSchemaForGemini(toolDef.inputSchema.toJSONSchema()),
        execute: async (args) => {
          const result = await toolDef.handler(args);
          if (result.isError) throw new Error(result.content[0].text);
          return result.content.map(b => b.text).join('\n');
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
