import SeldonEngineBrain from '../../../engines/seldon/SeldonBrain.js';
import { LLMWrapper } from '../../../utilities/LLMWrapper.js';

describe('SeldonEngineBrain', () => {
  let seldonEngine;

  beforeEach(() => {
    seldonEngine = new SeldonEngineBrain({
      openAIKey: 'test-key',
      googleKey: 'test-google-key'
    });
  });

  describe('setupLLMParameters', () => {
    it('should setup basic LLM parameters with default model', () => {
      const userPrompt = 'Test prompt';
      const result = seldonEngine.setupLLMParameters(userPrompt);

      expect(result.model).toBe(LLMWrapper.NON_BUILD_DEFAULT_MODEL);
      expect(result.temperature).toBe(0);
      expect(result.reasoningEffort).toBeUndefined();
      expect(result.messages).toBeInstanceOf(Array);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[result.messages.length - 1].content).toBe(userPrompt);
    });

    it('should handle o3-mini model with reasoning effort', () => {
      const engineWithO3Mini = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3-mini high'
      });

      const result = engineWithO3Mini.setupLLMParameters('Test prompt');

      expect(result.model).toBe('o3-mini');
      expect(result.reasoningEffort).toBe('high');
    });

    it('should handle o3 model with reasoning effort', () => {
      const engineWithO3 = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3 low'
      });

      const result = engineWithO3.setupLLMParameters('Test prompt');

      expect(result.model).toBe('o3');
      expect(result.reasoningEffort).toBe('low');
    });

    it('should set system role to user and temperature to 1 when model lacks system mode', () => {
      const engineWithoutSystemMode = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'llama'
      });

      const result = engineWithoutSystemMode.setupLLMParameters('Test prompt');

      expect(result.messages[0].role).toBe('system');
      expect(result.temperature).toBe(0);
    });

    it('should set temperature to undefined when model lacks temperature support', () => {
      const engineWithO3 = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3'  // o3 model doesn't support temperature
      });

      const result = engineWithO3.setupLLMParameters('Test prompt');

      expect(result.temperature).toBeUndefined();
    });

    it('should include background knowledge in messages when provided', () => {
      const engineWithBackground = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Important context information'
      });

      const result = engineWithBackground.setupLLMParameters('Test prompt');

      const backgroundMessage = result.messages.find(m => m.content.includes('Important context information'));
      expect(backgroundMessage).toBeDefined();
      expect(backgroundMessage.role).toBe('user');
    });

    it('should include problem statement in messages when provided', () => {
      const engineWithProblem = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        problemStatement: 'Analyze system behavior'
      });

      const result = engineWithProblem.setupLLMParameters('Test prompt');

      const problemMessage = result.messages.find(m => m.content.includes('Analyze system behavior'));
      expect(problemMessage).toBeDefined();
    });

    it('should include lastModel and structure prompt when lastModel has variables', () => {
      const engineWithFeedback = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const lastModel = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000' }
        ],
        relationships: [
          { from: 'A', to: 'B', polarity: '+' }
        ]
      };

      const result = engineWithFeedback.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toContain('Population');
      
      const structurePromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('consider the model which you have already')
      );
      expect(structurePromptMessage).toBeDefined();
    });

    it('should include behavior prompt when behaviorContent is provided and lastModel has variables', () => {
      const engineWithBehavior = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        behaviorContent: 'Population grows exponentially',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = engineWithBehavior.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Population grows exponentially')
      );
      expect(behaviorMessage).toBeDefined();
      expect(behaviorMessage.role).toBe('user');
    });

    it('should include feedback prompt when feedbackContent is provided and lastModel has variables', () => {
      const feedbackData = [
        { loop: 'Population Growth Loop', polarity: 'reinforcing' }
      ];
      
      const engineWithFeedback = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        feedbackContent: feedbackData
      });

      const lastModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = engineWithFeedback.setupLLMParameters('Test prompt', lastModel);

      const feedbackMessage = result.messages.find(m => 
        m.content.includes('Population Growth Loop')
      );
      expect(feedbackMessage).toBeDefined();
      expect(feedbackMessage.role).toBe('user');
    });

    it('should include behavior prompt even without lastModel when behaviorContent is provided', () => {
      const engineWithBehavior = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        behaviorContent: 'System oscillates over time'
      });

      const result = engineWithBehavior.setupLLMParameters('Test prompt');

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

      const result = seldonEngine.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
    });

    it('should handle custom prompts', () => {
      const engineWithCustomPrompts = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        systemPrompt: 'Custom system prompt for analysis',
        structurePrompt: 'Custom structure prompt',
        behaviorPrompt: 'Custom behavior: {behaviorContent}',
        feedbackPrompt: 'Custom feedback: {feedbackContent}',
        behaviorContent: 'Custom behavior data',
        feedbackContent: { loops: ['test loop'] }
      });

      const lastModel = { 
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };
      const result = engineWithCustomPrompts.setupLLMParameters('Test prompt', lastModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toBe('Custom system prompt for analysis');

      const structurePromptMessage = result.messages.find(m => 
        m.content === 'Custom structure prompt'
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
      const engineWithAll = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background info',
        problemStatement: 'Problem to solve',
        behaviorContent: 'Behavior data',
        feedbackContent: { feedback: 'loops' }
      });

      const lastModel = { 
        variables: [{ name: 'Test', type: 'variable', equation: '10' }]
      };
      const result = engineWithAll.setupLLMParameters('User prompt', lastModel);

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('Background info');
      expect(result.messages[2].role).toBe('system');
      expect(result.messages[2].content).toContain('Problem to solve');
      expect(result.messages[3].role).toBe('assistant');
      expect(result.messages[4].role).toBe('user'); // structure prompt
      expect(result.messages[5].role).toBe('user'); // behavior prompt
      expect(result.messages[6].role).toBe('user'); // feedback prompt
      expect(result.messages[7].content).toBe('User prompt');
    });

    it('should handle edge case with null lastModel', () => {
      const result = seldonEngine.setupLLMParameters('Test prompt', null);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
      expect(result.messages[result.messages.length - 1].content).toBe('Test prompt');
    });

    it('should handle edge case with undefined lastModel', () => {
      const result = seldonEngine.setupLLMParameters('Test prompt', undefined);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
      expect(result.messages[result.messages.length - 1].content).toBe('Test prompt');
    });

    it('should return all required parameters for OpenAI API call', () => {
      const result = seldonEngine.setupLLMParameters('Test prompt');

      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('reasoningEffort');

      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.model).toBe('string');
    });

    it('should handle lastModel with variables but no structure prompt', () => {
      const engineNoStructure = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        structurePrompt: null,
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = engineNoStructure.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();

      const structureMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('consider the model')
      );
      expect(structureMessage).toBeUndefined();
    });

    it('should include feedback prompt but not behavior prompt when only feedbackContent is provided', () => {
      const engineWithPrompts = new SeldonEngineBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        behaviorPrompt: 'Behavior: {behaviorContent}',
        feedbackPrompt: 'Feedback: {feedbackContent}',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
        // No behaviorContent provided
      });

      const lastModel = {
        variables: [{ name: 'Test', type: 'variable' }]
      };

      const result = engineWithPrompts.setupLLMParameters('Test prompt', lastModel);

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Behavior:')
      );
      expect(behaviorMessage).toBeUndefined();

      const feedbackMessage = result.messages.find(m => 
        m.content.includes('Feedback:')
      );
      expect(feedbackMessage).toBeDefined();
    });
  });
});