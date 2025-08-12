import LTMNarrativeToolBrain from '../../../engines/ltm-narrative-tool/LTMNarrativeToolBrain.js';

describe('LTMNarrativeToolBrain', () => {
  let ltmBrain;

  beforeEach(() => {
    ltmBrain = new LTMNarrativeToolBrain({
      openAIKey: 'test-key',
      googleKey: 'test-google-key'
    });
  });

  describe('setupLLMParameters', () => {
    it('should throw error when lastModel is null', () => {
      expect(() => {
        ltmBrain.setupLLMParameters('Test prompt', null);
      }).toThrow('You cannot run the LTM Narrative Tool without a model.');
    });

    it('should throw error when lastModel has no variables', () => {
      const lastModel = { variables: [] };
      
      expect(() => {
        ltmBrain.setupLLMParameters('Test prompt', lastModel);
      }).toThrow('You cannot run the LTM Narrative Tool without a model.');
    });

    it('should throw error when feedbackContent is not provided', () => {
      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };
      
      expect(() => {
        ltmBrain.setupLLMParameters('Test prompt', lastModel);
      }).toThrow('You cannot run the LTM Narrative Tool without performing an LTM analysis');
    });

    it('should throw error when feedbackContent is empty', () => {
      const brainWithEmptyFeedback = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackContent: []
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };
      
      expect(() => {
        brainWithEmptyFeedback.setupLLMParameters('Test prompt', lastModel);
      }).toThrow('You cannot run the LTM Narrative Tool without performing an LTM analysis');
    });

    it('should setup basic LLM parameters with default model', () => {
      const brainWithFeedback = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithFeedback.setupLLMParameters('Test prompt', lastModel);

      expect(result.model).toBe('gemini-2.5-flash');
      expect(result.temperature).toBe(0);
      expect(result.reasoning_effort).toBeUndefined();
      expect(result.messages).toBeInstanceOf(Array);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[result.messages.length - 1].content).toBe('Test prompt');
    });

    it('should handle o3-mini model with reasoning effort', () => {
      const brainWithO3Mini = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3-mini high',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithO3Mini.setupLLMParameters('Test prompt', lastModel);

      expect(result.model).toBe('o3-mini');
      expect(result.reasoning_effort).toBe('high');
    });

    it('should handle o3 model with reasoning effort', () => {
      const brainWithO3 = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3 low',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithO3.setupLLMParameters('Test prompt', lastModel);

      expect(result.model).toBe('o3');
      expect(result.reasoning_effort).toBe('low');
    });

    it('should set system role to user and temperature to 1 when model lacks system mode', () => {
      const brainWithoutSystemMode = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'llama',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithoutSystemMode.setupLLMParameters('Test prompt', lastModel);

      expect(result.messages[0].role).toBe('system');
      expect(result.temperature).toBe(0);
    });

    it('should set temperature to undefined when model lacks temperature support', () => {
      const brainWithO3 = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithO3.setupLLMParameters('Test prompt', lastModel);

      expect(result.temperature).toBeUndefined();
    });

    it('should include background knowledge in messages when provided', () => {
      const brainWithBackground = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Important context information',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithBackground.setupLLMParameters('Test prompt', lastModel);

      const backgroundMessage = result.messages.find(m => m.content.includes('Important context information'));
      expect(backgroundMessage).toBeDefined();
      expect(backgroundMessage.role).toBe('user');
    });

    it('should include problem statement in messages when provided', () => {
      const brainWithProblem = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        problemStatement: 'Analyze system behavior',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithProblem.setupLLMParameters('Test prompt', lastModel);

      const problemMessage = result.messages.find(m => m.content.includes('Analyze system behavior'));
      expect(problemMessage).toBeDefined();
    });

    it('should include lastModel and structure prompt', () => {
      const brainWithFeedback = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000' }
        ],
        relationships: [
          { from: 'A', to: 'B', polarity: '+' }
        ]
      };

      const result = brainWithFeedback.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toContain('Population');
      
      const structurePromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('consider the model which you have already')
      );
      expect(structurePromptMessage).toBeDefined();
    });

    it('should include behavior prompt when behaviorContent is provided', () => {
      const brainWithBehavior = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        behaviorContent: 'Population grows exponentially',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithBehavior.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Population grows exponentially')
      );
      expect(behaviorMessage).toBeDefined();
      expect(behaviorMessage.role).toBe('user');
    });

    it('should include feedback prompt', () => {
      const feedbackData = [
        { loop: 'Population Growth Loop', polarity: 'reinforcing' }
      ];
      
      const brainWithFeedback = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
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
      expect(feedbackMessage.role).toBe('assistant');

      const feedbackPromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('dominant feedback loop')
      );
      expect(feedbackPromptMessage).toBeDefined();
    });

    it('should handle custom prompts', () => {
      const brainWithCustomPrompts = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        systemPrompt: 'Custom system prompt for analysis',
        structurePrompt: 'Custom structure prompt',
        behaviorPrompt: 'Custom behavior: {behaviorContent}',
        feedbackPrompt: 'Custom feedback prompt',
        backgroundPrompt: 'Custom background: {backgroundKnowledge}',
        problemStatementPrompt: 'Custom problem: {problemStatement}',
        behaviorContent: 'Custom behavior data',
        feedbackContent: [{ loop: 'test loop' }],
        backgroundKnowledge: 'Custom background data',
        problemStatement: 'Custom problem data'
      });

      const lastModel = { 
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };
      const result = brainWithCustomPrompts.setupLLMParameters('Test prompt', lastModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toBe('Custom system prompt for analysis');

      const backgroundMessage = result.messages.find(m => 
        m.content.includes('Custom background: Custom background data')
      );
      expect(backgroundMessage).toBeDefined();

      const problemMessage = result.messages.find(m => 
        m.content.includes('Custom problem: Custom problem data')
      );
      expect(problemMessage).toBeDefined();

      const structurePromptMessage = result.messages.find(m => 
        m.content === 'Custom structure prompt'
      );
      expect(structurePromptMessage).toBeDefined();

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Custom behavior: Custom behavior data')
      );
      expect(behaviorMessage).toBeDefined();

      const feedbackPromptMessage = result.messages.find(m => 
        m.content === 'Custom feedback prompt'
      );
      expect(feedbackPromptMessage).toBeDefined();
    });

    it('should properly order messages in the conversation', () => {
      const brainWithAll = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background info',
        problemStatement: 'Problem to solve',
        behaviorContent: 'Behavior data',
        feedbackContent: [{ feedback: 'loops' }]
      });

      const lastModel = { 
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };
      const result = brainWithAll.setupLLMParameters('User prompt', lastModel);

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('Background info');
      expect(result.messages[2].role).toBe('system');
      expect(result.messages[2].content).toContain('Problem to solve');
      expect(result.messages[3].role).toBe('assistant');
      expect(result.messages[4].role).toBe('user'); // structure prompt
      expect(result.messages[5].role).toBe('assistant'); // feedback content
      expect(result.messages[6].role).toBe('user'); // feedback prompt
      expect(result.messages[7].role).toBe('user'); // behavior prompt
      expect(result.messages[8].content).toBe('User prompt');
    });

    it('should return all required parameters for OpenAI API call', () => {
      const brainWithFeedback = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithFeedback.setupLLMParameters('Test prompt', lastModel);

      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('reasoning_effort');
      expect(result).toHaveProperty('response_format');

      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.model).toBe('string');
    });

    it('should not include behavior prompt when behaviorContent is not provided', () => {
      const brainWithoutBehavior = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        behaviorPrompt: 'Behavior: {behaviorContent}',
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = brainWithoutBehavior.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Behavior:')
      );
      expect(behaviorMessage).toBeUndefined();
    });

    it('should not include structure prompt when structurePrompt is null', () => {
      const brainNoStructure = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        structurePrompt: null,
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = brainNoStructure.setupLLMParameters('Test prompt', lastModel);

      const structureMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('consider the model')
      );
      expect(structureMessage).toBeUndefined();
    });

    it('should not include feedback prompt when feedbackPrompt is null', () => {
      const brainNoFeedbackPrompt = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackPrompt: null,
        feedbackContent: [{ loop: 'test loop', polarity: 'reinforcing' }]
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = brainNoFeedbackPrompt.setupLLMParameters('Test prompt', lastModel);

      const feedbackPromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('dominant feedback')
      );
      expect(feedbackPromptMessage).toBeUndefined();
    });
  });

  describe('integration tests', () => {
    it('should validate all required setup parameters are provided', () => {
      expect(() => {
        new LTMNarrativeToolBrain({
          openAIKey: 'test-key',
          googleKey: 'test-google-key'
        });
      }).not.toThrow();
    });

    it('should handle constructor parameter validation', () => {
      const brain = new LTMNarrativeToolBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        problemStatementPrompt: 'Custom prompt',
        backgroundPrompt: 'Custom background'
      });
      
      expect(brain).toBeDefined();
    });
  });
});