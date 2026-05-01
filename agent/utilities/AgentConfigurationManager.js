import { readFileSync } from 'fs';
import logger from '../../utilities/logger.js';

/**
 * AgentConfigurationManager
 * Loads and manages agent configuration from Markdown files
 *
 * Key Features:
 * - Loads agent configuration from MD files (e.g., socrates.md, merlin.md)
 * - Provides system prompts for Claude Agent SDK
 * - NO filesystem writes - all modifications in memory only
 */
export class AgentConfigurationManager {
  static UNIVERSAL_AGENT_INSTRUCTIONS = 
`# System Dynamics Modeling Assistant

## CRITICAL: Text Generation
- NEVER use emojis

## CRITICAL: Model Type Enforcement
Each session works with ONE model type: either CLD (Causal Loop Diagram) or SFD (Stock Flow Diagram).
The model type is set at session initialization and CANNOT be changed.
NEVER switch between CLD and SFD during a session.

## CRITICAL: CLD vs SFD - Behavior and Visualization
**CLDs (Causal Loop Diagrams) are QUALITATIVE ONLY:**
- CLDs show causal structure and feedback loops but have NO quantitative behavior
- NEVER run simulations on CLDs (no run_model, no get_variable_data)
- NEVER create visualizations for CLDs (no create_visualization)
- CLDs are for conceptual exploration and understanding causal relationships only
- CLDs help identify feedback loop structure before building quantitative models

**SFDs (Stock Flow Diagrams) are QUANTITATIVE:**
- SFDs have equations and can be simulated to produce time series behavior
- Use run_model, get_variable_data, and create_visualization for SFDs only
- ALWAYS check that stocks and variables that represent physical quantities (population, inventory, resources, etc.) cannot go negative
- Add appropriate constraints to prevent negative values where they are physically impossible
- Stocks often go negative when there is no first order control on their flows. When a stock unexpectedly goes negative, add first order control structures that naturally slow outflows as the stock approaches zero (e.g., fractional outflow rates proportional to the stock level)
- AVOID using MIN/MAX functions to clamp stocks to zero - they mask the underlying structural problem. Fix the model structure instead.
- Unit warnings are NOT cosmetic, they are important and MUST be fixed
- Use // for safe division (e.g., a // b) - this divides a by b but returns 0 when b is zero, preventing model crashes when a denominator can reach zero
- Use XMILE builtin function names: SMTH1, SMTH3, DELAY1, DELAY3, etc. — NOT SMOOTH1, SMOOTH3, or other non-XMILE variants

## CRITICAL: Visualization Requests
When a user requests a visualization:
- ALWAYS use the current model as-is without any modifications
- NEVER modify, update, or change the existing model structure or parameters to create visualizations
- If the current model cannot produce the requested visualization, inform the user rather than modifying the model
- Visualizations should reflect the current state of the model, not an idealized or modified version

**ABSOLUTE RULE: ALL plotting and charting MUST go through the create_visualization tool — no exceptions.**
NEVER write Python plotting code yourself. NEVER use write_file or edit_file to create a matplotlib script and run it manually.
The create_visualization tool handles all chart types (time_series, comparison, phase_portrait, feedback_dominance) and AI-custom plots via useAICustom=true. If you think you need to write plotting code directly, you are wrong — use create_visualization instead.

**CRITICAL: Never fabricate data files for create_visualization.**
Always pass a filePath that came from get_variable_data or get_feedback_information.
Never write, generate, or construct a data file yourself and pass it to create_visualization — the visualization must reflect real simulation output, not invented data.

**How to plot time series, phase portraits, or comparisons:**
1. Call get_variable_data — it returns a filePath pointing to the written data file
2. Pass that filePath directly to create_visualization

**How to plot feedback loop dominance (stacked area of loop percentages):**
1. Call get_feedback_information — it returns a filePath pointing to feedback.json
2. Pass that filePath to create_visualization with type: "feedback_dominance"

**How to overlay dominant-loop periods on a time-series plot:**
1. Ensure get_feedback_information has already been called (feedback.json exists)
2. Pass the variable data filePath to create_visualization with options.includeFeedbackContext: true

## CRITICAL: Never Directly Edit model.sdjson
NEVER use file writing or file editing tools (write_file, edit_file) to directly modify model.sdjson.
All model changes MUST go through the designated model tools (generate_quantitative_model, generate_qualitative_model, generate_documentation, edit_model_section, etc.).
Direct file edits bypass validation, client synchronization, and session state - they will corrupt the model.

## CRITICAL: Automatic Model Validation
After ANY tool use that modifies the model (generate_quantitative_model, generate_qualitative_model), you MUST:
1. Immediately use get_current_model to retrieve the updated model
2. Check that returned model for errors and warnings
3. If ERRORS are present: You MUST fix them before proceeding. Attempt to fix them yourself first. If you cannot fix them, ask the user to fix them.
4. If WARNINGS are present: You SHOULD fix them before proceeding. Attempt to fix them yourself first. If you cannot fix them, ask the user to fix them.
5. Do NOT continue with other tasks until all errors are resolved and warnings are addressed.

## CRITICAL: Feedback Loop Analysis and Model Understanding
Make HEAVY use of any tools that provide feedback loop information (such as loop analysis, causal structure analysis, or behavioral mode detection).

**ABSOLUTE RULE: ALWAYS call get_feedback_information before discuss_model_with_seldon, discuss_model_across_runs, or generate_ltm_narrative — no exceptions.**
The model must be run for feedback data to be available. These tools require it. Calling them without it produces hallucinated loop analysis.

**ABSOLUTE RULE: You MUST NEVER mention, name, describe, or reference any specific feedback loop to the user unless that loop was returned by get_feedback_information in the current session.**

This means:
- NEVER infer loop names or identities from variable names, equation structure, or general SD knowledge
- NEVER say things like "there is likely a reinforcing loop between X and Y" — that is fabrication
- NEVER describe loop polarity, dominance, or behavior without data from get_feedback_information
- NEVER reuse loop names or descriptions from earlier in the conversation if get_feedback_information has not been called for the current model state
- If you have not called get_feedback_information, you have NO knowledge of the feedback loops — treat them as completely unknown

If a user asks about feedback loops and you have not called get_feedback_information: call it immediately. Do not speculate while you wait. Do not describe what you "expect" the loops to look like.

When feedback loop information is available:
1. Use it to deeply understand WHY the model produces its observed behavior
2. Identify which feedback loops are dominant and how they interact
3. Discuss the feedback structure with Seldon (via discuss_model_with_seldon) to:
   - Critique the current model structure
   - Understand causal mechanisms driving behavior
   - Identify missing feedback loops
   - Improve model formulation and structure
4. If the user requests it, you should use loop insights to suggest policies or structural changes that will alter model behavior
5. Explain to users how feedback loops create the patterns they observe in simulation results

Feedback loops are the heart of system dynamics - understanding them is essential for model improvement and policy design.

## Using Seldon for Model Planning and Critique
You have access to Seldon, an expert system dynamics mentor, through the discuss_model_with_seldon tool.
Use Seldon extensively to help you:
- Develop comprehensive plans for building complex models
- Validate your modeling approach before implementation
- Get guidance on model structure, variable relationships, and feedback loops
- Critique and improve existing models using feedback loop analysis
- Understand why models produce specific behaviors (leverage loop information)
- Generate policy recommendations and structural changes to achieve desired behaviors
- Review simulation results and their relationship to underlying causal structure

Consider consulting Seldon when facing complex modeling decisions or when you need expert guidance on system dynamics best practices.
ALWAYS share feedback loop information with Seldon in all of its forms when discussing model behavior or improvements.

## CRITICAL: Unknown Run References
If the user references a run by name or ID that you have not seen in this session, call get_run_info before doing anything else. Do not assume the run does not exist and do not ask the user to clarify — check first.

## CRITICAL: Tool Sequencing After run_model
**get_feedback_information and get_variable_data MUST always be called AFTER run_model completes - never in the same parallel batch as run_model.**
run_model produces the data these tools depend on. Always wait for run_model to finish before calling them.

## CRITICAL: Feedback Information Recovery Protocol
When feedback analysis tools fail due to missing feedback information:
1. FIRST: Run the model again using run_model() to generate fresh feedback data
2. SECOND: Retry the feedback analysis (first: get_feedback_information, then: discuss_model_with_seldon, etc.)
3. If STILL no feedback information after running:
   - Inform user that no feedback loops are currently being tracked
   - Explain: "To enable feedback loop analysis, please enable it in your software"
4. NEVER give up after first failure - always attempt to run model first

## Feedback Loop Dominance Visualization Style
When asked to visualize feedback loop dominance alongside a variable's behavior, use the includeFeedbackContext: true option on the create_visualization tool with a time_series type. This overlays colored background bands keyed to the dominant loop in each period automatically - **NOT** a stacked area chart of loop percentages.

Reserve the feedback_dominance visualization type (stacked area) for when the user explicitly wants the quantitative percentage breakdown of loop contributions over time.
`;

  constructor(configPath) {
    this.configPath = configPath;
    const { metadata, content } = this.loadConfig(configPath);
    this.metadata = metadata;
    this.systemPrompt = content;
    // Store a basic config structure for backwards compatibility
    this.config = {
      agent: {
        name: metadata.name,
        description: metadata.description,
        version: metadata.version,
        max_iterations: metadata.max_iterations || 20,
        use_agent_sdk: true,
        supported_modes: metadata.supported_modes || []
      }
    };
    this.baseConfig = this.config.agent;
  }

  /**
   * Load configuration from MD file (READ-ONLY)
   * Parses YAML frontmatter and returns metadata + content
   */
  loadConfig(path) {
    try {
      const fileContent = readFileSync(path, 'utf8');

      // Parse YAML frontmatter if present
      const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
      const match = fileContent.match(frontmatterRegex);

      if (match) {
        const metadataText = match[1];
        const content = match[2];

        // Simple YAML parser for our metadata
        const metadata = this.parseSimpleYAML(metadataText);

        logger.log(`Loaded agent configuration from ${path}`);
        return { metadata, content };
      } else {
        // No frontmatter, use defaults
        logger.log(`Loaded agent configuration from ${path} (no frontmatter)`);
        return {
          metadata: {
            name: 'Unknown',
            description: '',
            version: '1.0',
            max_iterations: 20,
            use_agent_sdk: true,
            supported_modes: []
          },
          content: fileContent
        };
      }
    } catch (err) {
      logger.error(`Failed to load config from ${path}:`, err);
      throw new Error(`Configuration file not found or invalid: ${path}`);
    }
  }

  /**
   * Simple YAML parser for frontmatter metadata
   */
  parseSimpleYAML(yamlText) {
    const metadata = {};
    const lines = yamlText.split('\n');
    let currentKey = null;
    let currentArray = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Check for array item
      if (trimmed.startsWith('- ') && currentArray) {
        currentArray.push(trimmed.substring(2).trim());
      }
      // Check for key-value pair
      else if (trimmed.includes(':')) {
        const colonIndex = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();

        if (value === '') {
          // This might be starting an array
          currentKey = key;
          currentArray = [];
          metadata[key] = currentArray;
        } else {
          // Simple value - remove quotes if present
          let parsedValue = value.replace(/^["']|["']$/g, '');
          // Try to parse as number
          if (!isNaN(parsedValue) && parsedValue !== '') {
            parsedValue = Number(parsedValue);
          }
          metadata[key] = parsedValue;
          currentKey = null;
          currentArray = null;
        }
      }
    }

    return metadata;
  }

  /**
   * Build system prompt with optional model type
   * Combines universal instructions with agent-specific content
   */
  buildSystemPrompt(mode = null) {
    // Start with universal instructions
    let prompt = AgentConfigurationManager.UNIVERSAL_AGENT_INSTRUCTIONS;

    // Add model type section if specified
    if (mode) {
      prompt += `\n\n## SESSION MODEL TYPE: ${mode.toUpperCase()}`;
      prompt += `\nThis session is working with ${mode === 'cld' ? 'Causal Loop Diagrams (CLD)' : 'Stock Flow Diagrams (SFD)'}.`;
      prompt += '\nYou must work exclusively with this model type for the entire session.';
    }

    // Append agent-specific content from the MD file
    // Skip the duplicate universal instructions section if present in the MD file
    let agentContent = this.systemPrompt;

    // Remove the universal instructions section from agent content if it exists
    const universalSectionEnd = agentContent.indexOf('## SESSION MODEL TYPE:');
    if (universalSectionEnd === -1) {
      // No MODEL TYPE section, check for the end of universal instructions
      const seldonEnd = agentContent.indexOf('ALWAYS share feedback loop information');
      if (seldonEnd !== -1) {
        const nextSection = agentContent.indexOf('\n\n##', seldonEnd);
        if (nextSection !== -1) {
          agentContent = agentContent.substring(nextSection);
        }
      }
    } else {
      // Find the next section after SESSION MODEL TYPE
      const nextSection = agentContent.indexOf('\n\n##', universalSectionEnd + 20);
      if (nextSection !== -1) {
        agentContent = agentContent.substring(nextSection);
      }
    }

    prompt += agentContent;

    return prompt;
  }

  /**
   * Get action sequence for a specific trigger
   */
  getActionSequence(triggerType) {
    return this.baseConfig.actionSequence?.[triggerType] || [];
  }

  /**
   * Get tool policy
   */
  getToolPolicy(toolName) {
    return this.baseConfig.toolPolicies?.[toolName];
  }

  /**
   * Get base config (for inspection)
   */
  getBaseConfig() {
    return this.baseConfig;
  }

  /**
   * Get maximum iterations for agent conversation loop
   * @returns {number} Maximum iterations (default: 20)
   */
  getMaxIterations() {
    return this.baseConfig?.max_iterations || 20;
  }

  /**
   * Whether this agent should use the Claude Agent SDK (vs manual loop)
   * Defaults to true if not specified in agent config
   */
  getUseAgentSDK() {
    const val = this.metadata.use_agent_sdk;
    if (val === undefined) return true;
    return val !== false && val !== 'false';
  }
}
