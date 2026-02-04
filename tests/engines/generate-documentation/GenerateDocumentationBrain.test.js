import GenerateDocumentationBrain from '../../../engines/generate-documentation/GenerateDocumentationBrain.js';
import { LLMWrapper } from '../../../utilities/LLMWrapper.js';

describe('GenerateDocumentationBrain', () => {
  let docBrain;

  beforeEach(() => {
    docBrain = new GenerateDocumentationBrain({
      openAIKey: 'test-key',
      googleKey: 'test-google-key'
    });
  });

  describe('setupLLMParameters', () => {
    it('should throw error when model is not provided', () => {
      expect(() => {
        docBrain.setupLLMParameters('Test prompt', null);
      }).toThrow('A model must be provided to generate documentation.');
    });

    it('should throw error when model has no variables', () => {
      const emptyModel = { variables: [] };
      expect(() => {
        docBrain.setupLLMParameters('Test prompt', emptyModel);
      }).toThrow('No variables found in the model to document.');
    });

    it('should setup basic LLM parameters with default model', () => {
      const testModel = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', units: 'people' },
          { name: 'Birth Rate', type: 'flow', equation: 'Population * 0.05', units: 'people/year' }
        ]
      };

      const result = docBrain.setupLLMParameters('Generate documentation', testModel);

      expect(result.model).toBe(LLMWrapper.DEFAULT_MODEL);
      expect(result.temperature).toBe(0);
      expect(result.reasoningEffort).toBeUndefined();
      expect(result.messages).toBeInstanceOf(Array);
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[result.messages.length - 1].content).toBe('Generate documentation');
    });

    it('should include background knowledge in messages when provided', () => {
      const brainWithBackground = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'This is a population dynamics model'
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithBackground.setupLLMParameters('Test prompt', testModel);

      const backgroundMessage = result.messages.find(m => m.content.includes('This is a population dynamics model'));
      expect(backgroundMessage).toBeDefined();
      expect(backgroundMessage.role).toBe('user');
    });

    it('should include problem statement in messages when provided', () => {
      const brainWithProblem = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        problemStatement: 'Understanding population growth'
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = brainWithProblem.setupLLMParameters('Test prompt', testModel);

      const problemMessage = result.messages.find(m => m.content.includes('Understanding population growth'));
      expect(problemMessage).toBeDefined();
    });

    it('should include model information in messages', () => {
      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = docBrain.setupLLMParameters('Test prompt', testModel);

      const modelMessage = result.messages.find(m => m.content.includes('Here is the current model'));
      expect(modelMessage).toBeDefined();
      expect(modelMessage.role).toBe('user');
      expect(modelMessage.content).toContain('Population');
    });

    it('should include variable information in messages', () => {
      const testModel = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', units: 'people', documentation: 'Initial population' }
        ]
      };

      const result = docBrain.setupLLMParameters('Test prompt', testModel);

      const variableMessage = result.messages.find(m => m.content.includes('Population'));
      expect(variableMessage).toBeDefined();
      expect(variableMessage.content).toContain('stock');
    });

    it('should return all required parameters for LLM API call', () => {
      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }]
      };

      const result = docBrain.setupLLMParameters('Test prompt', testModel);

      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('temperature');
      expect(result).toHaveProperty('reasoningEffort');
      expect(result).toHaveProperty('responseFormat');

      expect(Array.isArray(result.messages)).toBe(true);
      expect(typeof result.model).toBe('string');
    });

    it('should handle custom prompts', () => {
      const brainWithCustomPrompts = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        systemPrompt: 'Custom system prompt for documentation',
        backgroundPrompt: 'Custom background: {backgroundKnowledge}',
        problemStatementPrompt: 'Custom problem: {problemStatement}',
        backgroundKnowledge: 'Custom background data',
        problemStatement: 'Custom problem data'
      });

      const testModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '1' }]
      };

      const result = brainWithCustomPrompts.setupLLMParameters('Test prompt', testModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toBe('Custom system prompt for documentation');

      const backgroundMessage = result.messages.find(m =>
        m.content.includes('Custom background: Custom background data')
      );
      expect(backgroundMessage).toBeDefined();

      const problemMessage = result.messages.find(m =>
        m.content.includes('Custom problem: Custom problem data')
      );
      expect(problemMessage).toBeDefined();
    });

    it('should properly order messages in the conversation', () => {
      const brainWithAll = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        backgroundKnowledge: 'Background info',
        problemStatement: 'Problem to solve'
      });

      const testModel = {
        variables: [{ name: 'Test', type: 'variable', equation: '1' }]
      };

      const result = brainWithAll.setupLLMParameters('User prompt', testModel);

      // First message should be system role
      expect(result.messages[0].role).toMatch(/^(system|developer)$/);
      expect(result.messages[result.messages.length - 1].content).toBe('User prompt');

      // Verify the order includes background knowledge and problem statement
      const backgroundIndex = result.messages.findIndex(m => m.content.includes('Background info'));
      const problemIndex = result.messages.findIndex(m => m.content.includes('Problem to solve'));
      expect(backgroundIndex).toBeGreaterThan(0);
      expect(problemIndex).toBeGreaterThan(backgroundIndex);
    });

    it('should include relationship documentation instructions when documentConnectors is enabled', () => {
      const brainWithConnectors = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        documentConnectors: true
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }],
        relationships: [{ from: 'Birth Rate', to: 'Population' }]
      };

      const result = brainWithConnectors.setupLLMParameters('Test prompt', testModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toContain('document the relationships (connectors) between variables');
    });

    it('should include polarity generation instructions when both documentConnectors and generatePolarity are enabled', () => {
      const brainWithPolarity = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        documentConnectors: true,
        generatePolarity: true
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }],
        relationships: [{ from: 'Birth Rate', to: 'Population' }]
      };

      const result = brainWithPolarity.setupLLMParameters('Test prompt', testModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).toContain('document the relationships (connectors) between variables');
      expect(systemMessage.content).toContain('determine the polarity (+ or -)');
    });

    it('should not include polarity instructions when only generatePolarity is enabled without documentConnectors', () => {
      const brainWithPolarityOnly = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        generatePolarity: true
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }],
        relationships: [{ from: 'Birth Rate', to: 'Population' }]
      };

      const result = brainWithPolarityOnly.setupLLMParameters('Test prompt', testModel);

      const systemMessage = result.messages[0];
      expect(systemMessage.content).not.toContain('relationships (connectors)');
      expect(systemMessage.content).not.toContain('polarity');
    });

    it('should generate correct response schema when documentConnectors is enabled', () => {
      const brainWithConnectors = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        documentConnectors: true
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }],
        relationships: [{ from: 'Birth Rate', to: 'Population' }]
      };

      const result = brainWithConnectors.setupLLMParameters('Test prompt', testModel);

      expect(result.responseFormat).toBeDefined();
      // The response format should include relationships when documentConnectors is true
    });

    it('should generate correct response schema when both documentConnectors and generatePolarity are enabled', () => {
      const brainWithBoth = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        documentConnectors: true,
        generatePolarity: true
      });

      const testModel = {
        variables: [{ name: 'Population', type: 'stock', equation: '1000' }],
        relationships: [{ from: 'Birth Rate', to: 'Population' }]
      };

      const result = brainWithBoth.setupLLMParameters('Test prompt', testModel);

      expect(result.responseFormat).toBeDefined();
      // The response format should include relationships with polarity fields
    });
  });

  describe('integration tests', () => {
    it('should validate all required setup parameters are provided', () => {
      expect(() => {
        new GenerateDocumentationBrain({
          openAIKey: 'test-key',
          googleKey: 'test-google-key'
        });
      }).not.toThrow();
    });

    it('should handle constructor parameter validation', () => {
      const brain = new GenerateDocumentationBrain({
        openAIKey: 'test-key',
        googleKey: 'test-google-key',
        problemStatementPrompt: 'Custom prompt',
        backgroundPrompt: 'Custom background'
      });

      expect(brain).toBeDefined();
    });
  });
});
