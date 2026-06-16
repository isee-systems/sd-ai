import { z } from 'zod';
import { createSuccessResponse, createErrorResponse, selectEngineModel } from './toolHelpers.js';

/**
 * Render a simplified causal loop diagram (CLD) as an SVG and send it to the client.
 *
 * This tool does NOT consume the raw feedback structure. The agent is expected to
 * first call get_feedback_information (and optionally generate_ltm_narrative /
 * discuss_model_with_seldon) to understand which feedback loops drive behavior,
 * then distil that analysis into a small set of clean, human-readable loops and
 * pass them here. The simplified loops are then drawn as SVG by an LLM (see
 * VisualizationEngine.createCausalLoopDiagram).
 */
export function createDrawCausalLoopDiagramTool(sessionManager, sessionId, sendToClient, vizEngine, provider) {
  return {
    description: `Draw a simplified causal loop diagram (CLD) as an SVG and display it in chat. SFD models only.

Use this to visually explain the ORIGINS of a model's behavior. The diagram shows the key feedback loops you have identified, the causal links between variables (with + / − polarity), and which loops dominate.

IMPORTANT — this tool does not read the raw feedback data. First understand the dynamics by calling get_feedback_information (then generate_ltm_narrative or discuss_model_with_seldon if helpful), then SIMPLIFY that analysis into a handful of clean loops yourself and pass them here:
- Focus on a SINGLE loopset — one coherent group of interconnected loops that together explain the behavior at hand. Do NOT try to depict every loop in the model; choose the smallest set of loops that tells the story. To explain a separate dynamic, draw a separate diagram.
- Collapse long Loops That Matter loops into their essential variables; use readable names, not raw identifiers.
- Keep links ordered so each loop reads as a closed cycle (each link's "to" is the next link's "from", returning to the start).
- Set each loop's polarity (reinforcing/balancing) and, when known from the analysis, its dominance (% of behavior explained) so dominant loops are emphasized.

By default the diagram is kept CLEAN — it shows only the structure (loops, links, polarity, loop ids) and a concise legend. Do NOT expect the per-loop 'explanation' text or the 'notes' narrative caption to appear on the diagram. Only set showDescriptions=true (and supply 'explanation'/'notes') when the end user EXPLICITLY asks for the written descriptions to be drawn on the diagram itself. Otherwise, explain the loops in your chat reply, not on the image.`,
    supportedModes: ['sfd'],
    inputSchema: z.object({
      title: z.string().describe('Diagram title'),
      description: z.string().optional().describe('Short description shown with the visualization in chat'),
      loops: z.array(z.object({
        id: z.string().describe('Short loop badge label, e.g. "R1" or "B2"'),
        polarity: z.enum(['reinforcing', 'balancing']).describe('Loop polarity: reinforcing (R) amplifies, balancing (B) counteracts'),
        label: z.string().optional().describe('Human-readable name for the loop, e.g. "Word of mouth"'),
        dominance: z.number().min(0).max(100).optional().describe('Approx % of model behavior this loop explains (from Loops That Matter); used to rank loops in the legend and thicken their links'),
        explanation: z.string().optional().describe('One short sentence on how this loop contributes to the behavior. Only drawn on the diagram when showDescriptions=true; otherwise omit it.'),
        links: z.array(z.object({
          from: z.string().describe('Source variable'),
          to: z.string().describe('Target variable'),
          polarity: z.enum(['+', '-']).describe('Link polarity: + same direction, − opposite direction')
        })).min(1).describe('Ordered causal links forming the loop')
      })).min(1).describe('The simplified feedback loops to draw'),
      notes: z.string().optional().describe('Plain-language narrative tying the loops to the origins of the observed behavior. Only drawn as a caption when showDescriptions=true.'),
      showDescriptions: z.boolean().optional().describe('Draw the written descriptions (per-loop explanations and the narrative caption) on the diagram. Default false — the diagram stays clean and structural. Set true ONLY when the end user explicitly asks for the textual descriptions on the diagram.'),
      width: z.number().optional().describe('Output width in pixels (default 940)'),
      height: z.number().optional().describe('Output height in pixels (default 700)')
    }),
    handler: async ({ title, description, loops, notes, showDescriptions, width, height }) => {
      try {
        // Drawing a clean, low-crossing CLD is hard layout work — always use the high-difficulty model.
        const underlyingModel = selectEngineModel(provider, 'hard', 'nonBuild');
        const svgContent = await vizEngine.createCausalLoopDiagram(
          { loops, title, notes },
          { title, notes, width, height, underlyingModel, showDescriptions: showDescriptions ?? false }
        );

        const visualizationId = `cld_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const vizMessage = {
          type: 'visualization',
          sessionId: sessionId,
          visualizationId,
          title: title || 'Causal Loop Diagram',
          format: 'svg',
          data: svgContent,
          timestamp: new Date().toISOString()
        };

        if (description) {
          vizMessage.description = description;
        }

        await sendToClient(vizMessage);

        return createSuccessResponse(`Drew causal loop diagram "${title}" with ${loops.length} loop${loops.length !== 1 ? 's' : ''} and sent it to the client`);
      } catch (error) {
        return createErrorResponse(`Failed to draw causal loop diagram: ${error.message}`, error);
      }
    }
  };
}
