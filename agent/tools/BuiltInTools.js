import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
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
  createGetVariableDataMessage,
  createAgentTextMessage
} from '../utilities/MessageProtocol.js';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import QuantitativeEngineBrain from '../../engines/quantitative/QuantitativeEngineBrain.js';
import logger from '../../utilities/logger.js';
import config from '../../config.js';

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
            // Check if model exceeds token limit - if so, refuse to call this tool
            if (sessionManager.modelExceedsTokenLimit(sessionId)) {
              return {
                content: [{
                  type: 'text',
                  text: `Error: Cannot use generate_quantitative_model when the model exceeds the token limit (${config.maxTokensForEngines} tokens). The model is currently ${sessionManager.getModelTokenCount(sessionId)} tokens. Please use read_model_section and edit_model_section tools instead to work with large models.`
                }],
                isError: true
              };
            }

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
        description: 'Get data for specific variables from specific runs. Returns the time-series data for the requested variables from the requested runs. NOTE: This operation can be slow for large datasets - consider requesting only essential variables and runs. For visualization or analysis, consider requesting a small subset of key variables first.',
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
          usePython: z.boolean().optional().describe('Use Python/matplotlib. Default: true'),
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
            logger.debug('Visualization error:', error);
            return {
              content: [{ type: 'text', text: `Failed to create visualization: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      read_model_section: {
        description: `Read a specific section of the large model file. Use this to inspect parts of the model without loading the entire thing.

Available sections:
- specs: simulation specifications (startTime, stopTime, dt, timeUnits, arrayDimensions).
  * arrayDimensions schema: [{type: "numeric"|"labels", name: string (singular, alphanumeric), size: number (positive integer), elements: string[] (element names)}]
  * All four fields (type, name, size, elements) are required for each dimension
  * type="numeric": elements auto-generated as ['1','2','3'...]
  * type="labels": elements are user-defined meaningful names like ['North','South','East','West']
- variables: array of variables with schema: {name, type (stock|flow|variable), equation, documentation, units, uniflow, inflows, outflows, dimensions, arrayEquations, crossLevelGhostOf, graphicalFunction}
- relationships: array of relationships with schema: {from, to, polarity (+|-|""), reasoning, polarityReasoning}
- modules: module hierarchy with schema: {name, parentModule}. IMPORTANT: The modules array only defines the hierarchical structure (which modules exist and their parent-child relationships). It does NOT tell you which variables belong to a module - variable membership is determined by the variable name prefix (e.g., "Finance.revenue" belongs to the Finance module).

Module handling:
- In modular models, variable names are module-qualified as "Module_Name.variable_name"
- To find variables in a module, use the moduleName filter (filters by name prefix)
- The modules section only shows the module hierarchy, not the contents

Array handling:
- Variables with the "dimensions" field are arrayed variables
- Array dimensions must be defined in specs.arrayDimensions BEFORE being referenced by variables
- Each dimension requires all four fields: type, name, size, elements
- Element-specific equations are in the "arrayEquations" field

Filtering:
- variableNames filter matches base names (e.g., "cost" matches "Module_1.cost", "Module_2.cost", and "cost")
- moduleName filter gets all variables from a specific module (by name prefix)
- usedInEquation filter finds all variables whose equations reference a given variable (case-insensitive, matches XMILE format with underscores)`,
        inputSchema: z.object({
          section: z.enum(['specs', 'variables', 'relationships', 'modules']).describe('Which section to read'),
          filter: z.object({
            variableNames: z.array(z.string()).optional().describe('Filter variables by base name (matches both qualified and unqualified names, e.g., "cost" matches "Module_1.cost", "Module_2.cost", and "cost")'),
            variableType: z.enum(['stock', 'flow', 'variable']).optional().describe('Filter variables by type'),
            moduleName: z.string().optional().describe('Filter variables by module (e.g., "Module_Name" - variable names are module-qualified as Module_Name.variable_name)'),
            usedInEquation: z.string().optional().describe('Find variables whose equations reference this variable (case-insensitive). Searches in both equation and arrayEquations fields.'),
            relationshipFrom: z.string().optional().describe('Filter relationships by source variable'),
            relationshipTo: z.string().optional().describe('Filter relationships by target variable'),
            limit: z.number().optional().describe('Limit number of results returned (default: 500)')
          }).optional().describe('Optional filters for variables/relationships/modules')
        }),
        handler: async ({ section, filter }) => {
          try {
            // Send message to client about what we're reading
            let filterDesc = '';
            if (filter) {
              const filterParts = [];
              if (filter.variableNames && filter.variableNames.length > 0) {
                filterParts.push(`variables named ${filter.variableNames.map(n => `"${n}"`).join(', ')}`);
              }
              if (filter.variableType) {
                filterParts.push(`type: ${filter.variableType}`);
              }
              if (filter.moduleName) {
                filterParts.push(`in module "${filter.moduleName}"`);
              }
              if (filter.usedInEquation) {
                filterParts.push(`used in equations referencing "${filter.usedInEquation}"`);
              }
              if (filter.relationshipFrom) {
                filterParts.push(`relationships from "${filter.relationshipFrom}"`);
              }
              if (filter.relationshipTo) {
                filterParts.push(`relationships to "${filter.relationshipTo}"`);
              }
              if (filter.limit) {
                filterParts.push(`limit: ${filter.limit}`);
              }
              if (filterParts.length > 0) {
                filterDesc = ` (${filterParts.join(', ')})`;
              }
            }
            await sendToClient(createAgentTextMessage(sessionId,
              `Reading model section: ${section}${filterDesc}`));

            const sessionTempDir = sessionManager.getSessionTempDir(sessionId);
            const modelPath = join(sessionTempDir, 'model.sdjson');

            if (!existsSync(modelPath)) {
              return {
                content: [{ type: 'text', text: 'Error: Model file not found. The model may not have exceeded the token limit yet.' }],
                isError: true
              };
            }

            const modelContent = readFileSync(modelPath, 'utf-8');
            const model = JSON.parse(modelContent);

            const limit = filter?.limit || 500;
            let result = {};

            switch (section) {
              case 'specs':
                result = model.specs || {};
                break;

              case 'variables':
                let variables = model.variables || [];

                // Apply filters (case-insensitive)
                if (filter?.variableNames && filter.variableNames.length > 0) {
                  // Convert filter names to lowercase for case-insensitive matching
                  const lowerFilterNames = filter.variableNames.map(name => name.toLowerCase());

                  // Match both qualified and unqualified names
                  // e.g., "cost" should match "Module_1.cost", "Module_2.cost", and "cost"
                  variables = variables.filter(v => {
                    const lowerName = v.name.toLowerCase();

                    // Check if the full name matches
                    if (lowerFilterNames.includes(lowerName)) {
                      return true;
                    }
                    // Check if the base name (after the last dot) matches
                    const baseName = v.name.includes('.') ? v.name.split('.').pop() : v.name;
                    return lowerFilterNames.includes(baseName.toLowerCase());
                  });
                }
                if (filter?.variableType) {
                  variables = variables.filter(v => v.type === filter.variableType);
                }
                if (filter?.moduleName) {
                  // Filter by module name - variable names are module-qualified as "Module_Name.variable_name"
                  // Case-insensitive matching
                  const modulePrefix = filter.moduleName.toLowerCase() + '.';
                  variables = variables.filter(v => v.name.toLowerCase().startsWith(modulePrefix));
                }
                if (filter?.usedInEquation) {
                  // Filter by variables that reference the given variable in their equations
                  // Convert to XMILE format and lowercase for matching
                  const searchTerm = filter.usedInEquation.replace(/ /g, '_').toLowerCase();

                  variables = variables.filter(v => {
                    // Search in equation field
                    if (v.equation && v.equation.toLowerCase().includes(searchTerm)) {
                      return true;
                    }
                    // Search in arrayEquations
                    if (v.arrayEquations && Array.isArray(v.arrayEquations)) {
                      return v.arrayEquations.some(ae =>
                        ae.equation && ae.equation.toLowerCase().includes(searchTerm)
                      );
                    }
                    return false;
                  });
                }

                // Limit results
                const total = variables.length;
                variables = variables.slice(0, limit);

                // Pre-process variable names to replace spaces with underscores (XMILE format)
                // This shows how variables are referenced in equations
                variables = variables.map(v => ({
                  ...v,
                  name: v.name.replace(/ /g, '_')
                }));

                result = {
                  variables,
                  total,
                  returned: variables.length,
                  truncated: total > limit
                };
                break;

              case 'relationships':
                let relationships = model.relationships || [];

                // Apply filters
                if (filter?.relationshipFrom) {
                  relationships = relationships.filter(r => r.from === filter.relationshipFrom);
                }
                if (filter?.relationshipTo) {
                  relationships = relationships.filter(r => r.to === filter.relationshipTo);
                }

                // Limit results
                const totalRels = relationships.length;
                relationships = relationships.slice(0, limit);

                result = {
                  relationships,
                  total: totalRels,
                  returned: relationships.length,
                  truncated: totalRels > limit
                };
                break;

              case 'modules':
                let modules = model.modules || [];

                // Apply filter
                if (filter?.moduleName) {
                  modules = modules.filter(m => m.name === filter.moduleName);
                }

                result = {
                  modules,
                  total: modules.length
                };
                break;
            }

            // Send success message to client
            let resultSummary = '';
            if (section === 'variables' && result.variables) {
              resultSummary = `Found ${result.returned} variable(s)${result.truncated ? ` (truncated from ${result.total})` : ''}`;
            } else if (section === 'relationships' && result.relationships) {
              resultSummary = `Found ${result.returned} relationship(s)${result.truncated ? ` (truncated from ${result.total})` : ''}`;
            } else if (section === 'modules' && result.modules) {
              resultSummary = `Found ${result.total} module(s)`;
            } else if (section === 'specs') {
              resultSummary = `Retrieved model specifications`;
            }
            await sendToClient(createAgentTextMessage(sessionId, resultSummary));

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }]
            };
          } catch (error) {
            logger.error('read_model_section error:', error);
            return {
              content: [{ type: 'text', text: `Failed to read model section: ${error.message}` }],
              isError: true
            };
          }
        }
      },

      edit_model_section: {
        description: `Edit a specific section of the large model file. This allows you to modify parts of the model without loading the entire thing.

You can edit:
- specs: Update simulation specifications (startTime, stopTime, dt, timeUnits, arrayDimensions).
  * arrayDimensions schema: [{type: "numeric"|"labels", name: string (singular, alphanumeric), size: number (positive integer), elements: string[] (element names)}]
  * CRITICAL: All four fields (type, name, size, elements) are REQUIRED for each dimension
  * type="numeric": elements auto-generated as ['1','2','3'...] based on size
  * type="labels": elements are user-defined meaningful names like ['North','South','East','West']
  * When updating arrayDimensions, provide the COMPLETE array with all dimensions (it replaces the entire array)
- variables: Add, update, or remove specific variables. Schema: {name, type (stock|flow|variable), equation?, documentation?, units?, uniflow?, inflows?, outflows?, dimensions?, arrayEquations?, crossLevelGhostOf?, graphicalFunction?}
- relationships: Add, update, or remove relationships. Schema: {from, to, polarity (+|-|""), reasoning?, polarityReasoning?}
- modules: Add, update, or remove modules. Schema: {name, parentModule}. IMPORTANT: Modules array only defines hierarchy, NOT contents. Variable membership is by name prefix.

VARIABLE RENAMING:
- To rename a variable, use update operation with {name: "OldName", newName: "NewName"}
- The tool will automatically update ALL equations that reference the old variable name
- This includes equations in ALL variables across ALL modules
- References are updated case-insensitively using XMILE format (with underscores)

CRITICAL MODULE RULES:
- Variable names use ONLY their immediate owning module as prefix: "ModuleName.variableName"
- NEVER use full hierarchy path in variable names (WRONG: "Company.Sales.revenue", CORRECT: "Sales.revenue")
- Variables are qualified ONLY by their direct parent module, never by ancestor modules
- Cross-module references require ghost variables: use "crossLevelGhostOf" field pointing to source variable
- Ghost variables have empty equation field (equation = "")

CRITICAL EQUATION RULES:
- XMILE naming: Replace all spaces with underscores in variable references (e.g., "birth_rate" not "birth rate")
- Every variable MUST have either 'equation' OR 'arrayEquations' (never both, never neither)
- NEVER embed numerical constants directly in equations - create separate named variables for constants
- Stock-flow constraint: A flow can NEVER appear in BOTH inflows AND outflows of the same stock

CRITICAL ARRAY RULES:
- Array dimensions MUST be defined in specs.arrayDimensions BEFORE being referenced by variables
- Each dimension requires ALL FOUR fields: type ("numeric" or "labels"), name (singular, alphanumeric), size (positive integer), elements (array of element names)
- For arrayed variables, set "dimensions" field to array of dimension names that reference specs.arrayDimensions
- If all elements use SAME formula: provide 'equation' only
- If elements have DIFFERENT formulas: provide 'arrayEquations' for ALL elements (omit 'equation')
- For arrayed STOCKS: ALWAYS use 'arrayEquations' to specify initial values for each element
- SUM function syntax: ALWAYS use asterisk (*) for dimension being summed, NEVER the dimension name
  * WRONG: SUM(Revenue[region])
  * CORRECT: SUM(Revenue[*])
  * CRITICAL: Every SUM equation MUST contain at least one asterisk (*)

After editing, the model is validated and processed through the quantitative engine pipeline before updating the client.`,
        inputSchema: z.object({
          section: z.enum(['specs', 'variables', 'relationships', 'modules']).describe('Which section to edit'),
          operation: z.enum(['update', 'add', 'remove']).describe('Operation to perform'),
          data: z.any().describe('The data for the operation. For update: partial object with fields to update. For add: complete new item(s) matching schema. For remove: identifier(s) to remove.')
        }),
        handler: async ({ section, operation, data }) => {
          try {
            // Send message to client about what we're editing
            await sendToClient(createAgentTextMessage(sessionId,
              `Editing model section: ${section} (operation: ${operation})`));

            const session = sessionManager.getSession(sessionId);
            if (!session) {
              throw new Error(`Session not found: ${sessionId}`);
            }

            const sessionTempDir = sessionManager.getSessionTempDir(sessionId);
            const modelPath = join(sessionTempDir, 'model.sdjson');

            if (!existsSync(modelPath)) {
              return {
                content: [{ type: 'text', text: 'Error: Model file not found. The model may not have exceeded the token limit yet.' }],
                isError: true
              };
            }

            const modelContent = readFileSync(modelPath, 'utf-8');
            const model = JSON.parse(modelContent);

            // Perform the edit operation
            switch (section) {

              case 'specs':
                if (operation === 'update') {
                  // Merge specs, handling arrayDimensions properly
                  model.specs = model.specs || {};

                  // Update top-level spec fields
                  if (data.startTime !== undefined) model.specs.startTime = data.startTime;
                  if (data.stopTime !== undefined) model.specs.stopTime = data.stopTime;
                  if (data.dt !== undefined) model.specs.dt = data.dt;
                  if (data.timeUnits !== undefined) model.specs.timeUnits = data.timeUnits;

                  // Handle arrayDimensions separately (replace entire array)
                  if (data.arrayDimensions !== undefined) {
                    // Validate arrayDimensions - each dimension must have all four required fields
                    if (Array.isArray(data.arrayDimensions)) {
                      for (const dim of data.arrayDimensions) {
                        if (!dim.type || !dim.name || dim.size === undefined || !Array.isArray(dim.elements)) {
                          return {
                            content: [{
                              type: 'text',
                              text: `Error: Array dimension "${dim.name || 'unknown'}" is missing required fields. All dimensions must have: type ("numeric" or "labels"), name (singular, alphanumeric), size (positive integer), and elements (array of element names).`
                            }],
                            isError: true
                          };
                        }
                        if (dim.type !== 'numeric' && dim.type !== 'labels') {
                          return {
                            content: [{
                              type: 'text',
                              text: `Error: Array dimension "${dim.name}" has invalid type "${dim.type}". Must be "numeric" or "labels".`
                            }],
                            isError: true
                          };
                        }
                        if (typeof dim.size !== 'number' || dim.size <= 0) {
                          return {
                            content: [{
                              type: 'text',
                              text: `Error: Array dimension "${dim.name}" size must be a positive integer, got: ${dim.size}`
                            }],
                            isError: true
                          };
                        }
                        if (dim.elements.length !== dim.size) {
                          return {
                            content: [{
                              type: 'text',
                              text: `Error: Array dimension "${dim.name}" has size=${dim.size} but elements array has ${dim.elements.length} items. They must match.`
                            }],
                            isError: true
                          };
                        }
                      }
                    }
                    model.specs.arrayDimensions = data.arrayDimensions;
                  }
                }
                break;

              case 'variables':
                model.variables = model.variables || [];
                if (operation === 'add') {
                  const varsToAdd = Array.isArray(data) ? data : [data];
                  // Validate that required fields exist (name, type)
                  for (const v of varsToAdd) {
                    if (!v.name || !v.type) {
                      return {
                        content: [{ type: 'text', text: 'Error: Variables must have "name" and "type" fields' }],
                        isError: true
                      };
                    }
                    if (!['stock', 'flow', 'variable'].includes(v.type)) {
                      return {
                        content: [{ type: 'text', text: `Error: Variable type must be "stock", "flow", or "variable", got "${v.type}"` }],
                        isError: true
                      };
                    }
                  }
                  model.variables.push(...varsToAdd);
                } else if (operation === 'update') {
                  const varName = data.name;
                  if (!varName) {
                    return {
                      content: [{ type: 'text', text: 'Error: Must specify "name" field to update a variable' }],
                      isError: true
                    };
                  }
                  const index = model.variables.findIndex(v => v.name === varName);
                  if (index >= 0) {
                    const oldVariable = model.variables[index];
                    const oldName = oldVariable.name;

                    // Check if the variable is being renamed
                    const isRenamed = data.newName && data.newName !== oldName;

                    if (isRenamed) {
                      const newName = data.newName;

                      // Send message to client about renaming operation
                      await sendToClient(createAgentTextMessage(sessionId,
                        `Renaming variable "${oldName}" to "${newName}" and updating all references across the model...`));

                      // Convert names to XMILE format for equation matching
                      const oldNameXMILE = oldName.replace(/ /g, '_');
                      const newNameXMILE = newName.replace(/ /g, '_');

                      // Create regex to match the variable name as a whole word
                      // This prevents partial matches (e.g., "cost" shouldn't match "cost_total")
                      const varRegex = new RegExp(`\\b${oldNameXMILE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');

                      let updatedCount = 0;

                      // Update all equations that reference this variable
                      for (const variable of model.variables) {
                        let modified = false;

                        // Update equation field
                        if (variable.equation && varRegex.test(variable.equation)) {
                          variable.equation = variable.equation.replace(varRegex, newNameXMILE);
                          modified = true;
                        }

                        // Update arrayEquations
                        if (variable.arrayEquations && Array.isArray(variable.arrayEquations)) {
                          for (const ae of variable.arrayEquations) {
                            if (ae.equation && varRegex.test(ae.equation)) {
                              ae.equation = ae.equation.replace(varRegex, newNameXMILE);
                              modified = true;
                            }
                          }
                        }

                        if (modified) {
                          updatedCount++;
                        }
                      }

                      // Update the variable's name
                      data.name = newName;
                      delete data.newName; // Remove the temporary field

                      // Send update message
                      await sendToClient(createAgentTextMessage(sessionId,
                        `Updated ${updatedCount} variable(s) that referenced "${oldName}"`));
                    }

                    // Merge the update, preserving all optional fields
                    model.variables[index] = { ...model.variables[index], ...data };
                  } else {
                    return {
                      content: [{ type: 'text', text: `Error: Variable "${varName}" not found` }],
                      isError: true
                    };
                  }
                } else if (operation === 'remove') {
                  const namesToRemove = Array.isArray(data) ? data : [data];
                  model.variables = model.variables.filter(v => !namesToRemove.includes(v.name));
                }
                break;

              case 'relationships':
                model.relationships = model.relationships || [];
                if (operation === 'add') {
                  const relsToAdd = Array.isArray(data) ? data : [data];
                  // Validate that required fields exist (from, to, polarity)
                  for (const r of relsToAdd) {
                    if (!r.from || !r.to) {
                      return {
                        content: [{ type: 'text', text: 'Error: Relationships must have "from" and "to" fields' }],
                        isError: true
                      };
                    }
                    if (r.polarity !== undefined && !['+', '-', ''].includes(r.polarity)) {
                      return {
                        content: [{ type: 'text', text: `Error: Relationship polarity must be "+", "-", or "", got "${r.polarity}"` }],
                        isError: true
                      };
                    }
                  }
                  model.relationships.push(...relsToAdd);
                } else if (operation === 'update') {
                  if (!data.from || !data.to) {
                    return {
                      content: [{ type: 'text', text: 'Error: Must specify "from" and "to" fields to update a relationship' }],
                      isError: true
                    };
                  }
                  const index = model.relationships.findIndex(r => r.from === data.from && r.to === data.to);
                  if (index >= 0) {
                    model.relationships[index] = { ...model.relationships[index], ...data };
                  } else {
                    return {
                      content: [{ type: 'text', text: `Error: Relationship from "${data.from}" to "${data.to}" not found` }],
                      isError: true
                    };
                  }
                } else if (operation === 'remove') {
                  // data should be array of {from, to} objects or strings (variable names)
                  const relsToRemove = Array.isArray(data) ? data : [data];
                  model.relationships = model.relationships.filter(r =>
                    !relsToRemove.some(rem => rem.from === r.from && rem.to === r.to)
                  );
                }
                break;

              case 'modules':
                model.modules = model.modules || [];
                if (operation === 'update') {
                  // For update operation on modules, replace entire array
                  if (!Array.isArray(data)) {
                    return {
                      content: [{ type: 'text', text: 'Error: For modules update operation, data must be an array of module objects' }],
                      isError: true
                    };
                  }
                  // Validate each module
                  for (const m of data) {
                    if (!m.name || m.parentModule === undefined) {
                      return {
                        content: [{ type: 'text', text: 'Error: Modules must have "name" and "parentModule" fields' }],
                        isError: true
                      };
                    }
                  }
                  model.modules = data;
                } else if (operation === 'add') {
                  const modulesToAdd = Array.isArray(data) ? data : [data];
                  // Validate that required fields exist
                  for (const m of modulesToAdd) {
                    if (!m.name || m.parentModule === undefined) {
                      return {
                        content: [{ type: 'text', text: 'Error: Modules must have "name" and "parentModule" fields' }],
                        isError: true
                      };
                    }
                  }
                  model.modules.push(...modulesToAdd);
                } else if (operation === 'remove') {
                  const moduleNamesToRemove = Array.isArray(data) ? data : [data];
                  model.modules = model.modules.filter(m => !moduleNamesToRemove.includes(m.name));
                }
                break;
            }

            // Validate the model structure using LLMWrapper schema
            const llmWrapper = new LLMWrapper();
            const modelType = session.modelType;

            if (modelType !== 'sfd') {
              return {
                content: [{ type: 'text', text: 'Error: Model editing is only supported for quantitative (SFD) models' }],
                isError: true
              };
            }

            const supportsArrays = session.context?.supportsArrays || false;
            const supportsModules = session.context?.supportsModules || false;
            const validationSchema = llmWrapper.generateQuantitativeSDJSONResponseSchema(false, supportsArrays);

            // Validate the edited model
            await sendToClient(createAgentTextMessage(sessionId,
              `Validating model structure...`));

            try {
              validationSchema.parse(model);
            } catch (validationError) {
              return {
                content: [{
                  type: 'text',
                  text: `Model validation failed after edit:\n${validationError.message}\n\nThe edit was not applied. Please fix the validation errors and try again.`
                }],
                isError: true
              };
            }

            // Process the model through the quantitative engine pipeline
            const engineBrain = new QuantitativeEngineBrain(
              '', // Empty prompt since we're processing an edited model
              model,
              {
                supportsArrays,
                supportsModules
              }
            );

            // Run the post-processing pipeline
            const processedModel = await engineBrain.processResponse(model);

            // Write the processed model back to disk
            writeFileSync(modelPath, JSON.stringify(processedModel, null, 2));
            logger.log(`Processed model written to: ${modelPath}`);

            // Update the client model
            await sendToClient(createAgentTextMessage(sessionId,
              `Sending updated model to client...`));

            const updateRequestId = generateRequestId('model');
            await sendToClient(createUpdateModelMessage(sessionId, updateRequestId, processedModel));

            // Wait for client confirmation
            const updatePromise = new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Update model timeout: Client did not respond within 30 seconds'));
              }, 30000);

              if (!session.pendingModelRequests) {
                session.pendingModelRequests = new Map();
              }
              session.pendingModelRequests.set(updateRequestId, { resolve, reject, timeout });
            });

            await updatePromise;

            // Update session model reference
            sessionManager.updateClientModel(sessionId, processedModel);

            // Send final success message
            await sendToClient(createAgentTextMessage(sessionId,
              `Successfully edited ${section} section. Model validated, processed, and updated.`));

            return {
              content: [{
                type: 'text',
                text: `Successfully edited ${section} section (${operation} operation). The model has been validated, processed, and sent to the client.`
              }]
            };
          } catch (error) {
            logger.error('edit_model_section error:', error);
            return {
              content: [{ type: 'text', text: `Failed to edit model section: ${error.message}` }],
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
    'create_visualization',
    'read_model_section',
    'edit_model_section'
  ];
}
