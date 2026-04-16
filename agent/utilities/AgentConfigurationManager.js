import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import logger from '../../utilities/logger.js';

/**
 * AgentConfigurationManager
 * Loads and manages agent configuration from YAML files
 *
 * Key Features:
 * - Loads agent configuration from YAML files (e.g., ganos-lal.yaml, myrddin.yaml)
 * - Generates system prompts for Claude Agent SDK
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
Loops That Matter (LTM) is a feedback‑loop dominance analysis technique from system dynamics used to identify which feedback loops are actually driving system behavior at a given time. Rather than cataloging all loops in a model, LTM ranks loops by their instantaneous impact on change, showing how dominance shifts as system structure, delays, and nonlinearities interact.

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
ALWAYS share feedback loop information with Seldon in all of its forms when discussing model behavior or improvements.`;

  constructor(configPath) {
    this.configPath = configPath;
    this.baseConfig = this.loadConfig(configPath);
    // Expose config for tests
    this.config = { agent: this.baseConfig };
  }

  /**
   * Load configuration from YAML file (READ-ONLY)
   */
  loadConfig(path) {
    try {
      const content = readFileSync(path, 'utf8');
      const config = yaml.load(content);
      logger.log(`Loaded agent configuration from ${path}`);
      return config.agent;  // Get the 'agent' key from YAML
    } catch (err) {
      logger.error(`Failed to load config from ${path}:`, err);
      throw new Error(`Configuration file not found or invalid: ${path}`);
    }
  }

  /**
   * Build system prompt by merging configs
   */
  buildSystemPrompt(modelType = null) {
    const merged = this.baseConfig;
    merged.modelType = modelType;
    return this.formatSystemPrompt(this.baseConfig);
  }

  /**
   * Format merged config into system prompt
   */
  formatSystemPrompt(config) {
    let prompt = AgentConfigurationManager.UNIVERSAL_AGENT_INSTRUCTIONS;

    // Model type declaration
    if (config.modelType) {
      prompt += `\n\n## SESSION MODEL TYPE: ${config.modelType.toUpperCase()}`;
      prompt += `\nThis session is working with ${config.modelType === 'cld' ? 'Causal Loop Diagrams (CLD)' : 'Stock Flow Diagrams (SFD)'}.`;
      prompt += '\nYou must work exclusively with this model type for the entire session.';
    }

    prompt += '\n\n' + config.instructions.general;

    // Session role override
    if (config.sessionRole) {
      prompt += '\n\n## Your Role';
      prompt += '\n' + config.sessionRole;
    }

    // Modeling workflow
    prompt += '\n\n## Modeling Workflow';
    prompt += '\n' + config.instructions.modeling_workflow;

    // Modification workflow
    prompt += '\n\n## Modification Workflow';
    prompt += '\n' + config.instructions.modification_workflow;

    // Validation rules
    prompt += '\n\n## Validation Rules';
    prompt += '\n' + config.instructions.validation_rules;

    // Visualization guidelines
    if (config.instructions.visualization_guidelines) {
      prompt += '\n\n## Visualization Guidelines';
      prompt += '\n' + config.instructions.visualization_guidelines;
    }

    // Tool policies
    prompt += '\n\n## Tool Usage Policies';
    prompt += '\n' + this.formatToolPolicies(config.tool_policies);

    // Action sequences
    prompt += '\n\n## Action Sequences';
    prompt += '\n' + this.formatActionSequences(config.action_sequence);

    // Communication style
    prompt += '\n\n## Communication Style';
    prompt += '\n' + this.formatCommunicationGuidelines(config.communication);

    // Error handling
    prompt += '\n\n## Error Handling';
    prompt += '\n' + this.formatErrorHandling(config.error_handling);

    // Constraints
    prompt += '\n\n## Constraints';
    prompt += '\n' + this.formatConstraints(config.constraints);

    return prompt;
  }

  /**
   * Format tool policies
   */
  formatToolPolicies(policies) {
    const lines = [];

    for (const [toolName, policy] of Object.entries(policies)) {
      lines.push(`\n### ${toolName}`);
      if (policy.whenToUse) {
        lines.push(`**When to use:** ${policy.whenToUse}`);
      }
      if (policy.frequency) {
        lines.push(`**Frequency:** ${policy.frequency}`);
      }
      if (policy.alwaysExplain) {
        lines.push(`**Always explain** your reasoning when using this tool`);
      }
      if (policy.autoSuggest) {
        lines.push(`**Auto-suggest** this tool when appropriate`);
      }
      if (policy.parameters) {
        lines.push(`**Default parameters:** ${JSON.stringify(policy.parameters)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format action sequences
   */
  formatActionSequences(sequences) {
    const lines = [];

    // Handle missing or null sequences
    if (!sequences) {
      return '';
    }

    for (const [triggerType, steps] of Object.entries(sequences)) {
      lines.push(`\n### ${triggerType}`);
      steps.forEach((step, idx) => {
        lines.push(`${idx + 1}. **${step.step}**`);
        if (step.description) {
          lines.push(`   ${step.description}`);
        }
        if (step.tools) {
          lines.push(`   Tools: ${step.tools.join(', ')}`);
        }
        if (step.alwaysExecute) {
          lines.push(`   Always execute this step`);
        }
        if (step.condition) {
          lines.push(`   Condition: ${step.condition}`);
        }
      });
    }

    return lines.join('\n');
  }

  /**
   * Format communication guidelines
   */
  formatCommunicationGuidelines(communication) {
    const lines = [];

    lines.push(`**Style:** ${communication.style}`);
    if (communication.explainReasoning) {
      lines.push('- Always explain your reasoning');
    }
    if (communication.useExamples) {
      lines.push('- Use examples to clarify concepts');
    }
    if (communication.avoidJargon !== undefined) {
      lines.push(communication.avoidJargon
        ? '- Avoid technical jargon'
        : '- System Dynamics terminology is acceptable');
    }

    if (communication.responseFormat) {
      lines.push('\n**Response Format:**');
      for (const [aspect, guideline] of Object.entries(communication.responseFormat)) {
        lines.push(`- ${aspect}: ${guideline}`);
      }
    }

    if (communication.verbosity) {
      lines.push(`\n**Verbosity level:** ${communication.verbosity}`);
    }
    if (communication.tone) {
      lines.push(`**Tone:** ${communication.tone}`);
    }

    return lines.join('\n');
  }

  /**
   * Format error handling
   */
  formatErrorHandling(errorHandling) {
    const lines = [];

    if (!errorHandling) {
      return '';
    }

    if (errorHandling.on_tool_failure) {
      lines.push('**On tool failure:**');
      Object.entries(errorHandling.on_tool_failure).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    if (errorHandling.on_invalid_model) {
      lines.push('\n**On invalid model:**');
      Object.entries(errorHandling.on_invalid_model).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    if (errorHandling.on_simulation_failure) {
      lines.push('\n**On simulation failure:**');
      Object.entries(errorHandling.on_simulation_failure).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Format constraints
   */
  formatConstraints(constraints) {
    const lines = [];

    if (constraints.max_model_complexity) {
      lines.push('**Maximum model complexity:**');
      Object.entries(constraints.max_model_complexity).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    if (constraints.require_documentation) {
      lines.push('- All variables must have documentation');
    }
    if (constraints.enforce_units) {
      lines.push('- All variables must have units');
    }
    if (constraints.validate_equations) {
      lines.push('- All equations must be validated');
    }

    return lines.join('\n');
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
}
