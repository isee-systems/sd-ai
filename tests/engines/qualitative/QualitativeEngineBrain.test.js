import QualitativeEngineBrain from '../../../engines/qualitative/QualitativeEngineBrain.js';

describe('QualitativeEngineBrain', () => {
  let qualitativeEngine;

  beforeEach(() => {
    qualitativeEngine = new QualitativeEngineBrain({
      openAIKey: 'test-key',
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
});