import QualitativeEngineBrain from '../../../engines/qualitative/QualitativeEngineBrain.js';
import { LLMWrapper } from '../../../utilities/LLMWrapper.js';

describe('QualitativeEngineBrain', () => {
  let qualitativeEngine;

  beforeEach(() => {
    qualitativeEngine = new QualitativeEngineBrain({
      openAIKey: 'test-key',
      anthropicKey: 'test-claude-key',
      googleKey: 'test-google-key'
    });
  });

  describe('processResponse', () => {
    it('should trim from and to variables and mark valid relationships', () => {
      const originalResponse = {
        relationships: [
          {
            from: '  Death rate  ',
            to: '  population  ',
            polarity: '+',
            reasoning: 'Higher death rate reduces population',
            polarityReasoning: 'Direct negative correlation'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe('Death rate');
      expect(result.relationships[0].to).toBe('population');
      expect(result.relationships[0].valid).toBeUndefined();
    });

    it('should mark self-referencing relationships as invalid and filter them out', () => {
      const originalResponse = {
        relationships: [
          {
            from: 'population',
            to: 'population',
            polarity: '+',
            reasoning: 'Self reference',
            polarityReasoning: 'Same variable'
          },
          {
            from: 'Death rate',
            to: 'population',
            polarity: '+',
            reasoning: 'Valid relationship',
            polarityReasoning: 'Different variables'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe('Death rate');
      expect(result.relationships[0].to).toBe('population');
    });

    it('should remove duplicate relationships keeping the first occurrence', () => {
      const originalResponse = {
        relationships: [
          {
            from: 'Death rate',
            to: 'population',
            polarity: '+',
            reasoning: 'First occurrence',
            polarityReasoning: 'First reasoning'
          },
          {
            from: 'Birth rate',
            to: 'population',
            polarity: '+',
            reasoning: 'Different relationship',
            polarityReasoning: 'Different reasoning'
          },
          {
            from: 'Death rate',
            to: 'population',
            polarity: '-',
            reasoning: 'Duplicate occurrence',
            polarityReasoning: 'Different reasoning'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(2);
      expect(result.relationships[0].from).toBe('Death rate');
      expect(result.relationships[0].to).toBe('population');
      expect(result.relationships[0].reasoning).toBe('First occurrence');
      expect(result.relationships[1].from).toBe('Birth rate');
      expect(result.relationships[1].to).toBe('population');
    });

    it('should handle case-insensitive duplicate detection with trimming', () => {
      const originalResponse = {
        relationships: [
          {
            from: 'Death Rate',
            to: 'Population',
            polarity: '+',
            reasoning: 'First occurrence',
            polarityReasoning: 'First reasoning'
          },
          {
            from: '  death_rate  ',
            to: '  POPULATION  ',
            polarity: '-',
            reasoning: 'Should be filtered out',
            polarityReasoning: 'Duplicate'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe('Death Rate');
      expect(result.relationships[0].to).toBe('Population');
      expect(result.relationships[0].reasoning).toBe('First occurrence');
    });

    it('should handle empty relationships array', () => {
      const originalResponse = {
        relationships: []
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(0);
    });

    it('should handle missing relationships property', () => {
      const originalResponse = {};

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(0);
    });

    it('should preserve all other properties of the original response', () => {
      const originalResponse = {
        explanation: 'Test explanation',
        title: 'Test title',
        relationships: [
          {
            from: 'A',
            to: 'B',
            polarity: '+',
            reasoning: 'Test reasoning',
            polarityReasoning: 'Test polarity reasoning'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.explanation).toBe('Test explanation');
      expect(result.title).toBe('Test title');
      expect(result.relationships).toHaveLength(1);
    });

    it('should remove the valid property from processed relationships', () => {
      const originalResponse = {
        relationships: [
          {
            from: 'A',
            to: 'B',
            polarity: '+',
            reasoning: 'Valid relationship',
            polarityReasoning: 'Test reasoning'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships[0].valid).toBeUndefined();
      expect(result.relationships[0].from).toBe('A');
      expect(result.relationships[0].to).toBe('B');
      expect(result.relationships[0].polarity).toBe('+');
      expect(result.relationships[0].reasoning).toBe('Valid relationship');
      expect(result.relationships[0].polarityReasoning).toBe('Test reasoning');
    });

    it('should handle complex scenario with multiple duplicates and invalid relationships', () => {
      const originalResponse = {
        relationships: [
          {
            from: 'A',
            to: 'A',  // Invalid self-reference
            polarity: '+',
            reasoning: 'Self reference',
            polarityReasoning: 'Invalid'
          },
          {
            from: '  Schedule Pressure  ',
            to: '  overtime  ',
            polarity: '+',
            reasoning: 'Pressure causes overtime',
            polarityReasoning: 'Positive correlation'
          },
          {
            from: 'schedule_pressure',  // Duplicate of above (case insensitive)
            to: 'OVERTIME',
            polarity: '-',
            reasoning: 'Should be filtered',
            polarityReasoning: 'Duplicate'
          },
          {
            from: 'overtime',
            to: 'fatigue',
            polarity: '+',
            reasoning: 'Overtime causes fatigue',
            polarityReasoning: 'Direct relationship'
          }
        ]
      };

      const result = qualitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(2);
      expect(result.relationships[0].from).toBe('Schedule Pressure');
      expect(result.relationships[0].to).toBe('overtime');
      expect(result.relationships[1].from).toBe('overtime');
      expect(result.relationships[1].to).toBe('fatigue');
    });
  });

  describe('setupLLMParameters', () => {
    it('should setup basic LLM parameters with default model', () => {
      const userPrompt = 'Test prompt';
      const result = qualitativeEngine.setupLLMParameters(userPrompt);

      // Parse the default model to extract base model and reasoning effort
      const parts = LLMWrapper.BUILD_DEFAULT_MODEL.split(' ');
      const expectedModel = parts[0];
      const expectedReasoningEffort = parts.length > 1 ? parts[1] : undefined;

      expect(result.model).toBe(expectedModel);
      expect(result.temperature).toBe(0);
      expect(result.reasoningEffort).toBe(expectedReasoningEffort);
      expect(result.responseFormat).toBeDefined();
      expect(result.messages).toBeInstanceOf(Array);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[result.messages.length - 2].content).toBe(userPrompt);
    });

    it('should handle o3-mini model with reasoning effort', () => {
      const engineWithO3Mini = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3-mini high'
      });

      const result = engineWithO3Mini.setupLLMParameters('Test prompt');

      expect(result.model).toBe('o3-mini');
      expect(result.reasoningEffort).toBe('high');
    });

    it('should handle o3 model with reasoning effort', () => {
      const engineWithO3 = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o3 medium'
      });

      const result = engineWithO3.setupLLMParameters('Test prompt');

      expect(result.model).toBe('o3');
      expect(result.reasoningEffort).toBe('medium');
    });

    it('should add non-structured output prompt addition when model lacks structured output', () => {
      const engineWithoutStructured = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o1-mini'  // o1-mini doesn't support structured output
      });

      const result = engineWithoutStructured.setupLLMParameters('Test prompt');

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toContain('You must respond in a very specific JSON format');
      expect(result.responseFormat).toBeUndefined();
    });

    it('should set system role to user and temperature to 1 when model lacks system mode', () => {
      const engineWithoutSystemMode = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'llama'
      });

      const result = engineWithoutSystemMode.setupLLMParameters('Test prompt');

      expect(result.messages[0].role).toBe('system');
      expect(result.temperature).toBe(0);
    });

    it('should set temperature to undefined when model lacks temperature support', () => {
      const engineWithO1 = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        underlyingModel: 'o1-mini'
      });

      const result = engineWithO1.setupLLMParameters('Test prompt');

      expect(result.temperature).toBeUndefined();
    });

    it('should include background knowledge in messages when provided', () => {
      const engineWithBackground = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Important context information'
      });

      const result = engineWithBackground.setupLLMParameters('Test prompt');

      const backgroundMessage = result.messages.find(m => m.content.includes('Important context information'));
      expect(backgroundMessage).toBeDefined();
      expect(backgroundMessage.role).toBe('user');
    });

    it('should include problem statement in messages when provided', () => {
      const engineWithProblem = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        problemStatement: 'Solve world hunger'
      });

      const result = engineWithProblem.setupLLMParameters('Test prompt');

      const problemMessage = result.messages.find(m => m.content.includes('Solve world hunger'));
      expect(problemMessage).toBeDefined();
    });

    it('should include lastModel and assistant prompt when lastModel has relationships', () => {
      const lastModel = {
        relationships: [
          { from: 'A', to: 'B', polarity: '+' }
        ]
      };

      const result = qualitativeEngine.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeDefined();
      expect(assistantMessage.content).toContain('"from": "A"');
      
      const assistantPromptMessage = result.messages.find(m => 
        m.role === 'user' && m.content.includes('consider the model which you have already')
      );
      expect(assistantPromptMessage).toBeDefined();
    });

    it('should not include lastModel when it has no relationships', () => {
      const lastModel = {
        relationships: []
      };

      const result = qualitativeEngine.setupLLMParameters('Test prompt', lastModel);

      const assistantMessage = result.messages.find(m => m.role === 'assistant');
      expect(assistantMessage).toBeUndefined();
    });

    it('should include feedback prompt in messages', () => {
      const result = qualitativeEngine.setupLLMParameters('Test prompt');

      const feedbackMessage = result.messages.find(m => 
        m.content.includes('closed feedback loops')
      );
      expect(feedbackMessage).toBeDefined();
      expect(feedbackMessage.role).toBe('user');
    });

    it('should handle custom prompts', () => {
      const engineWithCustomPrompts = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        systemPrompt: 'Custom system prompt',
        assistantPrompt: 'Custom assistant prompt',
        feedbackPrompt: 'Custom feedback prompt'
      });

      const lastModel = { relationships: [{ from: 'X', to: 'Y', polarity: '+' }] };
      const result = engineWithCustomPrompts.setupLLMParameters('Test prompt', lastModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toBe('Custom system prompt');

      const assistantPromptMessage = result.messages.find(m => 
        m.content === 'Custom assistant prompt'
      );
      expect(assistantPromptMessage).toBeDefined();

      const feedbackMessage = result.messages.find(m => 
        m.content === 'Custom feedback prompt'
      );
      expect(feedbackMessage).toBeDefined();
    });

    it('should properly order messages in the conversation', () => {
      const engineWithAll = new QualitativeEngineBrain({
        openAIKey: 'test-key',
        anthropicKey: 'test-claude-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background info',
        problemStatement: 'Problem to solve'
      });

      const lastModel = { relationships: [{ from: 'A', to: 'B', polarity: '+' }] };
      const result = engineWithAll.setupLLMParameters('User prompt', lastModel);

      expect(result.messages[0].role).toBe('system');
      expect(result.messages[1].role).toBe('user');
      expect(result.messages[1].content).toContain('Background info');
      expect(result.messages[2].role).toBe('system');
      expect(result.messages[2].content).toContain('Problem to solve');
      expect(result.messages[3].role).toBe('assistant');
      expect(result.messages[4].role).toBe('user');
      expect(result.messages[5].content).toBe('User prompt');
      expect(result.messages[6].content).toContain('closed feedback loops');
    });
  });
});