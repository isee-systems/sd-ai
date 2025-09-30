import { evaluate } from '../../../evals/categories/qualitativeIteration.js';

describe('QualitativeIteration Evaluate', () => {
  describe('successful evaluations', () => {
    it('should return no failures when AI response matches ground truth exactly', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'whatajigs', to: 'balacks', polarity: '-' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
          { from: 'whatajigs', to: 'balacks', polarity: '-' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle case insensitive variable name matching', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'FRIMBULATORS', to: 'whatajigs', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('failure detection', () => {
    it('should detect fake relationships (relationships not in ground truth or current model)', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' },
            { from: 'fake', to: 'relationship', polarity: '-' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Fake relationships found');
      expect(failures[0].details).toContain('fake --> (-) relationship');
    });

    it('should detect missing relationships (ground truth relationships not found)', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
          { from: 'whatajigs', to: 'balacks', polarity: '-' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Real relationships not found');
      expect(failures[0].details).toContain('whatajigs --> (-) balacks');
    });

    it('should detect missing pre-existing relationships', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' },
            { from: 'another', to: 'existing', polarity: '-' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Pre-existing relationships missing');
      expect(failures[0].details).toContain('existing --> (+) variable');
      expect(failures[0].details).toContain('another --> (-) existing');
    });

    it('should detect incorrect polarity', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '-' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect polarity discovered');
      expect(failures[0].details).toContain('Expected - to be +');
    });

    it('should not flag pre-existing relationships as fake', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' },
            { from: 'another', to: 'existing', polarity: '-' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' },
            { from: 'another', to: 'existing', polarity: '-' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect multiple types of failures simultaneously', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '-' }, // wrong polarity
            { from: 'fake', to: 'relationship', polarity: '+' } // fake relationship
            // missing: { from: 'whatajigs', to: 'balacks', polarity: '-' }
            // missing: { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
          { from: 'whatajigs', to: 'balacks', polarity: '-' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(4);

      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Pre-existing relationships missing');
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

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(2);

      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Pre-existing relationships missing');
      expect(failureTypes).toContain('Real relationships not found');
    });

    it('should handle missing model in AI response', () => {
      const generatedResponse = {};

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(2);

      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Pre-existing relationships missing');
      expect(failureTypes).toContain('Real relationships not found');
    });

    it('should handle ground truth without current model', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: null
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle ground truth with empty current model', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: []
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('partial name matching', () => {
    it('should match variables when AI name contains ground truth name', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators_extended', to: 'whatajigs_modified', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should not match when AI name does not contain ground truth name', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimb', to: 'what', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(2);

      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Fake relationships found');
      expect(failureTypes).toContain('Real relationships not found');
    });

    it('should match when AI name exactly equals ground truth name', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'frimbulators', to: 'whatajigs', polarity: '+' },
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const groundTruth = {
        relationships: [
          { from: 'frimbulators', to: 'whatajigs', polarity: '+' }
        ],
        currentModel: {
          relationships: [
            { from: 'existing', to: 'variable', polarity: '+' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });
});