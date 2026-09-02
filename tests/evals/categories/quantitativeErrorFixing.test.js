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

  describe('equations that are the same equation written differently', () => {
    // Every case here was a real v2 failure. This category is about the form of a
    // formulation, so the comparison stays textual — but a literal spelled two ways, and a
    // sum listed in two orders, say nothing about the formulation and were scored as errors.
    const compare = async (generated, expected) => {
      const failures = await evaluate(
        { model: { variables: [{ name: 'v', type: 'variable', equation: generated }] } },
        { correctModel: { variables: [{ name: 'v', type: 'variable', equation: expected }] }, errorExplanations: [] }
      );
      return failures;
    };

    it('accepts a constant written without scientific notation', async () => {
      expect(await compare('17000000', '1.7e+07')).toEqual([]);
      expect(await compare('1.7e+07', '17000000')).toEqual([]);
      expect(await compare('100.0', '100')).toEqual([]);
    });

    it('accepts the terms of a sum in a different order', async () => {
      expect(await compare(
        'Presymptomatic_infectious+Symptomatic_infectious+Asymptomatic_infectious',
        'Symptomatic_infectious + Presymptomatic_infectious + Asymptomatic_infectious'
      )).toEqual([]);
    });

    it('still rejects a different constant', async () => {
      const failures = await compare('17000001', '1.7e+07');
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect equation');
    });

    it('still rejects a sum over different terms', async () => {
      expect(await compare('a+b', 'a+c')).toHaveLength(1);
    });

    it('does not reorder anything but a plain sum', async () => {
      // Subtraction and division are not commutative, so term order is meaning.
      expect(await compare('C+A-B', 'A-B+C')).toHaveLength(1);
      expect(await compare('b/a', 'a/b')).toHaveLength(1);
    });

    it('still rejects a pipeline delay rewritten as a first-order drain', async () => {
      // The prompt asks the engine to preserve pipeline versus exponential delay style, so
      // this difference is exactly what the category exists to catch.
      expect(await compare(
        'Exposed_population/(Average_COVID_incubation_time/Days_per_week)',
        'DELAY3(Infection, Average_COVID_incubation_time/Days_per_week)'
      )).toHaveLength(1);
    });

    it('still rejects an equation whose operator is malformed', async () => {
      expect(await compare('Susceptible_population//Total_population', 'Susceptible_population/Total_population')).toHaveLength(1);
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
