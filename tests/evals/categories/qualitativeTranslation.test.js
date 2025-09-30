import { evaluate } from '../../../evals/categories/qualitativeTranslation.js';

describe('CausalTranslation Evaluate', () => {
  describe('successful evaluations', () => {
    it('should return no failures when AI response matches ground truth exactly', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'whatajigs', to: 'balacks', polarity: '-' }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
        { from: 'whatajigs', to: 'balacks', polarity: '-' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle case insensitive variable name matching', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'FRIMBULATORS', to: 'whatajigs', polarity: '+' }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should ignore reasoning and polarityReasoning fields from AI response', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { 
              from: 'frimbulators', 
              to: 'whatajigs', 
              polarity: '+',
              reasoning: 'This is a positive relationship',
              polarityReasoning: 'Because more leads to more'
            }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('failure detection', () => {
    it('should detect fake relationships (relationships not in ground truth)', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'fake', to: 'relationship', polarity: '-' }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Fake relationships found');
      expect(failures[0].details).toContain('fake --> (-) relationship');
    });

    it('should detect missing relationships (ground truth relationships not found)', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
        { from: 'whatajigs', to: 'balacks', polarity: '-' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Real relationships not found');
      expect(failures[0].details).toContain('whatajigs --> (-) balacks');
    });

    it('should detect incorrect polarity', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '-' }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect polarity discovered');
      expect(failures[0].details).toContain('Expected - to be +');
    });

    it('should detect multiple types of failures simultaneously', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '-' }, // wrong polarity
            { from: 'fake', to: 'relationship', polarity: '+' } // fake relationship
            // missing: { from: 'whatajigs', to: 'balacks', polarity: '-' }
          ]
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
        { from: 'whatajigs', to: 'balacks', polarity: '-' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(3);
      
      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Fake relationships found');
      expect(failureTypes).toContain('Real relationships not found');
      expect(failureTypes).toContain('Incorrect polarity discovered');
    });
  });

  describe('edge cases', () => {
    it('should handle empty AI response', () => {
      const generatedResponse = {
        model: {
          relationships: []
        }
      };

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Real relationships not found');
    });

    it('should handle missing model in AI response', () => {
      const generatedResponse = {};

      const groundTruth = [
        { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
      ];

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Real relationships not found');
    });
  });
});