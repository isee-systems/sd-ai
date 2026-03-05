import { evaluate } from '../../../evals/categories/quantitativeErrorFixing.js';

describe('QuantitativeErrorFixing Evaluate', () => {
  describe('model structure validation', () => {
    it('should detect missing model structure', async () => {
      const generatedResponse = {};
      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Model structure missing');
    });

    it('should detect model with no variables property', async () => {
      const generatedResponse = { model: {} };
      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Model structure missing');
    });
  });

  describe('variable presence validation', () => {
    it('should pass when all variables are present and correct', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' },
            { name: 'growth_rate', type: 'flow', equation: 'population * 0.05' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' },
            { name: 'growth_rate', type: 'flow', equation: 'population * 0.05' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect missing variables', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' },
            { name: 'growth_rate', type: 'flow', equation: 'population * 0.05' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing variable');
      expect(failures[0].details).toContain('growth_rate');
    });

    it('should match variable names case-insensitively', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'Population', type: 'stock', equation: '100' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('variable type validation', () => {
    it('should detect incorrect variable type', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'total_population', type: 'stock', equation: '100' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'total_population', type: 'variable', equation: '100' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect variable type');
      expect(failures[0].details).toContain('total_population');
      expect(failures[0].details).toContain('"variable"');
      expect(failures[0].details).toContain('"stock"');
    });
  });

  describe('equation validation', () => {
    it('should pass when equations match exactly', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'population * 0.05' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'population * 0.05' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should pass when equations differ only in whitespace', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'population*0.05' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'population * 0.05' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should pass when equations differ only in case', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'POPULATION * 0.05' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'population * 0.05' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect incorrect equations', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'population / time_constant' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'growth', type: 'flow', equation: 'DELAY3(infection, incubation_time)' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect equation');
      expect(failures[0].details).toContain('growth');
    });

    it('should skip equation check when correct model has no equation', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'stock', equation: '999' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('stock inflow/outflow validation', () => {
    it('should pass when stock has correct inflows and outflows', async () => {
      const generatedResponse = {
        model: {
          variables: [
            {
              name: 'susceptible',
              type: 'stock',
              equation: '1000',
              inflows: ['birth_rate'],
              outflows: ['infection']
            }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            {
              name: 'susceptible',
              type: 'stock',
              equation: '1000',
              inflows: ['birth_rate'],
              outflows: ['infection']
            }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect missing inflows', async () => {
      const generatedResponse = {
        model: {
          variables: [
            {
              name: 'susceptible',
              type: 'stock',
              equation: '1000',
              inflows: [],
              outflows: ['infection']
            }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            {
              name: 'susceptible',
              type: 'stock',
              equation: '1000',
              inflows: ['birth_rate'],
              outflows: ['infection']
            }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing inflow');
      expect(failures[0].details).toContain('susceptible');
      expect(failures[0].details).toContain('birth_rate');
    });

    it('should detect missing outflows', async () => {
      const generatedResponse = {
        model: {
          variables: [
            {
              name: 'susceptible',
              type: 'stock',
              equation: '1000',
              inflows: ['birth_rate']
            }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            {
              name: 'susceptible',
              type: 'stock',
              equation: '1000',
              inflows: ['birth_rate'],
              outflows: ['infection']
            }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing outflow');
      expect(failures[0].details).toContain('susceptible');
      expect(failures[0].details).toContain('infection');
    });

    it('should match inflow names case-insensitively', async () => {
      const generatedResponse = {
        model: {
          variables: [
            {
              name: 'population',
              type: 'stock',
              equation: '100',
              inflows: ['Birth_Rate']
            }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            {
              name: 'population',
              type: 'stock',
              equation: '100',
              inflows: ['birth_rate']
            }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should not check inflows/outflows for non-stock variables', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'growth', type: 'flow', equation: '10' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'growth', type: 'flow', equation: '10' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('units validation', () => {
    it('should pass when units match', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'stock', equation: '100', units: 'people' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100', units: 'people' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect incorrect units', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'stock', equation: '100', units: 'widgets' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100', units: 'people' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect units');
      expect(failures[0].details).toContain('population');
      expect(failures[0].details).toContain('"people"');
      expect(failures[0].details).toContain('"widgets"');
    });

    it('should skip units check when correct model has no units', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'stock', equation: '100', units: 'widgets' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('multiple failures', () => {
    it('should detect multiple different failure types', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'flow', equation: '100' },
            { name: 'rate', type: 'flow', equation: 'wrong_equation' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' },
            { name: 'rate', type: 'flow', equation: 'population * 0.05' },
            { name: 'auxiliary', type: 'variable', equation: '42' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);

      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Incorrect variable type');
      expect(failureTypes).toContain('Incorrect equation');
      expect(failureTypes).toContain('Missing variable');
    });
  });

  describe('LLM gating', () => {
    it('should not call LLM when structural failures exist', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'population', type: 'flow', equation: '100' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'population', type: 'stock', equation: '100' }
          ]
        },
        errorExplanations: [
          { name: 'population', problem: 'Wrong type' }
        ]
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect variable type');
    });
  });

  describe('edge cases', () => {
    it('should handle empty variables arrays in both models', async () => {
      const generatedResponse = {
        model: {
          variables: []
        }
      };

      const groundTruth = {
        correctModel: {
          variables: []
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle stock with no inflows or outflows in either model', async () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'buffer', type: 'stock', equation: '50' }
          ]
        }
      };

      const groundTruth = {
        correctModel: {
          variables: [
            { name: 'buffer', type: 'stock', equation: '50' }
          ]
        },
        errorExplanations: []
      };

      const failures = await evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });
});
