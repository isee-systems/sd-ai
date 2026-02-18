import LTMNarrativeBrain from '../../../engines/ltm-narrative/LTMNarrativeBrain.js';
import { LLMWrapper } from '../../../utilities/LLMWrapper.js';

describe('LTMNarrativeBrain', () => {
  let ltmBrain;

  beforeEach(() => {
    ltmBrain = new LTMNarrativeBrain({
      openAIKey: 'test-key',
      anthropicKey: 'test-claude-key',
      googleKey: 'test-google-key'
    });
  });

  describe('setupLLMParameters', () => {
    it('should throw error when feedbackContent is not provided', () => {
      expect(() => {
        ltmBrain.setupLLMParameters('Test prompt', null);
      }).toThrow('Without active Loops that Matter Information I am unable to provide a feedback based explanation of behavior. Please turn LTM on and rerun the model.');
    });

    it('should throw error when feedbackContent is invalid', () => {
      const brainWithInvalidFeedback = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: { valid: false }
      });
      
      expect(() => {
        brainWithInvalidFeedback.setupLLMParameters('Test prompt', null);
      }).toThrow('Without active Loops that Matter Information I am unable to provide a feedback based explanation of behavior. Please turn LTM on and rerun the model.');
    });


    it('should throw error when feedbackContent is empty', () => {
      const brainWithEmptyFeedback = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: []
      });
      
      expect(() => {
        brainWithEmptyFeedback.setupLLMParameters('Test prompt', null);
      }).toThrow('Without active Loops that Matter Information I am unable to provide a feedback based explanation of behavior. Please turn LTM on and rerun the model.');
    });

    it('should setup basic LLM parameters with default model', () => {
      const brainWithFeedback = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithFeedback.setupLLMParameters('Test prompt', null);

      // Parse the default model to extract base model and reasoning effort
      const parts = LLMWrapper.NON_BUILD_DEFAULT_MODEL.split(' ');
      const expectedModel = parts[0];
      const expectedReasoningEffort = parts.length > 1 ? parts[1] : undefined;

      expect(result.model).toBe(expectedModel);
      expect(result.temperature).toBe(0);
      expect(result.reasoningEffort).toBe(expectedReasoningEffort);
      expect(result.messages).toBeInstanceOf(Array);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[result.messages.length - 1].content).toBe('Test prompt');
    });

    it('should handle o3-mini model with reasoning effort', () => {
      const brainWithO3Mini = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3-mini high',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithO3Mini.setupLLMParameters('Test prompt', null);

      expect(result.model).toBe('o3-mini');
      expect(result.reasoningEffort).toBe('high');
    });

    it('should handle o3 model with reasoning effort', () => {
      const brainWithO3 = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3 low',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithO3.setupLLMParameters('Test prompt', null);

      expect(result.model).toBe('o3');
      expect(result.reasoningEffort).toBe('low');
    });

    it('should set system role to user and temperature to 1 when model lacks system mode', () => {
      const brainWithoutSystemMode = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'llama',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithoutSystemMode.setupLLMParameters('Test prompt', null);

      expect(result.messages[0].role).toBe('system');
      expect(result.temperature).toBe(0);
    });

    it('should set temperature to undefined when model lacks temperature support', () => {
      const brainWithO3 = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithO3.setupLLMParameters('Test prompt', null);

      expect(result.temperature).toBeUndefined();
    });

    it('should include background knowledge in messages when provided', () => {
      const brainWithBackground = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Important context information',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithBackground.setupLLMParameters('Test prompt', null);

      const backgroundMessage = result.messages.find(m => m.content.includes('Important context information'));
      expect(backgroundMessage).toBeDefined();
      expect(backgroundMessage.role).toBe('user');
    });

    it('should include problem statement in messages when provided', () => {
      const brainWithProblem = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        problemStatement: 'Analyze system behavior',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithProblem.setupLLMParameters('Test prompt', null);

      const problemMessage = result.messages.find(m => m.content.includes('Analyze system behavior'));
      expect(problemMessage).toBeDefined();
    });

    it('should include feedback content in messages', () => {
      const brainWithFeedback = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithFeedback.setupLLMParameters('Test prompt', null);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toContain('test loop');
      
      const feedbackPromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('dominant feedback')
      );
      expect(feedbackPromptMessage).toBeDefined();
    });

    it('should include behavior prompt when behaviorContent is provided', () => {
      const brainWithBehavior = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        behaviorContent: 'Population grows exponentially',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithBehavior.setupLLMParameters('Test prompt', null);

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Population grows exponentially')
      );
      expect(behaviorMessage).toBeDefined();
      expect(behaviorMessage.role).toBe('user');
    });

    it('should include feedback prompt', () => {
      const feedbackData = {
        valid: true,
        loops: [{ loop: 'Population Growth Loop', polarity: 'reinforcing' }]
      };
      
      const brainWithFeedback = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: feedbackData
      });

      const result = brainWithFeedback.setupLLMParameters('Test prompt', null);

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
      const brainWithCustomPrompts = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        systemPrompt: 'Custom system prompt for analysis',
        behaviorPrompt: 'Custom behavior: {behaviorContent}',
        feedbackPrompt: 'Custom feedback prompt',
        backgroundPrompt: 'Custom background: {backgroundKnowledge}',
        problemStatementPrompt: 'Custom problem: {problemStatement}',
        behaviorContent: 'Custom behavior data',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop' }] },
        backgroundKnowledge: 'Custom background data',
        problemStatement: 'Custom problem data'
      });

      const result = brainWithCustomPrompts.setupLLMParameters('Test prompt', null);

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
      const brainWithAll = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background info',
        problemStatement: 'Problem to solve',
        behaviorContent: 'Behavior data',
        feedbackContent: { valid: true, loops: [{ feedback: 'loops' }] }
      });

      const result = brainWithAll.setupLLMParameters('User prompt', null);

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('Background info');
      expect(result.messages[2].role).toBe('system');
      expect(result.messages[2].content).toContain('Problem to solve');
      expect(result.messages[3].role).toBe('assistant'); // feedback content
      expect(result.messages[4].role).toBe('user'); // feedback prompt
      expect(result.messages[5].role).toBe('user'); // behavior prompt
      expect(result.messages[6].content).toBe('User prompt');
    });

    it('should return all required parameters for OpenAI API call', () => {
      const brainWithFeedback = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithFeedback.setupLLMParameters('Test prompt', null);

      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('reasoningEffort');
      expect(result).toHaveProperty('responseFormat');

      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.model).toBe('string');
    });

    it('should not include behavior prompt when behaviorContent is not provided', () => {
      const brainWithoutBehavior = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        behaviorPrompt: 'Behavior: {behaviorContent}',
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainWithoutBehavior.setupLLMParameters('Test prompt', null);

      const behaviorMessage = result.messages.find(m => 
        m.content.includes('Behavior:')
      );
      expect(behaviorMessage).toBeUndefined();
    });

    it('should handle feedbackPrompt being null', () => {
      const brainNoFeedbackPrompt = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        feedbackPrompt: null,
        feedbackContent: { valid: true, loops: [{ loop: 'test loop', polarity: 'reinforcing' }] }
      });

      const result = brainNoFeedbackPrompt.setupLLMParameters('Test prompt', null);

      const feedbackPromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('dominant feedback')
      );
      expect(feedbackPromptMessage).toBeUndefined();
    });

  });

  describe('processFeedbackContent', () => {
    it('should return unchanged feedbackJSON when feedbackLoops is not an array', () => {
      const feedbackJSON = { feedbackLoops: 'not an array' };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result).toEqual(feedbackJSON);
    });

    it('should return unchanged feedbackJSON when feedbackJSON is null', () => {
      const result = ltmBrain.processFeedbackContent(null);
      expect(result).toBeNull();
    });

    it('should delete name when loop name starts with B followed by a number', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'B1 Loop' },
          { identifier: 'loop2', name: 'B2 Balance' },
          { identifier: 'loop3', name: 'B99 Test' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBeUndefined();
      expect(result.feedbackLoops[1].name).toBeUndefined();
      expect(result.feedbackLoops[2].name).toBeUndefined();
    });

    it('should delete name when loop name starts with Bu followed by a number', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'Bu1 Loop' },
          { identifier: 'loop2', name: 'Bu5 Building' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBeUndefined();
      expect(result.feedbackLoops[1].name).toBeUndefined();
    });

    it('should delete name when loop name starts with R followed by a number', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'R1 Loop' },
          { identifier: 'loop2', name: 'R2 Reinforcing' },
          { identifier: 'loop3', name: 'R99 Test' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBeUndefined();
      expect(result.feedbackLoops[1].name).toBeUndefined();
      expect(result.feedbackLoops[2].name).toBeUndefined();
    });

    it('should delete name when loop name starts with Ru followed by a number', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'Ru1 Loop' },
          { identifier: 'loop2', name: 'Ru7 Running' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBeUndefined();
      expect(result.feedbackLoops[1].name).toBeUndefined();
    });

    it('should delete name when loop name starts with U followed by a number', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'U1 Loop' },
          { identifier: 'loop2', name: 'U3 Usage' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBeUndefined();
      expect(result.feedbackLoops[1].name).toBeUndefined();
    });

    it('should NOT delete name when pattern matches but no number follows', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'Balance Loop' },
          { identifier: 'loop2', name: 'Building Loop' },
          { identifier: 'loop3', name: 'Revenue Growth' },
          { identifier: 'loop4', name: 'Running Loop' },
          { identifier: 'loop5', name: 'Usage Loop' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBe('Balance Loop');
      expect(result.feedbackLoops[1].name).toBe('Building Loop');
      expect(result.feedbackLoops[2].name).toBe('Revenue Growth');
      expect(result.feedbackLoops[3].name).toBe('Running Loop');
      expect(result.feedbackLoops[4].name).toBe('Usage Loop');
    });

    it('should NOT delete name when it does not match any patterns', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'Growth Loop' },
          { identifier: 'loop2', name: 'Quality Loop' },
          { identifier: 'loop3', name: 'Price Adjustment' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBe('Growth Loop');
      expect(result.feedbackLoops[1].name).toBe('Quality Loop');
      expect(result.feedbackLoops[2].name).toBe('Price Adjustment');
    });

    it('should not delete name when identifier is missing', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { name: 'B1 Loop' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBe('B1 Loop');
    });

    it('should handle mixed cases correctly', () => {
      const feedbackJSON = {
        feedbackLoops: [
          { identifier: 'loop1', name: 'B1 Loop' },
          { identifier: 'loop2', name: 'Revenue Growth' },
          { identifier: 'loop3', name: 'R5 Loop' },
          { name: 'Bu1 Loop' },
          { identifier: 'loop5', name: 'Quality Improvement' },
          { identifier: 'loop6', name: 'U2 Test' },
          { identifier: 'loop7', name: 'Ru3 Running' }
        ]
      };
      const result = ltmBrain.processFeedbackContent(feedbackJSON);
      expect(result.feedbackLoops[0].name).toBeUndefined();
      expect(result.feedbackLoops[1].name).toBe('Revenue Growth');
      expect(result.feedbackLoops[2].name).toBeUndefined();
      expect(result.feedbackLoops[3].name).toBe('Bu1 Loop');
      expect(result.feedbackLoops[4].name).toBe('Quality Improvement');
      expect(result.feedbackLoops[5].name).toBeUndefined();
      expect(result.feedbackLoops[6].name).toBeUndefined();
    });
  });

  describe('integration tests', () => {
    it('should validate all required setup parameters are provided', () => {
      expect(() => {
        new LTMNarrativeBrain({
          openAIKey: 'test-key',
          googleKey: 'test-google-key',
          anthropicKey: 'test-claude-key'
        });
      }).not.toThrow();
    });

    it('should handle constructor parameter validation', () => {
      const brain = new LTMNarrativeBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        problemStatementPrompt: 'Custom prompt',
        backgroundPrompt: 'Custom background'
      });

      expect(brain).toBeDefined();
    });
  });
});