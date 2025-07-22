import QuantitativeEngineBrain from '../../../engines/quantitative/QuantitativeEngineBrain.js';

describe('QuantitativeEngineBrain', () => {
  let quantitativeEngine;

  beforeEach(() => {
    quantitativeEngine = new QuantitativeEngineBrain({
      openAIKey: 'test-key',
      googleKey: 'test-google-key'
    });
  });

  describe('processResponse', () => {
    it('should trim from and to variables and validate relationships exist in variables', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', inflows: ['Birth Rate'], outflows: [] },
          { name: 'Birth Rate', type: 'flow', equation: '0.05 * Population' }
        ],
        relationships: [
          {
            from: '  Population  ',
            to: '  Birth Rate  ',
            polarity: '+',
            reasoning: 'More population leads to more births',
            polarityReasoning: 'Direct correlation'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe('Population');
      expect(result.relationships[0].to).toBe('Birth Rate');
      expect(result.relationships[0].valid).toBeUndefined();
    });

    it('should filter out relationships where variables do not exist in variables array', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', inflows: [], outflows: [] }
        ],
        relationships: [
          {
            from: 'Population',
            to: 'Birth Rate',  // Does not exist in variables
            polarity: '+',
            reasoning: 'Valid from, invalid to',
            polarityReasoning: 'Missing variable'
          },
          {
            from: 'Death Rate',  // Does not exist in variables
            to: 'Population',
            polarity: '+',
            reasoning: 'Invalid from, valid to',
            polarityReasoning: 'Missing variable'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(0);
    });

    it('should filter out self-referencing relationships', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', inflows: ['Birth Rate'], outflows: [] },
          { name: 'Birth Rate', type: 'flow', equation: '0.05 * Population' }
        ],
        relationships: [
          {
            from: 'Population',
            to: 'Population',  // Self-reference
            polarity: '+',
            reasoning: 'Self reference',
            polarityReasoning: 'Same variable'
          },
          {
            from: 'Population',
            to: 'Birth Rate',
            polarity: '+',
            reasoning: 'Valid relationship',
            polarityReasoning: 'Different variables'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe('Population');
      expect(result.relationships[0].to).toBe('Birth Rate');
    });

    it('should remove duplicate relationships keeping the first occurrence', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', inflows: ['Birth Rate'], outflows: ['Death Rate'] },
          { name: 'Birth Rate', type: 'flow', equation: '0.05 * Population' },
          { name: 'Death Rate', type: 'flow', equation: '0.02 * Population' }
        ],
        relationships: [
          {
            from: 'Population',
            to: 'Birth Rate',
            polarity: '+',
            reasoning: 'First occurrence',
            polarityReasoning: 'First reasoning'
          },
          {
            from: 'Population',
            to: 'Death Rate',
            polarity: '+',
            reasoning: 'Different relationship',
            polarityReasoning: 'Different reasoning'
          },
          {
            from: 'Population',
            to: 'Birth Rate',
            polarity: '-',
            reasoning: 'Duplicate occurrence',
            polarityReasoning: 'Different reasoning'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(2);
      expect(result.relationships[0].from).toBe('Population');
      expect(result.relationships[0].to).toBe('Birth Rate');
      expect(result.relationships[0].reasoning).toBe('First occurrence');
      expect(result.relationships[1].from).toBe('Population');
      expect(result.relationships[1].to).toBe('Death Rate');
    });

    it('should convert unused flows to variable type', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', inflows: ['Birth Rate'], outflows: ['Death Rate'] },
          { name: 'Birth Rate', type: 'flow', equation: '0.05 * Population' },
          { name: 'Death Rate', type: 'flow', equation: '0.02 * Population' },
          { name: 'Unused Flow', type: 'flow', equation: '10' }  // Not used in any stock
        ],
        relationships: []
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      const unusedFlow = result.variables.find(v => v.name === 'Unused Flow');
      const usedBirthRate = result.variables.find(v => v.name === 'Birth Rate');
      const usedDeathRate = result.variables.find(v => v.name === 'Death Rate');

      expect(unusedFlow.type).toBe('variable');
      expect(usedBirthRate.type).toBe('flow');
      expect(usedDeathRate.type).toBe('flow');
    });

    it('should handle flows used in both inflows and outflows', () => {
      const originalResponse = {
        variables: [
          { name: 'Stock A', type: 'stock', equation: '100', inflows: ['Transfer Flow'], outflows: [] },
          { name: 'Stock B', type: 'stock', equation: '200', inflows: [], outflows: ['Transfer Flow'] },
          { name: 'Transfer Flow', type: 'flow', equation: '5' }
        ],
        relationships: []
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      const transferFlow = result.variables.find(v => v.name === 'Transfer Flow');
      expect(transferFlow.type).toBe('flow');
    });

    it('should handle case-insensitive duplicate detection with trimming', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000', inflows: ['Birth Rate'], outflows: [] },
          { name: 'Birth Rate', type: 'flow', equation: '0.05 * Population' }
        ],
        relationships: [
          {
            from: 'Population',
            to: 'Birth Rate',
            polarity: '+',
            reasoning: 'First occurrence',
            polarityReasoning: 'First reasoning'
          },
          {
            from: '  POPULATION  ',
            to: '  birth_rate  ',
            polarity: '-',
            reasoning: 'Should be filtered out',
            polarityReasoning: 'Duplicate'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].from).toBe('Population');
      expect(result.relationships[0].to).toBe('Birth Rate');
      expect(result.relationships[0].reasoning).toBe('First occurrence');
    });

    it('should handle empty relationships and variables arrays', () => {
      const originalResponse = {
        variables: [],
        relationships: []
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.variables).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
    });

    it('should handle missing relationships or variables properties', () => {
      const originalResponse = {
        variables: [
          { name: 'Population', type: 'stock', equation: '1000' }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships).toHaveLength(0);
      expect(result.variables).toHaveLength(1);
    });

    it('should preserve all other properties of the original response', () => {
      const originalResponse = {
        explanation: 'Test explanation',
        title: 'Test title',
        specs: {
          startTime: 0,
          stopTime: 100,
          dt: 0.25,
          timeUnits: 'years'
        },
        variables: [
          { name: 'A', type: 'variable', equation: '10' }
        ],
        relationships: [
          {
            from: 'A',
            to: 'A',  // Invalid self-reference
            polarity: '+',
            reasoning: 'Test reasoning',
            polarityReasoning: 'Test polarity reasoning'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.explanation).toBe('Test explanation');
      expect(result.title).toBe('Test title');
      expect(result.specs).toEqual({
        startTime: 0,
        stopTime: 100,
        dt: 0.25,
        timeUnits: 'years'
      });
      expect(result.relationships).toHaveLength(0); // Invalid self-reference filtered out
    });

    it('should remove the valid property from processed relationships', () => {
      const originalResponse = {
        variables: [
          { name: 'A', type: 'variable', equation: '10' },
          { name: 'B', type: 'variable', equation: '20' }
        ],
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

      const result = quantitativeEngine.processResponse(originalResponse);

      expect(result.relationships[0].valid).toBeUndefined();
      expect(result.relationships[0].from).toBe('A');
      expect(result.relationships[0].to).toBe('B');
      expect(result.relationships[0].polarity).toBe('+');
      expect(result.relationships[0].reasoning).toBe('Valid relationship');
      expect(result.relationships[0].polarityReasoning).toBe('Test reasoning');
    });

    it('should handle complex scenario with multiple stocks, flows and relationships', () => {
      const originalResponse = {
        variables: [
          { 
            name: 'Population', 
            type: 'stock', 
            equation: '1000',
            inflows: ['Birth Rate'], 
            outflows: ['Death Rate']
          },
          { 
            name: 'Birth Rate', 
            type: 'flow', 
            equation: '0.05 * Population'
          },
          { 
            name: 'Death Rate', 
            type: 'flow', 
            equation: '0.02 * Population'
          },
          { 
            name: 'Unused Flow', 
            type: 'flow', 
            equation: '10'
          },
          { 
            name: 'Life Expectancy', 
            type: 'variable', 
            equation: '75'
          }
        ],
        relationships: [
          {
            from: 'Population',
            to: 'Population',  // Invalid self-reference
            polarity: '+',
            reasoning: 'Self reference',
            polarityReasoning: 'Invalid'
          },
          {
            from: '  Population  ',
            to: '  Birth Rate  ',
            polarity: '+',
            reasoning: 'Population affects birth rate',
            polarityReasoning: 'More people, more births'
          },
          {
            from: 'population',  // Duplicate of above (case insensitive)
            to: 'BIRTH_RATE',
            polarity: '-',
            reasoning: 'Should be filtered',
            polarityReasoning: 'Duplicate'
          },
          {
            from: 'Life Expectancy',
            to: 'Death Rate',
            polarity: '-',
            reasoning: 'Higher life expectancy reduces death rate',
            polarityReasoning: 'Negative correlation'
          },
          {
            from: 'Nonexistent Variable',  // Variable doesn't exist
            to: 'Population',
            polarity: '+',
            reasoning: 'Should be filtered',
            polarityReasoning: 'Missing variable'
          }
        ]
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      // Check relationships - should have 2 valid ones
      expect(result.relationships).toHaveLength(2);
      expect(result.relationships[0].from).toBe('Population');
      expect(result.relationships[0].to).toBe('Birth Rate');
      expect(result.relationships[1].from).toBe('Life Expectancy');
      expect(result.relationships[1].to).toBe('Death Rate');

      // Check variables - unused flow should be converted to variable type
      const unusedFlow = result.variables.find(v => v.name === 'Unused Flow');
      const birthRate = result.variables.find(v => v.name === 'Birth Rate');
      const deathRate = result.variables.find(v => v.name === 'Death Rate');
      const population = result.variables.find(v => v.name === 'Population');
      
      expect(unusedFlow.type).toBe('variable');
      expect(birthRate.type).toBe('flow');
      expect(deathRate.type).toBe('flow');
      expect(population.type).toBe('stock');
    });

    it('should handle stocks with empty inflows and outflows arrays', () => {
      const originalResponse = {
        variables: [
          { name: 'Stock A', type: 'stock', equation: '100', inflows: [], outflows: [] },
          { name: 'Flow A', type: 'flow', equation: '5' }
        ],
        relationships: []
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      const flowA = result.variables.find(v => v.name === 'Flow A');
      expect(flowA.type).toBe('variable'); // Should be converted since not used
    });

    it('should handle stocks without inflows or outflows properties', () => {
      const originalResponse = {
        variables: [
          { name: 'Stock A', type: 'stock', equation: '100', inflows: [], outflows: [] },
          { name: 'Flow A', type: 'flow', equation: '5' }
        ],
        relationships: []
      };

      const result = quantitativeEngine.processResponse(originalResponse);

      const flowA = result.variables.find(v => v.name === 'Flow A');
      expect(flowA.type).toBe('variable'); // Should be converted since not used
    });
  });
});