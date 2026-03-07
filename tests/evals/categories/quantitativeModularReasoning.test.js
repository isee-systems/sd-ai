import { evaluate } from '../../../evals/categories/quantitativeModularReasoning.js';

describe('QuantitativeModularReasoning Evaluate', () => {
  describe('module validation', () => {
    it('should pass when no modules created and no modules expected', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'frimbulators', equation: '1000' },
            { type: 'flow', name: 'supply', equation: 'frimbulators * 0.01' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: [],
        expectedModules: [],
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should pass when expected module is appropriately created', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'frimbulators.count', equation: '1000' },
            { type: 'flow', name: 'frimbulators.supply', equation: 'frimbulators.count * 0.01' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: [],
        expectedModules: ["frimbulators"],
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should fail when module created but no modules expected', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'frimbulators.count', equation: '1000' },
            { type: 'flow', name: 'frimbulators.supply', equation: 'frimbulators.count * 0.01' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: [],
        expectedModules: [],
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Unexpected module');
      expect(failures[0].details).toContain(`Module "frimbulators" was unexpectedly created`);
    });

    it('should fail when no modules created but a module was expected', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'frimbulators', equation: '1000' },
            { type: 'flow', name: 'supply', equation: 'frimbulators * 0.01' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: [],
        expectedModules: ["frimbulators"],
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing module');
      expect(failures[0].details).toContain(`Module "frimbulators" is not adequately represented`);
    });

    it('should pass when multiple expected modules are all appropriately created', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'frimbulators.count', equation: '1000' },
            { type: 'flow', name: 'frimbulators.supply', equation: 'frimbulators.count * 0.01' },
            { type: 'stock', name: 'whatamajigs.count', equation: '1000' },
            { type: 'flow', name: 'whatamajigs.supply', equation: 'whatamajigs.count * 0.01' },
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: [],
        expectedModules: ["frimbulators", "whatamajigs"],
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should fail if not all expected modules are created', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'frimbulators.count', equation: '1000' },
            { type: 'flow', name: 'frimbulators.supply', equation: 'frimbulators.count * 0.01' },
            { type: 'stock', name: 'whatamajigs.count', equation: '1000' },
            { type: 'flow', name: 'whatamajigs.supply', equation: 'whatamajigs.count * 0.01' },
            { type: 'stock', name: 'funkados', equation: '1000' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: [],
        expectedModules: ["funkados", "frimbulators", "whatamajigs", "refluppers"],
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(2);
      expect(failures[0].type).toBe('Missing module');
      expect(failures[0].details).toContain(`Module "funkados" is not adequately represented`);
      expect(failures[1].type).toBe('Missing module');
      expect(failures[1].details).toContain(`Module "refluppers" is not adequately represented`);
    });
  });
});