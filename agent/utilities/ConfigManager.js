import { readFileSync } from 'fs';
import yaml from 'js-yaml';
import logger from '../../utilities/logger.js';

/**
 * ConfigManager
 * Loads and manages agent configuration from YAML files
 *
 * Key Features:
 * - Loads agent configuration from YAML files (e.g., ganos-lal.yaml, myrddin.yaml)
 * - Merges with session-specific config
 * - Merges with runtime directives
 * - Generates system prompts for Claude Agent SDK
 * - NO filesystem writes - all modifications in memory only
 */
export class ConfigManager {
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
  buildSystemPrompt(sessionConfig = {}, runtimeDirectives = {}, modelType = null) {
    const merged = this.mergeConfigs(this.baseConfig, sessionConfig, runtimeDirectives);
    merged.modelType = modelType;
    return this.formatSystemPrompt(merged);
  }

  /**
   * Merge configurations (runtime > session > base)
   */
  mergeConfigs(base, session, runtime) {
    const merged = {
      ...base,
      instructions: {
        ...base.instructions
      },
      toolPolicies: {
        ...base.toolPolicies
      },
      communication: {
        ...base.communication
      }
    };

    // Apply session-level overrides
    if (session.agentInstructions) {
      if (session.agentInstructions.role) {
        merged.sessionRole = session.agentInstructions.role;
      }
      if (session.agentInstructions.constraints) {
        merged.sessionConstraints = session.agentInstructions.constraints;
      }
      if (session.agentInstructions.goals) {
        merged.sessionGoals = session.agentInstructions.goals;
      }
      if (session.agentInstructions.workflowOverrides) {
        merged.workflowOverrides = session.agentInstructions.workflowOverrides;
      }
    }

    if (session.personality) {
      merged.communication = {
        ...merged.communication,
        ...session.personality
      };
    }

    // Apply runtime directives
    if (runtime.temporaryInstructions) {
      merged.runtimeInstructions = runtime.temporaryInstructions;
    }

    return merged;
  }

  /**
   * Format merged config into system prompt
   */
  formatSystemPrompt(config) {
    const sections = [];

    // General instructions
    sections.push('# System Dynamics Modeling Assistant\n');

    // CRITICAL: Hard-coded model type enforcement rules
    sections.push('\n## CRITICAL: Model Type Enforcement');
    sections.push('Each session works with ONE model type: either CLD (Causal Loop Diagram) or SFD (Stock Flow Diagram).');
    sections.push('The model type is set at session initialization and CANNOT be changed.');
    sections.push('NEVER switch between CLD and SFD during a session.');

    // CRITICAL: Hard-coded model validation rules
    sections.push('\n## CRITICAL: Automatic Model Validation');
    sections.push('After ANY tool use that modifies the model (generate_quantitative_model, generate_qualitative_model), you MUST:');
    sections.push('1. Immediately use get_current_model to retrieve the updated model');
    sections.push('2. Check the model for errors and warnings');
    sections.push('3. If ERRORS are present: You MUST fix them before proceeding. Attempt to fix them yourself first. If you cannot fix them, ask the user to fix them.');
    sections.push('4. If WARNINGS are present: You SHOULD fix them before proceeding. Attempt to fix them yourself first. If you cannot fix them, ask the user to fix them.');
    sections.push('5. Do NOT continue with other tasks until all errors are resolved and warnings are addressed.');

    // Model type declaration
    if (config.modelType) {
      sections.push(`\n## SESSION MODEL TYPE: ${config.modelType.toUpperCase()}`);
      sections.push(`This session is working with ${config.modelType === 'cld' ? 'Causal Loop Diagrams (CLD)' : 'Stock Flow Diagrams (SFD)'}.`);
      sections.push('You must work exclusively with this model type for the entire session.\n');
    }

    sections.push(config.instructions.general);

    // Session role override
    if (config.sessionRole) {
      sections.push('\n## Your Role');
      sections.push(config.sessionRole);
    }

    // Modeling workflow
    sections.push('\n## Modeling Workflow');
    sections.push(config.instructions.modeling_workflow);

    // Modification workflow
    sections.push('\n## Modification Workflow');
    sections.push(config.instructions.modification_workflow);

    // Validation rules
    sections.push('\n## Validation Rules');
    sections.push(config.instructions.validation_rules);

    // Visualization guidelines
    if (config.instructions.visualization_guidelines) {
      sections.push('\n## Visualization Guidelines');
      sections.push(config.instructions.visualization_guidelines);
    }

    // Tool policies
    sections.push('\n## Tool Usage Policies');
    sections.push(this.formatToolPolicies(config.toolPolicies));

    // Action sequences
    sections.push('\n## Action Sequences');
    sections.push(this.formatActionSequences(config.actionSequence, config.workflowOverrides));

    // Communication style
    sections.push('\n## Communication Style');
    sections.push(this.formatCommunicationGuidelines(config.communication));

    // Error handling
    sections.push('\n## Error Handling');
    sections.push(this.formatErrorHandling(config.errorHandling));

    // Constraints
    sections.push('\n## Constraints');
    sections.push(this.formatConstraints(config.constraints));

    // Session goals
    if (config.sessionGoals && config.sessionGoals.length > 0) {
      sections.push('\n## Session Goals');
      config.sessionGoals.forEach(goal => {
        sections.push(`- ${goal}`);
      });
    }

    // Session constraints
    if (config.sessionConstraints && config.sessionConstraints.length > 0) {
      sections.push('\n## Session Constraints');
      config.sessionConstraints.forEach(constraint => {
        sections.push(`- ${constraint}`);
      });
    }

    // Runtime instructions
    if (config.runtimeInstructions && config.runtimeInstructions.length > 0) {
      sections.push('\n## IMPORTANT: Current Instructions');
      config.runtimeInstructions.forEach(instruction => {
        sections.push(`- ${instruction}`);
      });
    }

    return sections.join('\n');
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
  formatActionSequences(sequences, overrides = {}) {
    const lines = [];

    // Handle missing or null sequences
    if (!sequences) {
      return '';
    }

    for (const [triggerType, steps] of Object.entries(sequences)) {
      // Check for workflow overrides
      const effectiveSteps = overrides?.[triggerType] || steps;

      lines.push(`\n### ${triggerType}`);
      effectiveSteps.forEach((step, idx) => {
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

    if (errorHandling.onToolFailure) {
      lines.push('**On tool failure:**');
      Object.entries(errorHandling.onToolFailure).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    if (errorHandling.onInvalidModel) {
      lines.push('\n**On invalid model:**');
      Object.entries(errorHandling.onInvalidModel).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    if (errorHandling.onSimulationFailure) {
      lines.push('\n**On simulation failure:**');
      Object.entries(errorHandling.onSimulationFailure).forEach(([key, value]) => {
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

    if (constraints.maxModelComplexity) {
      lines.push('**Maximum model complexity:**');
      Object.entries(constraints.maxModelComplexity).forEach(([key, value]) => {
        lines.push(`- ${key}: ${value}`);
      });
    }

    if (constraints.requireDocumentation) {
      lines.push('- All variables must have documentation');
    }
    if (constraints.enforceUnits) {
      lines.push('- All variables must have units');
    }
    if (constraints.validateEquations) {
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
