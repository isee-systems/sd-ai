import { runAgent } from '../../agent/utilities/AgentEvalRunner.js';
import logger from '../../utilities/logger.js';

class Engine {
  static supportedModes() {
    return ['sfd-discuss', 'cld-discuss'];
  }

  static description() {
    return 'Test engine that wraps AgentOrchestrator for discussion/Q&A evals. Never shown in the public engine list.';
  }

  additionalParameters() {
    return [
      {
        name: 'agentName',
        type: 'string',
        required: true,
        uiElement: 'text',
        label: 'Agent Name',
        description: 'Which agent config to use (e.g. merlin, socrates)'
      },
      {
        name: 'agentMode',
        type: 'string',
        required: false,
        uiElement: 'text',
        label: 'Agent Mode',
        description: 'Execution mode override: sdk or manual. Defaults to the agent config value.'
      },
      {
        name: 'provider',
        type: 'string',
        required: false,
        uiElement: 'text',
        label: 'Provider',
        description: 'LLM provider: anthropic (default) or google'
      },
      {
        name: 'mode',
        type: 'string',
        required: true,
        uiElement: 'text',
        label: 'Mode',
        description: 'Discussion mode: sfd-discuss or cld-discuss'
      },
      {
        name: 'problemStatement',
        type: 'string',
        required: false,
        uiElement: 'textarea',
        saveForUser: 'local',
        label: 'Problem Statement',
        description: 'Description of a dynamic issue within the system you are studying that highlights an undesirable behavior over time.',
        minHeight: 50,
        maxHeight: 100
      },
      {
        name: 'backgroundKnowledge',
        type: 'string',
        required: false,
        uiElement: 'textarea',
        saveForUser: 'local',
        label: 'Background Knowledge',
        description: 'Background information you want the LLM model to consider when generating a model for you',
        minHeight: 100
      },
      {
        name: 'feedbackContent',
        type: 'feedbackJSON',
        required: false,
        uiElement: 'hidden',
        label: 'JSON Description of feedback loops',
        description: 'A JSON object representing all of the feedback loops in the model'
      }
    ];
  }

  async generate(prompt, currentModel, parameters) {
    try {
      const { explanation } = await runAgent(prompt, currentModel, parameters);
      return { output: explanation };
    } catch (err) {
      logger.error('[test-agent-discuss] generate error:', err);
      return { err: err.toString() };
    }
  }
}

export default Engine;
