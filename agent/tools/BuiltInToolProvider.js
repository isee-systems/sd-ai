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
        generate_documentation: createGenerateDocumentationTool(this.sessionManager, this.sessionId, this.sendToClient),
        generate_ltm_narrative: createGenerateLtmNarrativeTool(),
        discuss_with_mentor: createDiscussWithMentorTool(),
        get_feedback_information: createGetFeedbackInformationTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_current_model: createGetCurrentModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        update_model: createUpdateModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        run_model: createRunModelTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_run_info: createGetRunInfoTool(this.sessionManager, this.sessionId, this.sendToClient),
        get_variable_data: createGetVariableDataTool(this.sessionManager, this.sessionId, this.sendToClient),
        create_visualization: createVisualizationTool(this.sessionManager, this.sessionId, this.sendToClient, this.vizEngine),
        read_model_section: createReadModelSectionTool(this.sessionManager, this.sessionId),
        edit_model_section: createEditModelSectionTool(this.sessionManager, this.sessionId, this.sendToClient)
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
   * Get list of built-in tool names
   */
  getToolNames() {
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
}
