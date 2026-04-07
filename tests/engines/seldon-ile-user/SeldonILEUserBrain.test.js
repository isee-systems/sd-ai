import SeldonILEUserBrain from '../../../engines/seldon-ile-user/SeldonILEUserBrain.js';
import { LLMWrapper } from '../../../utilities/LLMWrapper.js';

describe('SeldonILEUserBrain', () => {
  let brain;

  beforeEach(() => {
    brain = new SeldonILEUserBrain({
      openAIKey: 'test-key',
      anthropicKey: 'test-claude-key',
      googleKey: 'test-google-key'
    });
  });

  describe('setupLLMParameters', () => {
    it('should setup basic LLM parameters with default model', () => {
      const userPrompt = 'Why does the population grow so fast?';
      const result = brain.setupLLMParameters(userPrompt);

      // Parse the default model to extract base model and reasoning effort
      const parts = LLMWrapper.NON_BUILD_DEFAULT_MODEL.split(' ');
      const expectedModel = parts[0];
      const expectedReasoningEffort = parts.length > 1 ? parts[1] : undefined;

      expect(result.model).toBe(expectedModel);
      expect(result.temperature).toBe(0);
      expect(result.reasoningEffort).toBe(expectedReasoningEffort);
      expect(result.messages).toBeInstanceOf(Array);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[result.messages.length - 1].content).toBe(userPrompt);
    });

    it('should handle o3-mini model with reasoning effort', () => {
      const brainWithO3Mini = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3-mini high'
      });

      const result = brainWithO3Mini.setupLLMParameters('Test prompt');

      expect(result.model).toBe('o3-mini');
      expect(result.reasoningEffort).toBe('high');
    });

    it('should handle o3 model with reasoning effort', () => {
      const brainWithO3 = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3 low'
      });

      const result = brainWithO3.setupLLMParameters('Test prompt');

      expect(result.model).toBe('o3');
      expect(result.reasoningEffort).toBe('low');
    });

    it('should set temperature to undefined when model lacks temperature support', () => {
      const brainWithO3 = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3'  // o3 model doesn't support temperature
      });

      const result = brainWithO3.setupLLMParameters('Test prompt');

      expect(result.temperature).toBeUndefined();
    });

    it('should include background knowledge in messages when provided', () => {
      const brainWithBackground = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'This is a healthcare system model'
      });

      const result = brainWithBackground.setupLLMParameters('Test prompt');

      const backgroundMessage = result.messages.find(m => m.content.includes('This is a healthcare system model'));
      expect(backgroundMessage).toBeDefined();
      expect(backgroundMessage.role).toBe('user');
    });

    it('should include problem statement in messages when provided', () => {
      const brainWithProblem = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        problemStatement: 'Understanding population dynamics over time'
      });

      const result = brainWithProblem.setupLLMParameters('Test prompt');

      const problemMessage = result.messages.find(m => m.content.includes('Understanding population dynamics over time'));
      expect(problemMessage).toBeDefined();
    });

    it('should include lastModel and structure prompt when lastModel has variables', () => {
      const lastModel = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000' },
          { name: 'Birth Rate', type: 'variable', equation: '0.05' }
        ],
        relationships: [
          { from: 'Population', to: 'Births', polarity: '+' }
        ]
      };

      const result = brain.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toContain('Population');
      expect(assistantMessage.content).toContain('Birth Rate');

      const structurePromptMessage = result.messages.find(m =>
        m.role === 'user' && m.content.includes('consider the model which you have already')
      );
      expect(structurePromptMessage).toBeDefined();
    });

    it('should filter out model errors from lastModel when no equations present', () => {
      const lastModel = {
        variables: [],
        errors: ['Some error message']
      };

      const result = brain.setupLLMParameters('Test prompt', lastModel);

      // Since no variables, lastModel should not be included
      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
    });

    it('should include behavior prompt when behaviorContent is provided and lastModel has variables', () => {
      const brainWithBehavior = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        behaviorContent: 'Population grows exponentially over time'
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithBehavior.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m =>
        m.content.includes('Population grows exponentially over time')
      );
      expect(behaviorMessage).toBeDefined();
      expect(behaviorMessage.role).toBe('user');
    });

    it('should include feedback prompt when feedbackContent is provided and lastModel has variables', () => {
      const feedbackData = [
        {
          loop: 'Population Growth Loop',
          polarity: 'reinforcing',
          variables: ['Population', 'Births']
        }
      ];

      const brainWithFeedback = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: feedbackData
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithFeedback.setupLLMParameters('Test prompt', lastModel);

      const feedbackMessage = result.messages.find(m =>
        m.content.includes('Population Growth Loop')
      );
      expect(feedbackMessage).toBeDefined();
      expect(feedbackMessage.role).toBe('user');
    });

    it('should include behavior prompt even without lastModel when behaviorContent is provided', () => {
      const brainWithBehavior = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        behaviorContent: 'System oscillates over time'
      });

      const result = brainWithBehavior.setupLLMParameters('Test prompt');

      const behaviorMessage = result.messages.find(m =>
        m.content.includes('System oscillates over time')
      );
      expect(behaviorMessage).toBeDefined();
      expect(behaviorMessage.role).toBe('user');
    });

    it('should not include lastModel when it has no variables', () => {
      const lastModel = {
        variables: []
      };

      const result = brain.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
    });

    it('should handle custom prompts', () => {
      const brainWithCustomPrompts = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        systemPrompt: 'Custom system prompt for end users',
        structurePrompt: 'Custom structure explanation',
        behaviorPrompt: 'Custom behavior: {behaviorContent}',
        feedbackPrompt: 'Custom feedback: {feedbackContent}',
        behaviorContent: 'Custom behavior data',
        feedbackContent: { loops: ['test loop'] }
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };
      const result = brainWithCustomPrompts.setupLLMParameters('Test prompt', lastModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toBe('Custom system prompt for end users');

      const structurePromptMessage = result.messages.find(m =>
        m.content === 'Custom structure explanation'
      );
      expect(structurePromptMessage).toBeDefined();

      const behaviorMessage = result.messages.find(m =>
        m.content.includes('Custom behavior: Custom behavior data')
      );
      expect(behaviorMessage).toBeDefined();

      const feedbackMessage = result.messages.find(m =>
        m.content.includes('Custom feedback:')
      );
      expect(feedbackMessage).toBeDefined();
    });

    it('should properly order messages in the conversation', () => {
      const brainWithAll = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background info about the system',
        problemStatement: 'Understanding system behavior',
        behaviorContent: 'System shows growth pattern',
        feedbackContent: [{ loop: 'growth loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };
      const result = brainWithAll.setupLLMParameters('User question', lastModel);

      expect(result.messages[0].role).toBe('system');

      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('Background info about the system');

      expect(result.messages[2].role).toBe('system');
      expect(result.messages[2].content).toContain('Understanding system behavior');

      expect(result.messages[3].role).toBe('assistant');
      expect(result.messages[3].content).toContain('Test');

      expect(result.messages[4].role).toBe('user'); // structure prompt
      expect(result.messages[5].role).toBe('user'); // behavior prompt
      expect(result.messages[6].role).toBe('user'); // feedback prompt
      expect(result.messages[7].content).toBe('User question');
    });

    it('should handle edge case with null lastModel', () => {
      const result = brain.setupLLMParameters('Test prompt', null);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
      expect(result.messages[result.messages.length - 1].content).toBe('Test prompt');
    });

    it('should handle edge case with undefined lastModel', () => {
      const result = brain.setupLLMParameters('Test prompt', undefined);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
      expect(result.messages[result.messages.length - 1].content).toBe('Test prompt');
    });

    it('should return all required parameters for LLM API call', () => {
      const result = brain.setupLLMParameters('Test prompt');

      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('reasoningEffort');
      expect(result).toHaveProperty('responseFormat');

      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.model).toBe('string');
    });

    it('should handle lastModel with variables but no structure prompt', () => {
      const brainNoStructure = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        structurePrompt: null,
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = brainNoStructure.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();

      const structureMessage = result.messages.find(m =>
        m.role === 'user' && m.content.includes('consider the model')
      );
      expect(structureMessage).toBeUndefined();
    });

    it('should include feedback prompt but not behavior prompt when only feedbackContent is provided', () => {
      const brainWithFeedbackOnly = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
        // No behaviorContent provided
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = brainWithFeedbackOnly.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m =>
        m.content.includes('behavior of the model')
      );
      expect(behaviorMessage).toBeUndefined();

      const feedbackMessage = result.messages.find(m =>
        m.content.includes('feedback loops')
      );
      expect(feedbackMessage).toBeDefined();
    });

    it('should not include feedback prompt when feedbackContent is invalid', () => {
      const brainWithInvalidFeedback = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: null // Invalid feedback content
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainWithInvalidFeedback.setupLLMParameters('Test prompt', lastModel);

      const feedbackMessage = result.messages.find(m =>
        m.role === 'user' && m.content.includes('feedback loops in the model')
      );
      expect(feedbackMessage).toBeUndefined();
    });

    it('should not include behavior prompt when behaviorContent is missing', () => {
      const brainNoBehavior = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
        // behaviorContent not provided
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainNoBehavior.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m =>
        m.content.includes('behavior of the model')
      );
      expect(behaviorMessage).toBeUndefined();
    });

    it('should handle empty string behaviorContent', () => {
      const brainEmptyBehavior = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        behaviorContent: '' // Empty string
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainEmptyBehavior.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m =>
        m.content.includes('behavior of the model')
      );
      expect(behaviorMessage).toBeUndefined();
    });

    it('should maintain user prompt as final message regardless of other content', () => {
      const brainWithEverything = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background',
        problemStatement: 'Problem',
        behaviorContent: 'Behavior',
        feedbackContent: [{ loop: 'loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const userPrompt = 'Why is this happening?';
      const result = brainWithEverything.setupLLMParameters(userPrompt, lastModel);

      expect(result.messages[result.messages.length - 1].content).toBe(userPrompt);
      expect(result.messages[result.messages.length - 1].role).toBe('user');
    });

    it('should include current run name in separate message when provided', () => {
      const brainWithRunName = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'Test Loop', polarity: 'reinforcing' }],
        currentRunName: 'Baseline Scenario'
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainWithRunName.setupLLMParameters('Test prompt', lastModel);

      const runNameMessage = result.messages.find(m =>
        m.role === 'user' && m.content.includes('Baseline Scenario')
      );
      expect(runNameMessage).toBeDefined();
      expect(runNameMessage.content).toContain('simulation run');
      expect(runNameMessage.content).toContain('Baseline Scenario');
    });

    it('should not include run name message when currentRunName is not provided', () => {
      const brainWithoutRunName = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'Test Loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainWithoutRunName.setupLLMParameters('Test prompt', lastModel);

      const runNameMessage = result.messages.find(m =>
        m.role === 'user' && m.content.includes('simulation run the user is working with is called')
      );
      expect(runNameMessage).toBeUndefined();
    });

    it('should not include run name message when currentRunName is empty string', () => {
      const brainWithEmptyRunName = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'Test Loop', polarity: 'reinforcing' }],
        currentRunName: ''
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainWithEmptyRunName.setupLLMParameters('Test prompt', lastModel);

      const runNameMessage = result.messages.find(m =>
        m.role === 'user' && m.content.includes('simulation run the user is working with is called')
      );
      expect(runNameMessage).toBeUndefined();
    });

    it('should place run name message before feedback message', () => {
      const brainWithRunName = new SeldonILEUserBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'Test Loop', polarity: 'reinforcing' }],
        currentRunName: 'High Growth Scenario'
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };

      const result = brainWithRunName.setupLLMParameters('Test prompt', lastModel);

      const runNameIndex = result.messages.findIndex(m =>
        m.role === 'user' && m.content.includes('High Growth Scenario')
      );
      const feedbackIndex = result.messages.findIndex(m =>
        m.role === 'user' && m.content.includes('feedback loops in the model')
      );

      expect(runNameIndex).toBeGreaterThan(-1);
      expect(feedbackIndex).toBeGreaterThan(-1);
      expect(runNameIndex).toBeLessThan(feedbackIndex);
    });
  });
});
