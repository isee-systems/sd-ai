import { VisualizationEngine } from '../utilities/VisualizationEngine.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { FunctionTool } from '@google/adk';
import { tool, sanitizeSchemaForGemini } from './builtin/toolHelpers.js';
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
  createReadModelSectionTool,
  createEditModelSectionTool,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool
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
 * - get_feedback_information
 * - get_current_model
 * - update_model
 * - run_model
 * - get_run_info
 * - get_variable_data
 * - read_model_section (for reading parts of large models)
 * - edit_model_section (for editing parts of large models)
 */
export class BuiltInToolProvider {
  constructor(sessionManager, sessionId, sendToClient) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.vizEngine = new VisualizationEngine(sessionManager, sessionId);
  }

  /**
   * Create the tool collection with all built-in tools
   */
  createToolCollection() {
    return {
      name: 'builtin_core_tools',
      tools: {
        generate_quantitative_model: createGenerateQuantitativeModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        generate_qualitative_model: createGenerateQualitativeModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        discuss_model_with_seldon: createDiscussModelWithSeldonTool(this.sessionManager, this.sessionId, this.sendToClient),
        discuss_model_across_runs: createDiscussModelAcrossRunsTool(this.sessionManager, this.sessionId, this.sendToClient),
        generate_ltm_narrative: createGenerateLtmNarrativeTool(this.sessionManager, this.sessionId, this.sendToClient),
        discuss_with_mentor: createDiscussWithMentorTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_feedback_information: createGetFeedbackInformationTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_current_model: createGetCurrentModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        update_model: createUpdateModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        run_model: createRunModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_run_info: createGetRunInfoTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_variable_data: createGetVariableDataTool(this.sessionManager, this.sessionId, this.sendToClient),
        create_visualization: createVisualizationTool(this.sessionManager, this.sessionId, this.sendToClient, this.vizEngine),
        read_model_section: createReadModelSectionTool(this.sessionManager, this.sessionId),
        edit_model_section: createEditModelSectionTool(this.sessionManager, this.sessionId, this.sendToClient),
        read_file: createReadFileTool()
        //write_file: createWriteFileTool(),
        //edit_file: createEditFileTool()
      }
    };
  }

  /**
   * Get the tool collection
   */
  getTools() {
    return this.createToolCollection();
  }

  /**
   * Create MCP server from tool instances (for SDK mode)
   * Exposes all built-in tools — allowedTools in the SDK query handles mode/token filtering
   * @returns {Object} MCP server instance
   */
  getMcpServer() {
    const toolCollection = this.createToolCollection();
    const toolsArr = [];

    for (const [toolName, toolDef] of Object.entries(toolCollection.tools)) {
      if (toolDef.nonSdkOnly) continue;

      // Tools in SDK mode need to throw errors instead of returning error responses
      const sdkHandler = async (args) => {
        const result = await toolDef.handler(args);
        if (result.isError) {
          throw new Error(result.content[0].text);
        }
        return result;
      };

      toolsArr.push(tool({
        name: toolName,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        execute: sdkHandler
      }));
    }

    logger.log(`Creating builtin MCP server with ${toolsArr.length} tools`);
    return createSdkMcpServer({
      name: 'builtin',
      version: '1.0.0',
      tools: toolsArr
    });
  }

  getAdkTools(mode = null, modelTokenCount = 0) {
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
    const toolCollection = this.createToolCollection();
    return Object.keys(toolCollection.tools);
  }
}
