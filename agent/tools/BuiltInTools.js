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
import {
  SDModelSchema,
  createFeedbackRequestMessage,
  createGetCurrentModelMessage,
  createUpdateModelMessage,
  createRunModelMessage,
  createGetRunInfoMessage,
  createGetVariableDataMessage
} from '../utilities/MessageProtocol.js';
import logger from '../../utilities/logger.js';

/**
 * Generate a unique request ID for async operations
 * @param {string} prefix - Prefix for the request ID (e.g., 'feedback', 'tool')
 * @returns {string} Unique request ID
 */
function generateRequestId(prefix = 'request') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

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
        description: 'Generate a Stock Flow Diagram (SFD) model with equations and quantitative structure. Use this for building computational models that can be simulated. Automatically pushes the generated model to the client.',
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

            // Automatically push the generated model to the client
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('model');
            await sendToClient(createUpdateModelMessage(sessionId, requestId, result.model));

            // Wait for client confirmation
            const updatePromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            await updatePromise;

            // Build response
            const responseText = JSON.stringify({
              model: result.model,
              supportingInfo: result.supportingInfo,
              pushedToClient: true
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
        description: 'Generate a Causal Loop Diagram (CLD) showing feedback loops and causal relationships. Use this for conceptual models focusing on system structure. Automatically pushes the generated model to the client.',
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

            // Automatically push the generated model to the client
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('model');
            await sendToClient(createUpdateModelMessage(sessionId, requestId, result.model));

            // Wait for client confirmation
            const updatePromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            await updatePromise;

            // Build response
            const responseText = JSON.stringify({
              model: result.model,
              supportingInfo: result.supportingInfo,
              pushedToClient: true
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

            // Check if feedback information is required but not provided
            if (result.output.feedbackInformationRequired && !feedbackLoops) {
              // Get feedback information from client
              const session = sessionManager.getSession(sessionId);
              if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
              }

              const requestId = generateRequestId('feedback');

              // Send request to client for feedback data (empty array means all runs)
              await sendToClient(createFeedbackRequestMessage(sessionId, requestId, []));

              // Create pending request that will be resolved when client responds
              const resultPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error('Feedback request timeout: Client did not respond within 30 seconds'));
                }, 30000);

                if (!session.pendingFeedbackRequests) {
                  session.pendingFeedbackRequests = new Map();
                }
                session.pendingFeedbackRequests.set(requestId, { resolve, reject, timeout });
              });

              const feedbackData = await resultPromise;

              // Retry the call with feedback information
              const retryResult = await callSeldonEngine(prompt, model, feedbackData.feedbackContent.loops, parameters);

              if (!retryResult.success) {
                return {
                  content: [{ type: 'text', text: `Error: ${retryResult.error}` }],
                  isError: true
                };
              }

              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(retryResult.output, null, 2)
                }]
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
        description: 'Have a user-friendly discussion about the model without jargon, with the ability to compare and explain differences between simulation runs. Use this to understand what causes behavioral differences across runs - analyzing how different scenarios or parameter changes produce different outcomes by examining the underlying feedback loop dynamics.',
        inputSchema: z.object({
          prompt: z.string().describe('Question or topic for discussion'),
          model: SDModelSchema.describe('The model to discuss'),
          runName: z.string().optional().describe('Simulation run ID for context'),
          feedbackContent: z.object({}).passthrough().optional().describe('Feedback loop analysis data'),
          parameters: z.object({
            model: z.string().optional(),
            problemStatement: z.string().optional().describe('Description of dynamic issue to address'),
            backgroundKnowledge: z.string().optional().describe('Background information for LLM'),
            behaviorContent: z.string().optional().describe('Time series behavior data')
          }).optional()
        }),
        handler: async ({ prompt, model, runName, feedbackContent, parameters }) => {
          try {
            // Add feedbackContent to parameters if provided
            const engineParams = {
              ...parameters,
              ...(feedbackContent && { feedbackContent })
            };

            const result = await callSeldonILEEngine(prompt, model, runName, engineParams);

            if (!result.success) {
              return {
                content: [{ type: 'text', text: `Error: ${result.error}` }],
                isError: true
              };
            }

            // Check if feedback information is required but not provided
            if (result.output.feedbackInformationRequired && !feedbackContent) {
              // Get comparative feedback information from client (all runs)
              const session = sessionManager.getSession(sessionId);
              if (!session) {
                throw new Error(`Session not found: ${sessionId}`);
              }

              const requestId = generateRequestId('feedback');

              // Send request to client for comparative feedback data (empty array means all runs)
              await sendToClient(createFeedbackRequestMessage(sessionId, requestId, []));

              // Create pending request that will be resolved when client responds
              const resultPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  reject(new Error('Feedback request timeout: Client did not respond within 30 seconds'));
                }, 30000);

                if (!session.pendingFeedbackRequests) {
                  session.pendingFeedbackRequests = new Map();
                }
                session.pendingFeedbackRequests.set(requestId, { resolve, reject, timeout });
              });

              const feedbackData = await resultPromise;

              // Retry the call with comparative feedback information
              const retryParams = {
                ...parameters,
                feedbackContent: feedbackData.feedbackContent
              };

              const retryResult = await callSeldonILEEngine(prompt, model, runName, retryParams);

              if (!retryResult.success) {
                return {
                  content: [{ type: 'text', text: `Error: ${retryResult.error}` }],
                  isError: true
                };
              }

              return {
                content: [{
                  type: 'text',
                  text: JSON.stringify(retryResult.output, null, 2)
                }]
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

      get_feedback_information: {
        description: 'Request feedback loop analysis data from the client. MUST be called before using discuss_model_with_seldon or generate_ltm_narrative to ensure feedback information is available. Provide a list of run IDs to get feedback for.',
        inputSchema: z.object({
          runIds: z.array(z.string()).describe('List of simulation run IDs to get feedback for')
        }),
        handler: async ({ runIds }) => {
          try {
            // Create a promise that will be resolved when client responds
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('feedback');

            // Send request to client for feedback data
            await sendToClient(createFeedbackRequestMessage(sessionId, requestId, runIds));

            // Create pending request that will be resolved when client responds
            const resultPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Feedback request timeout: Client did not respond within 30 seconds'));
              }, 30000);

              // Store the resolver in session so it can be called when client responds
              if (!session.pendingFeedbackRequests) {
                session.pendingFeedbackRequests = new Map();
              }
              session.pendingFeedbackRequests.set(requestId, { resolve, reject, timeout });
            });

            const feedbackData = await resultPromise;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  feedbackContent: feedbackData.feedbackContent,
                  runIds: feedbackData.runIds
                }, null, 2)
              }]
            };
          } catch (error) {
            logger.error('get_feedback_information error:', error);
            return {
              content: [{ type: 'text', text: `Failed to get feedback information: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      get_current_model: {
        description: 'Get the current model from the client. Returns the model data that is currently loaded in the client.',
        inputSchema: z.object({}),
        handler: async () => {
          try {
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('model');

            // Send request to client for current model
            await sendToClient(createGetCurrentModelMessage(sessionId, requestId));

            // Create pending request that will be resolved when client responds
            const resultPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Get current model timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            const modelData = await resultPromise;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(modelData, null, 2)
              }]
            };
          } catch (error) {
            logger.error('get_current_model error:', error);
            return {
              content: [{ type: 'text', text: `Failed to get current model: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      update_model: {
        description: 'Update the model in the client with new model data. This replaces the current model.',
        inputSchema: z.object({
          modelData: z.any().describe('The model data to update in the client')
        }),
        handler: async ({ modelData }) => {
          try {
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('model');

            // Send update request to client
            await sendToClient(createUpdateModelMessage(sessionId, requestId, modelData));

            // Create pending request that will be resolved when client responds
            const resultPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            const result = await resultPromise;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({ success: true, ...result }, null, 2)
              }]
            };
          } catch (error) {
            logger.error('update_model error:', error);
            return {
              content: [{ type: 'text', text: `Failed to update model: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      run_model: {
        description: 'Run the model simulation in the client. Returns a runId for the completed run.',
        inputSchema: z.object({}),
        handler: async () => {
          try {
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('run');

            // Send run request to client
            await sendToClient(createRunModelMessage(sessionId, requestId));

            // Create pending request that will be resolved when client responds
            const resultPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Run model timeout: Client did not respond within 60 seconds'));
              }, 60000); // Longer timeout for model runs

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            const result = await resultPromise;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  runId: result.runId,
                  success: true,
                  ...result
                }, null, 2)
              }]
            };
          } catch (error) {
            logger.error('run_model error:', error);
            return {
              content: [{ type: 'text', text: `Failed to run model: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      get_run_info: {
        description: 'Get information about all simulation runs. Returns a list of run objects, where each run object contains an id, name, and optional metadata.',
        inputSchema: z.object({}),
        handler: async () => {
          try {
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('runinfo');

            // Send request to client for run info
            await sendToClient(createGetRunInfoMessage(sessionId, requestId));

            // Create pending request that will be resolved when client responds
            const resultPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Get run info timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            const runInfo = await resultPromise;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  runs: runInfo.runs || [],
                  count: runInfo.runs?.length || 0
                }, null, 2)
              }]
            };
          } catch (error) {
            logger.error('get_run_info error:', error);
            return {
              content: [{ type: 'text', text: `Failed to get run info: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      get_variable_data: {
        description: 'Get data for specific variables from specific runs. Returns the time-series data for the requested variables from the requested runs.',
        inputSchema: z.object({
          variableNames: z.array(z.string()).describe('List of variable names to get data for'),
          runIds: z.array(z.string()).describe('List of run IDs to get variable data from')
        }),
        handler: async ({ variableNames, runIds }) => {
          try {
            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const requestId = generateRequestId('vardata');

            // Send request to client for variable data
            await sendToClient(createGetVariableDataMessage(sessionId, requestId, variableNames, runIds));

            // Create pending request that will be resolved when client responds
            const resultPromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Get variable data timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(requestId, { resolve, reject, timeout });
            });

            const variableData = await resultPromise;

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(variableData, null, 2)
              }]
            };
          } catch (error) {
            logger.error('get_variable_data error:', error);
            return {
              content: [{ type: 'text', text: `Failed to get variable data: ${error.message}` }],
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

            // VisualizationEngine now returns just base64 image string
            const base64Image = await vizEngine.createVisualization(type || 'time_series', data, variables, vizOptions);

            // Generate visualization ID
            const visualizationId = `viz_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            // Wrap base64 string in proper visualization message object
            const vizMessage = {
              type: 'visualization',
              sessionId: sessionId,
              visualizationId,
              title: title || 'Visualization',
              format: 'image',
              data: {
                encoding: 'base64',
                mimeType: 'image/png',
                content: base64Image,
                width: 800,
                height: 600
              },
              timestamp: new Date().toISOString()
            };

            // Add description if provided
            if (description) {
              vizMessage.description = description;
            }

            // Send visualization to client
            await sendToClient(vizMessage);

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
    'get_feedback_information',
    'get_current_model',
    'update_model',
    'run_model',
    'get_run_info',
    'get_variable_data',
    'create_visualization'
  ];
}
