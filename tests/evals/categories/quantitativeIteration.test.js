import { evaluate, groups, description } from '../../../evals/categories/quantitativeIteration.js';

describe('QuantitativeIteration Evaluate', () => {

  describe('currentModel preservation', () => {
    it('should pass when pre-existing model structure is preserved', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            // Pre-existing stocks from currentModel
            {
              type: 'stock',
              name: 'existing_stock_a',
              equation: '50'
            },
            {
              type: 'stock',
              name: 'existing_stock_b',
              equation: '30'
            },
            // New stock being tested
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['test_flow']
            },
            {
              type: 'flow',
              name: 'test_flow',
              equation: 'existing_stock_a * 0.02'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          {
            name: 'frimbulator',
            initialValue: 20,
            inflows: [{ rate: 0.02, of: 'existing_stock_a' }]
          }
        ],
        currentModel: {
          variables: [
            {
              name: 'existing_stock_a',
              type: 'stock',
              equation: '50'
            },
            {
              name: 'existing_stock_b',
              type: 'stock',
              equation: '30'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect missing pre-existing stocks', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            // Missing existing_stock_a from currentModel
            {
              type: 'stock',
              name: 'existing_stock_b',
              equation: '30'
            },
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ],
        currentModel: {
          variables: [
            {
              name: 'existing_stock_a',
              type: 'stock',
              equation: '50'
            },
            {
              name: 'existing_stock_b',
              type: 'stock',
              equation: '30'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.length).toBeGreaterThanOrEqual(1);

      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Pre-existing model structure missing');

      const missingStructureFailure = failures.find(f => f.type === 'Pre-existing model structure missing');
      expect(missingStructureFailure.details).toContain('existing_stock_a');
    });

    it('should detect when pre-existing stock initial value is changed', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'existing_stock_a',
              equation: '75' // Changed from 50
            },
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ],
        currentModel: {
          variables: [
            {
              name: 'existing_stock_a',
              type: 'stock',
              equation: '50'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Pre-existing stock initial value changed');
      expect(failures[0].details).toContain('Expected 75 to be 50');
    });

    it('should detect missing pre-existing stock inflows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'existing_stock_a',
              equation: '50'
              // Missing inflows
            },
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ],
        currentModel: {
          variables: [
            {
              name: 'existing_stock_a',
              type: 'stock',
              equation: '50',
              inflows: ['existing_flow']
            },
            {
              name: 'existing_flow',
              type: 'flow',
              equation: '10'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Pre-existing stock inflows missing');
      expect(failures[0].details).toContain('existing_stock_a');
    });

    it('should detect missing pre-existing stock outflows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'existing_stock_a',
              equation: '50'
              // Missing outflows
            },
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ],
        currentModel: {
          variables: [
            {
              name: 'existing_stock_a',
              type: 'stock',
              equation: '50',
              outflows: ['existing_outflow']
            },
            {
              name: 'existing_outflow',
              type: 'flow',
              equation: '5'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Pre-existing stock outflows missing');
      expect(failures[0].details).toContain('existing_stock_a');
    });
  });

  describe('new stock integration', () => {
    it('should pass when new stock properly references existing stocks', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'existing_stock_a',
              equation: '50'
            },
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['connection_flow']
            },
            {
              type: 'flow',
              name: 'connection_flow',
              equation: 'existing_stock_a * 0.02'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          {
            name: 'frimbulator',
            initialValue: 20,
            inflows: [{ rate: 0.02, of: 'existing_stock_a' }]
          }
        ],
        currentModel: {
          variables: [
            {
              name: 'existing_stock_a',
              type: 'stock',
              equation: '50'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should pass when new stocks reference each other and existing stocks', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'year' },
          variables: [
            // Existing stocks
            {
              type: 'stock',
              name: 'base_stock_x',
              equation: '60'
            },
            {
              type: 'stock',
              name: 'base_stock_y',
              equation: '40'
            },
            // New stocks referencing existing and each other
            {
              type: 'stock',
              name: 'stock1',
              equation: '100',
              inflows: ['flow1']
            },
            {
              type: 'stock',
              name: 'stock2',
              equation: '200',
              inflows: ['flow2'],
              outflows: ['flow3']
            },
            {
              type: 'flow',
              name: 'flow1',
              equation: 'base_stock_x * 0.05'
            },
            {
              type: 'flow',
              name: 'flow2',
              equation: 'stock1 * 3'
            },
            {
              type: 'flow',
              name: 'flow3',
              equation: 'base_stock_y * 0.03'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'year',
        stocks: [
          {
            name: 'stock1',
            initialValue: 100,
            inflows: [{ rate: 0.05, of: 'base_stock_x' }]
          },
          {
            name: 'stock2',
            initialValue: 200,
            inflows: [{ rate: 3, of: 'stock1' }],
            outflows: [{ rate: 0.03, of: 'base_stock_y' }]
          }
        ],
        currentModel: {
          variables: [
            {
              name: 'base_stock_x',
              type: 'stock',
              equation: '60'
            },
            {
              name: 'base_stock_y',
              type: 'stock',
              equation: '40'
            }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('time unit validation', () => {
    it('should pass when time units match', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'month' },
          variables: []
        }
      };

      const groundTruth = {
        timeUnit: 'month',
        stocks: [],
        currentModel: { variables: [] }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect incorrect time units', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: []
        }
      };

      const groundTruth = {
        timeUnit: 'week',
        stocks: [],
        currentModel: { variables: [] }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect time unit discovered');
      expect(failures[0].details).toContain('Expected day to be week');
    });
  });

  describe('edge cases', () => {
    it('should handle empty currentModel', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ],
        currentModel: null
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle missing currentModel', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ]
        // No currentModel property
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle currentModel with no variables', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ],
        currentModel: {
          variables: []
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });

  describe('pluralization tolerance', () => {
    //the english given to the LLM pluralizes the name of every stock it asks for, while the ground
    //truth and the model being iterated on are both singular
    const groundTruth = {
      timeUnit: 'day',
      stocks: [
        { name: 'priary', initialValue: 20 }
      ],
      currentModel: {
        variables: [
          { type: 'stock', name: 'existing_inventory', equation: '50' }
        ],
        specs: { timeUnits: 'day' }
      }
    };

    it.each([
      ['the singular the ground truth uses', 'priary', 'existing_inventory'],
      ['the irregular plural the prose used', 'priaries', 'existing_inventory'],
      ['a regularized plural', 'priarys', 'existing_inventory'],
      ['a pluralized pre-existing name', 'priaries', 'existing_inventories']
    ])('should accept a stock named with %s', (description, name, existingName) => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: name, equation: '20' },
            { type: 'stock', name: existingName, equation: '50' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should accept a pluralized time unit', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'days' },
          variables: [
            { type: 'stock', name: 'priaries', equation: '20' },
            { type: 'stock', name: 'existing_inventory', equation: '50' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should still reject a different stock', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'younjurings', equation: '20' },
            { type: 'stock', name: 'existing_inventory', equation: '50' }
          ]
        }
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toEqual(
        expect.arrayContaining(['Fake stock found', 'Real stocks not found'])
      );
    });
  });

  describe('generated background knowledge', () => {
    it('should name pre-existing model variables exactly as the model names them', () => {
      for (const tests of Object.values(groups)) {
        for (const test of tests) {
          const currentModelNames = (test.currentModel.variables || []).map((variable) => variable.name);

          for (const stock of test.expectations.stocks) {
            const flows = [...(stock.inflows || []), ...(stock.outflows || [])];

            for (const flow of flows) {
              if (!currentModelNames.includes(flow.of))
                continue;

              //pluralizing a pre-existing name would point the prose at a variable which isn't
              //in the model the LLM was handed
              expect(test.prompt).toContain(flow.of + " ");
            }
          }
        }
      }
    });
  });
});
