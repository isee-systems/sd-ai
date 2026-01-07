import { evaluate, makeRelationshipsFromStocks } from '../../../evals/categories/conformance.js';

describe('makeRelationshipsFromStocks', () => {
  it('should return empty array when variables is null or undefined', () => {
    expect(makeRelationshipsFromStocks(null)).toEqual([]);
    expect(makeRelationshipsFromStocks(undefined)).toEqual([]);
  });

  it('should return empty array when variables is empty', () => {
    expect(makeRelationshipsFromStocks([])).toEqual([]);
  });

  it('should skip non-stock variables', () => {
    const variables = [
      { type: 'flow', name: 'growth rate' },
      { type: 'auxiliary', name: 'some factor' }
    ];
    expect(makeRelationshipsFromStocks(variables)).toEqual([]);
  });

  it('should create positive polarity relationships for inflows', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Population',
        inflows: ['births', 'immigration']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      from: 'births',
      to: 'Population',
      polarity: '+'
    });
    expect(result).toContainEqual({
      from: 'immigration',
      to: 'Population',
      polarity: '+'
    });
  });

  it('should create negative polarity relationships for outflows', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Population',
        outflows: ['deaths', 'emigration']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      from: 'deaths',
      to: 'Population',
      polarity: '-'
    });
    expect(result).toContainEqual({
      from: 'emigration',
      to: 'Population',
      polarity: '-'
    });
  });

  it('should handle stocks with both inflows and outflows', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Inventory',
        inflows: ['production', 'returns'],
        outflows: ['sales', 'waste']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(4);
    expect(result).toContainEqual({
      from: 'production',
      to: 'Inventory',
      polarity: '+'
    });
    expect(result).toContainEqual({
      from: 'returns',
      to: 'Inventory',
      polarity: '+'
    });
    expect(result).toContainEqual({
      from: 'sales',
      to: 'Inventory',
      polarity: '-'
    });
    expect(result).toContainEqual({
      from: 'waste',
      to: 'Inventory',
      polarity: '-'
    });
  });

  it('should handle multiple stocks', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Stock1',
        inflows: ['inflow1'],
        outflows: ['outflow1']
      },
      {
        type: 'stock',
        name: 'Stock2',
        inflows: ['inflow2'],
        outflows: ['outflow2']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(4);
    expect(result).toContainEqual({
      from: 'inflow1',
      to: 'Stock1',
      polarity: '+'
    });
    expect(result).toContainEqual({
      from: 'outflow1',
      to: 'Stock1',
      polarity: '-'
    });
    expect(result).toContainEqual({
      from: 'inflow2',
      to: 'Stock2',
      polarity: '+'
    });
    expect(result).toContainEqual({
      from: 'outflow2',
      to: 'Stock2',
      polarity: '-'
    });
  });

  it('should handle stocks with no inflows', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Stock',
        outflows: ['outflow']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      from: 'outflow',
      to: 'Stock',
      polarity: '-'
    });
  });

  it('should handle stocks with no outflows', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Stock',
        inflows: ['inflow']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      from: 'inflow',
      to: 'Stock',
      polarity: '+'
    });
  });

  it('should handle stocks with empty inflows and outflows arrays', () => {
    const variables = [
      {
        type: 'stock',
        name: 'Stock',
        inflows: [],
        outflows: []
      }
    ];

    const result = makeRelationshipsFromStocks(variables);
    expect(result).toEqual([]);
  });

  it('should handle mixed variable types', () => {
    const variables = [
      { type: 'flow', name: 'rate' },
      {
        type: 'stock',
        name: 'Stock1',
        inflows: ['in1']
      },
      { type: 'auxiliary', name: 'helper' },
      {
        type: 'stock',
        name: 'Stock2',
        outflows: ['out2']
      }
    ];

    const result = makeRelationshipsFromStocks(variables);

    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      from: 'in1',
      to: 'Stock1',
      polarity: '+'
    });
    expect(result).toContainEqual({
      from: 'out2',
      to: 'Stock2',
      polarity: '-'
    });
  });
});

describe('Conformance Evaluate', () => {
  describe('variable requirements', () => {
    it('should pass when all required variables are present', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'taxation', to: 'anti-british sentiment' },
            { from: 'anti-british sentiment', to: 'colonial identity' },
            { from: 'colonial identity', to: 'taxation' }
          ]
        }
      };

      const requirements = {
        variables: ['taxation', 'anti-british sentiment', 'colonial identity']
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toEqual([]);
    });

    it('should detect missing required variables', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'taxation', to: 'anti-british sentiment' }
          ]
        }
      };

      const requirements = {
        variables: ['taxation', 'anti-british sentiment', 'colonial identity']
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing required variable');
      expect(failures[0].details).toContain('colonial identity');
    });

    it('should detect multiple missing variables', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'taxation', to: 'other' }
          ]
        }
      };

      const requirements = {
        variables: ['taxation', 'anti-british sentiment', 'colonial identity']
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(2);
      expect(failures[0].type).toBe('Missing required variable');
      expect(failures[1].type).toBe('Missing required variable');
    });
  });

  describe('minimum variable requirements', () => {
    it('should pass when minimum variable count is met', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'var1', to: 'var2' },
            { from: 'var2', to: 'var3' },
            { from: 'var3', to: 'var4' },
            { from: 'var4', to: 'var5' }
          ]
        }
      };

      const requirements = {
        minVariables: 5
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toEqual([]);
    });

    it('should detect when too few variables are present', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'var1', to: 'var2' },
            { from: 'var2', to: 'var3' }
          ]
        }
      };

      const requirements = {
        minVariables: 5
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Too few variables');
      expect(failures[0].details).toContain('Found 3 variables');
    });
  });

  describe('maximum variable requirements', () => {
    it('should pass when maximum variable count is not exceeded', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'var1', to: 'var2' },
            { from: 'var2', to: 'var3' }
          ]
        }
      };

      const requirements = {
        maxVariables: 5
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toEqual([]);
    });

    it('should detect when too many variables are present', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'var1', to: 'var2' },
            { from: 'var2', to: 'var3' },
            { from: 'var3', to: 'var4' },
            { from: 'var4', to: 'var5' },
            { from: 'var5', to: 'var6' },
            { from: 'var6', to: 'var7' }
          ]
        }
      };

      const requirements = {
        maxVariables: 5
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Too many variables');
      expect(failures[0].details).toContain('Found 7 variables');
    });
  });

  describe('feedback loop requirements', () => {
    it('should pass when minimum feedback loops are present', () => {
      // Simple feedback loop: A -> B -> A
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'A' },
            { from: 'C', to: 'D' },
            { from: 'D', to: 'C' }
          ]
        }
      };

      const requirements = {
        minFeedback: 2
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toEqual([]);
    });

    it('should detect when too few feedback loops are present', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' } // No loops
          ]
        }
      };

      const requirements = {
        minFeedback: 2
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Too few feedback loops');
      expect(failures[0].details).toContain('Only 0 feedback loops found');
    });

    it('should detect when too many feedback loops are present', () => {
      // Multiple feedback loops
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'A' },
            { from: 'C', to: 'D' },
            { from: 'D', to: 'C' },
            { from: 'E', to: 'F' },
            { from: 'F', to: 'E' }
          ]
        }
      };

      const requirements = {
        maxFeedback: 2
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Too many feedback loops');
      expect(failures[0].details).toContain('Found 3 feedback loops');
    });
  });

  describe('combined requirements', () => {
    it('should handle multiple requirement types simultaneously', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'taxation', to: 'Sentiment' },
            { from: 'Sentiment', to: 'taxation' },
            { from: 'var1', to: 'var2' },
            { from: 'var2', to: 'var3' }
          ]
        }
      };

      const requirements = {
        variables: ['Taxation', 'sentiment'],
        minVariables: 3,
        maxVariables: 10,
        minFeedback: 1,
        maxFeedback: 5
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toEqual([]);
    });

    it('should detect multiple types of failures', () => {
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'taxation', to: 'other' } // missing required var, no loops
          ]
        }
      };

      const requirements = {
        variables: ['taxation', 'sentiment', 'identity'],
        minVariables: 5,
        minFeedback: 2
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures.length).toBeGreaterThan(1);
      
      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('Missing required variable');
      expect(failureTypes).toContain('Too few variables');
      expect(failureTypes).toContain('Too few feedback loops');
    });
  });

  describe('edge cases', () => {
    it('should handle empty relationships', () => {
      const generatedResponse = {
        model: {
          relationships: []
        }
      };

      const requirements = {
        minVariables: 1,
        minFeedback: 1
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(2);
      expect(failures[0].type).toBe('Too few variables');
      expect(failures[1].type).toBe('Too few feedback loops');
    });

    it('should handle missing model in response', () => {
      const generatedResponse = {};

      const requirements = {
        variables: ['test'],
        minVariables: 1
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toHaveLength(2);
      expect(failures[0].type).toBe('Missing required variable');
      expect(failures[1].type).toBe('Too few variables');
    });

    it('should handle complex feedback loop detection', () => {
      // More complex graph: A -> B -> C -> A (one loop)
      const generatedResponse = {
        model: {
          relationships: [
            { from: 'A', to: 'B' },
            { from: 'B', to: 'C' },
            { from: 'C', to: 'A' },
            { from: 'D', to: 'E' } // No loop
          ]
        }
      };

      const requirements = {
        minFeedback: 1,
        maxFeedback: 1
      };

      const failures = evaluate(generatedResponse, requirements);
      expect(failures).toEqual([]);
    });
  });
});