import { VisualizationEngine } from '../utilities/VisualizationEngine.js';
import {
  createGenerateQuantitativeModelTool,
  createGenerateQualitativeModelTool,
  createDiscussModelWithSeldonTool,
  createDiscussModelAcrossRunsTool,
  createGenerateDocumentationTool,
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
  createEditModelSectionTool
} from './builtin/index.js';

/**
 * BuiltInTools
 * Creates an MCP server with all SD-AI engine tools plus visualization
 *
 * Tools provided:
 * - generate_quantitative_model
 * - generate_qualitative_model
 * - discuss_model_with_seldon
 * - discuss_model_across_runs
 * - discuss_with_mentor
 * - generate_documentation
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

/**
 * Create built-in tools MCP server
 *
 * Note: This is a placeholder for the actual MCP server creation
 * The Claude Agent SDK's createSdkMcpServer will be used here
 */
export function createBuiltInToolsServer(sessionManager, sessionId, sendToClient) {
  // For now, return a plain object with tool definitions
  // This will be converted to an MCP server when integrating with Claude Agent SDK

  const vizEngine = new VisualizationEngine(sessionManager, sessionId);

  return {
    name: 'builtin_core_tools',
    tools: {
      generate_quantitative_model: createGenerateQuantitativeModelTool(sessionManager, sessionId, sendToClient),
      generate_qualitative_model: createGenerateQualitativeModelTool(sessionManager, sessionId, sendToClient),
      discuss_model_with_seldon: createDiscussModelWithSeldonTool(sessionManager, sessionId, sendToClient),
      discuss_model_across_runs: createDiscussModelAcrossRunsTool(sessionManager, sessionId, sendToClient),
      generate_documentation: createGenerateDocumentationTool(sessionManager, sessionId, sendToClient),
      generate_ltm_narrative: createGenerateLtmNarrativeTool(),
      discuss_with_mentor: createDiscussWithMentorTool(),
      get_feedback_information: createGetFeedbackInformationTool(sessionManager, sessionId, sendToClient),
      get_current_model: createGetCurrentModelTool(sessionManager, sessionId, sendToClient),
      update_model: createUpdateModelTool(sessionManager, sessionId, sendToClient),
      run_model: createRunModelTool(sessionManager, sessionId, sendToClient),
      get_run_info: createGetRunInfoTool(sessionManager, sessionId, sendToClient),
      get_variable_data: createGetVariableDataTool(sessionManager, sessionId, sendToClient),
      create_visualization: createVisualizationTool(sessionManager, sessionId, sendToClient, vizEngine),
      read_model_section: createReadModelSectionTool(sessionManager, sessionId),
      edit_model_section: createEditModelSectionTool(sessionManager, sessionId, sendToClient)
    }
  };
}

/**
 * Get list of built-in tool names
 */
export function getBuiltInToolNames() {
  return [
    'generate_quantitative_model',
    'generate_qualitative_model',
    'discuss_model_with_seldon',
    'discuss_model_across_runs',
    'discuss_with_mentor',
    'generate_documentation',
    'generate_ltm_narrative',
    'get_feedback_information',
    'get_current_model',
    'update_model',
    'run_model',
    'get_run_info',
    'get_variable_data',
    'create_visualization',
    'read_model_section',
    'edit_model_section'
  ];
}
