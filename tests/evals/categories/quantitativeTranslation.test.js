import { evaluate } from '../../../evals/categories/quantitativeTranslation.js';

describe('QuantitativeTranslation Evaluate', () => {
  describe('time unit validation', () => {
    it('should pass when time units match', () => {
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
          {
            name: 'frimbulator',
            initialValue: 20
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect incorrect time units', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'week' },
          variables: []
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: []
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect time unit discovered');
      expect(failures[0].details).toContain('Expected week to be day');
    });

    it('should detect missing time units', () => {
      const generatedResponse = {
        model: {
          variables: []
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: []
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect time unit discovered');
      expect(failures[0].details).toContain('Expected undefined to be day');
    });
  });

  describe('stock validation', () => {
    it('should pass when all stocks are present with correct initial values', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            },
            {
              type: 'stock',
              name: 'whatajig',
              equation: '100'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 },
          { name: 'whatajig', initialValue: 100 }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect fake stocks (not in ground truth)', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
            },
            {
              type: 'stock',
              name: 'fake-stock',
              equation: '50'
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Fake stock found');
      expect(failures[0].details).toContain('fake-stock');
    });

    it('should detect missing stocks', () => {
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
          { name: 'frimbulator', initialValue: 20 },
          { name: 'whatajig', initialValue: 100 }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Real stocks not found');
      expect(failures[0].details).toContain('whatajig');
    });

    it('should detect incorrect initial values', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '50'  // Should be 20
            }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect initial value discovered');
      expect(failures[0].details).toContain('Expected 50 to be 20');
    });
  });

  describe('inflow validation', () => {
    it('should pass when inflows match with correct fixed flows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['test_flow']
            },
            {
              type: 'flow',
              name: 'test_flow',
              equation: '5'
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
            inflows: [
              { fixed: 5 }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should pass when inflows match with correct rate flows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['test_flow']
            },
            {
              type: 'flow',
              name: 'test_flow',
              equation: 'frimbulator * 0.02'
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
            inflows: [
              { rate: 0.02, of: 'frimbulator' }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should pass when rate is in a cause variable equation', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['test_flow']
            },
            {
              type: 'flow',
              name: 'test_flow',
              equation: 'frimbulator * rate_var'
            },
            {
              type: 'variable',
              name: 'rate_var',
              equation: '0.02'
            }
          ],
          relationships: [
            { from: 'rate_var', to: 'test_flow' }
          ]
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          {
            name: 'frimbulator',
            initialValue: 20,
            inflows: [
              { rate: 0.02, of: 'frimbulator' }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect incorrect number of inflows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['flow1']
            },
            {
              type: 'flow',
              name: 'flow1',
              equation: '5'
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
            inflows: [
              { fixed: 5 },
              { fixed: 3 }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect number of inflows discovered');
      expect(failures[0].details).toContain('Expected 1 to be 2');
    });

    it('should detect missing flows that match specifications', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              inflows: ['test_flow']
            },
            {
              type: 'flow',
              name: 'test_flow',
              equation: '3'  // Should be 5
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
            inflows: [
              { fixed: 5 }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Failed to find flow matching specification');
    });
  });

  describe('outflow validation', () => {
    it('should pass when outflows match with correct flows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20',
              outflows: ['test_outflow']
            },
            {
              type: 'flow',
              name: 'test_outflow',
              equation: 'frimbulator * 0.05'
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
            outflows: [
              { rate: 0.05, of: 'frimbulator' }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should detect incorrect number of outflows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'frimbulator',
              equation: '20'
              // No outflows
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
            outflows: [
              { fixed: 2 }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect number of outflows discovered');
      expect(failures[0].details).toContain('Expected 0 to be 1');
    });
  });

  describe('edge cases', () => {
    it('should handle empty model', () => {
      const generatedResponse = {
        model: {
          variables: []
        }
      };

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.length).toBeGreaterThan(0);
      
      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Incorrect time unit discovered');
      expect(failureTypes).toContain('Real stocks not found');
    });

    it('should handle missing model', () => {
      const generatedResponse = {};

      const groundTruth = {
        timeUnit: 'day',
        stocks: [
          { name: 'frimbulator', initialValue: 20 }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.length).toBeGreaterThan(0);
    });

    it('should handle case insensitive stock name matching', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            {
              type: 'stock',
              name: 'FRIMBULATOR',
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
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });

    it('should handle complex multi-stock system validation', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'year' },
          variables: [
            {
              type: 'stock',
              name: 'stock1',
              equation: '100',
              inflows: ['flow1'],
              outflows: ['flow2']
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
              equation: 'stock1 * 0.05'
            },
            {
              type: 'flow',
              name: 'flow2',
              equation: '3'
            },
            {
              type: 'flow',
              name: 'flow3',
              equation: 'stock2 * 0.03'
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
            inflows: [{ rate: 0.05, of: 'stock1' }],
            outflows: [{ fixed: 3 }]
          },
          {
            name: 'stock2',
            initialValue: 200,
            inflows: [{ fixed: 3 }],
            outflows: [{ rate: 0.03, of: 'stock2' }]
          }
        ]
      };

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures).toEqual([]);
    });
  });
});