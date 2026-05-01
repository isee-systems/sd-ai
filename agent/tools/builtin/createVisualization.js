import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createSuccessResponse, createErrorResponse } from './toolHelpers.js';

// Detect run-keyed format: { runId: { time: [...], varName: [...], ... } }
export function isRunKeyedFormat(data) {
  const keys = Object.keys(data);
  if (keys.length === 0 || keys.includes('time') || keys.includes('feedbackContent')) return false;
  return keys.every(key => {
    const val = data[key];
    return typeof val === 'object' && !Array.isArray(val) && val !== null && Array.isArray(val.time);
  });
}

// Extract run-specific data from feedbackContent.
// feedbackContent is either flat { feedbackLoops, ... } or run-keyed { runId: { feedbackLoops, ... } }.
export function extractRunFeedback(feedbackContent, preferredRunId = null) {
  if (!feedbackContent || typeof feedbackContent !== 'object') return feedbackContent;
  if ('feedbackLoops' in feedbackContent) return feedbackContent;
  if (preferredRunId && preferredRunId in feedbackContent) return feedbackContent[preferredRunId];
  const keys = Object.keys(feedbackContent);
  const lastKey = keys[keys.length - 1];
  return lastKey ? feedbackContent[lastKey] : feedbackContent;
}

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
    supportedModes: ['sfd'],
    inputSchema: z.object({
      type: z.enum(['time_series', 'phase_portrait', 'feedback_dominance', 'comparison']).optional(),
      filePath: z.string().describe('Path to the data file. Use the filePath returned by get_variable_data for time_series/phase_portrait/comparison; use the feedback.json path for feedback_dominance.'),
      variables: z.array(z.string()).optional().describe('Variables to include — defaults to all variables in the data file'),
      title: z.string().describe('Visualization title'),
      description: z.string().optional().describe('Description of what the visualization shows'),
      usePython: z.boolean().optional().describe('Use Python/matplotlib. Default: true'),
      useAICustom: z.boolean().optional().describe('Use AI to generate custom Python visualization code. Default: false'),
      dataDescription: z.string().optional().describe('Description of the data for AI (when useAICustom=true)'),
      visualizationGoal: z.string().optional().describe('What insight to convey (when useAICustom=true)'),
      options: z.object({
        timeUnits: z.string().optional().describe('Label for the time axis (e.g. "Years", "Months")'),
        timeRange: z.object({ start: z.number(), end: z.number() }).optional().describe('Restrict the plot to a time window'),
        highlightPeriods: z.array(z.object({
          start: z.number(),
          end: z.number(),
          label: z.string(),
          color: z.string().optional()
        })).optional().describe('Shaded regions to draw on the chart (e.g. phases or events)'),
        width: z.number().optional().describe('Output width in pixels (default 800)'),
        height: z.number().optional().describe('Output height in pixels (default 600)'),
        includeFeedbackContext: z.boolean().optional().describe('When true, reads feedback.json and overlays dominant-loop periods as highlight bands on the chart. Useful for time_series plots where you want to show which feedback loop was driving behavior.'),
        customRequirements: z.string().optional().describe('Additional freeform requirements passed to the AI when useAICustom=true')
      }).optional()
    }),
    handler: async ({ type, filePath, variables, title, description, usePython, useAICustom, dataDescription, visualizationGoal, options }) => {
      try {
        const fileContent = readFileSync(filePath, 'utf8');
        const rawData = JSON.parse(fileContent);

        let data, resolvedVariables, extraOptions;
        let resolvedType = type;
        let selectedRunId = null;

        if ((type || 'time_series') === 'feedback_dominance') {
          if (!rawData.feedbackContent || Object.keys(rawData.feedbackContent).length === 0) {
            return createErrorResponse('No feedback information is present. Call get_feedback_information first.');
          }
          // feedbackContent may be flat or run-keyed: { runId: { feedbackLoops, ... } }
          const feedbackSource = extractRunFeedback(rawData.feedbackContent);
          const { feedbackLoops = [], dominantLoopsByPeriod } = feedbackSource;

          const getLoopScores = l => l['Percent of Model Behavior Explained By Loop'] ?? l.loopScore;
          const loopsWithData = feedbackLoops.filter(l => getLoopScores(l)?.length > 0);

          if (loopsWithData.length === 0) {
            return createErrorResponse('Loops That Matter information is not present (some clients may not generate that information)');
          }

          const timeSet = new Set();
          for (const loop of loopsWithData) {
            for (const { time } of getLoopScores(loop)) {
              timeSet.add(time);
            }
          }
          const sortedTime = Array.from(timeSet).sort((a, b) => a - b);

          data = { time: sortedTime };
          for (const loop of loopsWithData) {
            const timeToValue = new Map(getLoopScores(loop).map(d => [d.time, d.value]));
            data[loop.identifier] = sortedTime.map(t => timeToValue.get(t) ?? 0);
          }

          resolvedVariables = variables ?? loopsWithData.map(l => l.identifier);
          extraOptions = {};
        } else {
          data = rawData;

          if (isRunKeyedFormat(data)) {
            const runKeys = Object.keys(data);
            if (runKeys.length === 1) {
              selectedRunId = runKeys[0];
              data = data[runKeys[0]];
            } else {
              resolvedType = 'comparison';
              const firstRun = data[runKeys[0]] || {};
              resolvedVariables = variables ?? Object.keys(firstRun).filter(k => k !== 'time');
            }
          }

          if (!resolvedVariables) {
            resolvedVariables = variables ?? Object.keys(data).filter(k => k !== 'time');
          }
          extraOptions = {};
        }

        if (options?.includeFeedbackContext && (resolvedType || 'time_series') !== 'feedback_dominance') {
          const feedbackPath = join(sessionManager.getSessionTempDir(sessionId), 'feedback.json');
          if (existsSync(feedbackPath)) {
            const feedbackFile = JSON.parse(readFileSync(feedbackPath, 'utf8'));
            const feedback = feedbackFile.feedbackContent
              ? extractRunFeedback(feedbackFile.feedbackContent, selectedRunId)
              : feedbackFile;
            if (feedback.dominantLoopsByPeriod?.length > 0) {
              extraOptions.highlightPeriods = feedback.dominantLoopsByPeriod.map(p => ({
                start: p.startTime,
                end: p.endTime,
                label: p.dominantLoops.join(', ')
              }));
            }
          }
        }

        const vizOptions = {
          ...options,
          ...extraOptions,
          title,
          description,
          usePython,
          useAICustom,
          dataDescription: dataDescription,
          visualizationGoal
        };

        // VisualizationEngine returns raw SVG string
        const svgContent = await vizEngine.createVisualization(resolvedType || 'time_series', data, resolvedVariables, vizOptions);

        // Generate visualization ID
        const visualizationId = `viz_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const vizMessage = {
          type: 'visualization',
          sessionId: sessionId,
          visualizationId,
          title: title || 'Visualization',
          format: 'svg',
          data: svgContent,
          timestamp: new Date().toISOString()
        };

        // Add description if provided
        if (description) {
          vizMessage.description = description;
        }

        // Send visualization to client
        await sendToClient(vizMessage);

        return createSuccessResponse(`Created ${useAICustom ? 'AI-custom' : resolvedType || 'time_series'} SVG visualization: "${title}" and sent to client`);
      } catch (error) {
        return createErrorResponse(`Failed to create visualization: ${error.message}`, error);
      }
    }
  };
}
