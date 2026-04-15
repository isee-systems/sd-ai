import { z } from 'zod';
import {
  callQuantitativeEngine,
  callQualitativeEngine,
  callSeldonEngine,
  callSeldonILEEngine,
  callDocumentationEngine,
  callLTMEngine,
  callSeldonMentorEngine
} from '../utilities/EngineWrapper.js';
import { VisualizationEngine } from '../utilities/VisualizationEngine.js';
import { SDModelSchema } from '../utilities/MessageProtocol.js';
import logger from '../../utilities/logger.js';

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
    name: 'sd_ai_engines',
    tools: {
      generate_quantitative_model: {
        description: 'Generate a Stock Flow Diagram (SFD) model with equations and quantitative structure. Use this for building computational models that can be simulated.',
        inputSchema: z.object({
          prompt: z.string().describe('Description of the model to generate'),
          currentModel: SDModelSchema.optional().describe('Existing model to build upon'),
          parameters: z.object({
            model: z.string().optional(),
            problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
            backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
            supportsArrays: z.boolean().optional().describe('Whether client supports arrayed models'),
            supportsModules: z.boolean().optional().describe('Whether client supports modules')
          }).optional()
        }),
        handler: async ({ prompt, currentModel, parameters }) => {
          try {
            const result = await callQuantitativeEngine(prompt, currentModel, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            // Build response
            const responseText = JSON.stringify({
              model: result.model,
              supportingInfo: result.supportingInfo
            }, null, 2);

            return {
              content: [{
                type: 'text',
                text: responseText
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      generate_qualitative_model: {
        description: 'Generate a Causal Loop Diagram (CLD) showing feedback loops and causal relationships. Use this for conceptual models focusing on system structure.',
        inputSchema: z.object({
          prompt: z.string().describe('Description of the model to generate'),
          currentModel: SDModelSchema.optional().describe('Existing model to build upon'),
          parameters: z.object({
            model: z.string().optional(),
            problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
            backgroundKnowledge: z.string().optional().describe('Background information for LLM')
          }).optional()
        }),
        handler: async ({ prompt, currentModel, parameters }) => {
          try {
            const result = await callQualitativeEngine(prompt, currentModel, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            // Build response
            const responseText = JSON.stringify({
              model: result.model,
              supportingInfo: result.supportingInfo
            }, null, 2);

            return {
              content: [{
                type: 'text',
                text: responseText
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      discuss_model_with_seldon: {
        description: 'Have an expert-level discussion about the model using System Dynamics terminology. Use this for technical analysis and SD theory discussions.',
        inputSchema: z.object({
          prompt: z.string().describe('Question or topic for discussion'),
          model: SDModelSchema.describe('The model to discuss'),
          feedbackLoops: z.array(z.any()).optional().describe('Feedback loop analysis data'),
          parameters: z.object({
            model: z.string().optional(),
            problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
            backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
            behaviorContent: z.string().optional().describe('Time series behavior data')
          }).optional()
        }),
        handler: async ({ prompt, model, feedbackLoops, parameters }) => {
          try {
            const result = await callSeldonEngine(prompt, model, feedbackLoops, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result.output, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      discuss_model_across_runs: {
        description: 'Have a user-friendly discussion about the model without jargon, with the ability to compare and explain differences between simulation runs. Use this for explaining models to beginners or analyzing how different scenarios produce different outcomes.',
        inputSchema: z.object({
          prompt: z.string().describe('Question or topic for discussion'),
          model: SDModelSchema.describe('The model to discuss'),
          runName: z.string().optional().describe('Simulation run ID for context'),
          parameters: z.object({
            model: z.string().optional(),
            problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
            backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
            behaviorContent: z.string().optional().describe('Time series behavior data')
          }).optional()
        }),
        handler: async ({ prompt, model, runName, parameters }) => {
          try {
            const result = await callSeldonILEEngine(prompt, model, runName, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result.output, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      generate_documentation: {
        description: 'Auto-generate documentation for model variables including descriptions and polarity.',
        inputSchema: z.object({
          model: SDModelSchema.describe('The model to document'),
          parameters: z.object({
            model: z.string().optional()
          }).optional()
        }),
        handler: async ({ model, parameters }) => {
          try {
            const result = await callDocumentationEngine(model, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  model: result.model,
                  supportingInfo: result.supportingInfo
                }, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      generate_ltm_narrative: {
        description: 'Generate a narrative explanation of feedback loops and their influence on model behavior (Loops That Matter analysis).',
        inputSchema: z.object({
          model: SDModelSchema.describe('The model to analyze'),
          feedbackLoops: z.array(z.any()).describe('Feedback loop analysis data'),
          parameters: z.object({
            model: z.string().optional()
          }).optional()
        }),
        handler: async ({ model, feedbackLoops, parameters }) => {
          try {
            const result = await callLTMEngine(model, feedbackLoops, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  feedbackLoops: result.feedbackLoops,
                  output: result.output
                }, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      discuss_with_mentor: {
        description: 'Ask thoughtful questions to the user to guide their learning and help them think through System Dynamics concepts. Use this to engage users in Socratic dialogue about their model.',
        inputSchema: z.object({
          prompt: z.string().describe('The question or guidance to provide to the user'),
          model: SDModelSchema.describe('The model being discussed'),
          parameters: z.object({
            model: z.string().optional(),
            problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
            backgroundKnowledge: z.string().optional().describe('Background information for LLM')
          }).optional()
        }),
        handler: async ({ prompt, model, parameters }) => {
          try {
            const result = await callSeldonMentorEngine(prompt, model, parameters);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result.output, null, 2)
              }]
            };
          } catch (error) {
            return {
              content: [{ type: 'text', text: `Error: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      create_visualization: {
        description: `Create a data visualization and send it to the client for display in chat.

Visualization types:
- time_series: Line plots showing variables over time
- phase_portrait: State-space plots (stock vs stock)
- feedback_dominance: Stacked area chart of loop influence
- comparison: Multi-run comparison charts

Use useAICustom=true to have AI generate custom matplotlib code for complex visualizations.`,
        inputSchema: z.object({
          type: z.enum(['time_series', 'phase_portrait', 'feedback_dominance', 'comparison']).optional(),
          data: z.object({}).passthrough().describe('The data to visualize (time series format or feedback loop data)'),
          variables: z.array(z.string()).describe('Variables to include in visualization'),
          title: z.string().describe('Visualization title'),
          description: z.string().optional().describe('Description of what the visualization shows'),
          usePython: z.boolean().optional().describe('Use Python/matplotlib instead of Plotly. Default: false'),
          useAICustom: z.boolean().optional().describe('Use AI to generate custom Python visualization code. Default: false'),
          dataDescription: z.string().optional().describe('Description of the data for AI (when useAICustom=true)'),
          visualizationGoal: z.string().optional().describe('What insight to convey (when useAICustom=true)'),
          options: z.object({
            timeUnits: z.string().optional(),
            timeRange: z.object({ start: z.number(), end: z.number() }).optional(),
            highlightPeriods: z.array(z.object({
              start: z.number(),
              end: z.number(),
              label: z.string(),
              color: z.string().optional()
            })).optional(),
            width: z.number().optional(),
            height: z.number().optional(),
            customRequirements: z.string().optional().describe('Additional requirements for AI visualization')
          }).optional()
        }),
        handler: async ({ type, data, variables, title, description, usePython, useAICustom, dataDescription, visualizationGoal, options }) => {
          try {
            const vizOptions = {
              ...options,
              title,
              description,
              usePython,
              useAICustom,
              dataDescription,
              visualizationGoal
            };

            let vizMessage;
            if (useAICustom) {
              vizMessage = await vizEngine.createVisualization(type || 'time_series', data, variables, vizOptions);
            } else {
              vizMessage = await vizEngine.createVisualization(type || 'time_series', data, variables, vizOptions);
            }

            // Send visualization to client
            await sendToClient({
              type: 'visualization',
              sessionId: sessionId,
              ...vizMessage
            });

            return {
              content: [{
                type: 'text',
                text: `Created ${useAICustom ? 'AI-custom' : type || 'time_series'} visualization: "${title}" and sent to client`
              }]
            };
          } catch (error) {
            logger.error('Visualization error:', error);
            return {
              content: [{ type: 'text', text: `Failed to create visualization: ${error.message}` }],
              isError: true
            };
          }
        }
      }
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
    'create_visualization'
  ];
}
