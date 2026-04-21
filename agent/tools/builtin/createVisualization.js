import { z } from 'zod';
import logger from '../../../utilities/logger.js';

/**
 * Create a data visualization and send it to the client
 */
export function createVisualizationTool(sessionManager, sessionId, sendToClient, vizEngine) {
  return {
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
  };
}
