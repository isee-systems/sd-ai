import { readFileSync } from 'fs';
import logger from '../../utilities/logger.js';

/**
 * AgentConfigurationManager
 * Loads and manages agent configuration from Markdown files
 *
 * Key Features:
 * - Loads agent configuration from MD files (e.g., ganos-lal.md, myrddin.md)
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
- NEVER run simulations on CLDs (no run_model, no get_run_data)
- NEVER create visualizations for CLDs (no create_visualization)
- CLDs are for conceptual exploration and understanding causal relationships only
- CLDs help identify feedback loop structure before building quantitative models

**SFDs (Stock Flow Diagrams) are QUANTITATIVE:**
- SFDs have equations and can be simulated to produce time series behavior
- Use run_model, get_run_data, and create_visualization for SFDs only
- ALWAYS check that stocks and variables that represent physical quantities (population, inventory, resources, etc.) cannot go negative
- Add appropriate constraints prevent negative values where they are physically impossible

## CRITICAL: Visualization Requests
When a user requests a visualization:
- ALWAYS use the current model as-is without any modifications
- NEVER modify, update, or change the existing model structure or parameters to create visualizations
- Follow this sequence: get_current_model -> run_model (if needed) -> get_run_data -> create_visualization
- If the current model cannot produce the requested visualization, inform the user rather than modifying the model
- Visualizations should reflect the current state of the model, not an idealized or modified version

**CRITICAL: Data Structure for create_visualization**
When calling create_visualization, the data parameter MUST be structured exactly as follows:
{
  time: [0, 1, 2, 3, ...],
  Variable1: [value1, value2, value3, ...],
  Variable2: [value1, value2, value3, ...],
  ...
}

**Common Error:** Do NOT pass the full tool result from get_run_data (which includes success, runId, etc.).
Instead, extract ONLY the time series data fields:
- Correct: { time: result.time, Population: result.Population, Births: result.Births }
- Wrong: result (includes success, runId, and other metadata)

## CRITICAL: Automatic Model Validation
After ANY tool use that modifies the model (generate_quantitative_model, generate_qualitative_model), you MUST:
1. Immediately use get_current_model to retrieve the updated model
2. Check that returned model for errors and warnings
3. If ERRORS are present: You MUST fix them before proceeding. Attempt to fix them yourself first. If you cannot fix them, ask the user to fix them.
4. If WARNINGS are present: You SHOULD fix them before proceeding. Attempt to fix them yourself first. If you cannot fix them, ask the user to fix them.
5. Do NOT continue with other tasks until all errors are resolved and warnings are addressed.

## CRITICAL: Feedback Loop Analysis and Model Understanding
Make HEAVY use of any tools that provide feedback loop information (such as loop analysis, causal structure analysis, or behavioral mode detection).

**IMPORTANT: Before using discuss_model_with_seldon or generate_ltm_narrative, you MUST:**
1. First call get_feedback_information to retrieve feedback loop analysis data from the client
2. Pass this feedback information to discuss_model_with_seldon or generate_ltm_narrative
3. Don't call these tools without giving them feedback information when you're asking about causes of behavior.

**CRITICAL: NEVER report or describe specific feedback loops to the user unless:**
**If you want to talk about feedback loop definitions, you MUST first call get_feedback_information.**

Do NOT make up, infer, or describe feedback loops based on general knowledge or variable relationships.
Do NOT describe feedback loops based on your understanding of the model structure alone.
Only report feedback loops that you have actual data for from the client via get_feedback_information.

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

## CRITICAL: Feedback Information Recovery Protocol
When feedback analysis tools fail due to missing feedback information:
1. FIRST: Run the model again using run_model() to generate fresh feedback data
2. SECOND: Retry the feedback analysis (get_feedback_information, discuss_model_with_seldon, etc.)
3. If STILL no feedback information after running:
   - Inform user that no feedback loops are currently being tracked
   - Explain: "To enable feedback loop analysis, please enable 'Loops That Matter' in the client settings"
   - Suggest: They can enable specific feedback loops for tracking and analysis
4. NEVER give up after first failure - always attempt to run model first`;

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
        supports: metadata.supports || ['sfd', 'cld']
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
            supports: ['sfd', 'cld']
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
  buildSystemPrompt(modelType = null) {
    // Start with universal instructions
    let prompt = AgentConfigurationManager.UNIVERSAL_AGENT_INSTRUCTIONS;

    // Add model type section if specified
    if (modelType) {
      prompt += `\n\n## SESSION MODEL TYPE: ${modelType.toUpperCase()}`;
      prompt += `\nThis session is working with ${modelType === 'cld' ? 'Causal Loop Diagrams (CLD)' : 'Stock Flow Diagrams (SFD)'}.`;
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
}
