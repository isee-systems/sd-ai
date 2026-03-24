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

  describe('ghosting validation', () => {
    it('should pass when ghosts are created as expected', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'wolf.count', equation: '10' },
            { type: 'stock', name: 'rabbit.count', equation: '10' },
            { type: 'stock', name: 'rabbit.wolfCount', crossLevelGhostOf: 'wolf.count' },
            { type: 'flow', name: 'rabbit.predation' }
          ],
          relationships: [
            { from: 'rabbit.wolfCount', to: 'rabbit.predation', polarity: '+' },
            { from: 'rabbit.predation', to: 'rabbit.count', polarity: '-' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Infection dynamics",
          requiredVariables: [
            { name: 'wolf.count' },
            { name: 'rabbit.count' },
            { name: 'rabbit.wolfCount', crossLevelGhostOf: 'wolf.count' },
          ],
          requiredRelationships: [
            { from: 'rabbit.wolfCount', to: 'rabbit.predation', polarity: '+' },
            { from: 'rabbit.predation', to: 'rabbit.count', polarity: '-' }
          ]
        }],
        expectedModules: ["wolf", "rabbit"]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should fail when expected ghost is not created', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'wolf.count', equation: '10' },
            { type: 'stock', name: 'rabbit.count', equation: '10' },
            { type: 'stock', name: 'rabbit.wolfCount' },
            { type: 'flow', name: 'rabbit.predation' }
          ],
          relationships: [
            { from: 'rabbit.wolfCount', to: 'rabbit.predation', polarity: '+' },
            { from: 'rabbit.predation', to: 'rabbit.count', polarity: '-' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Infection dynamics",
          requiredVariables: [
            { name: 'wolf.count' },
            { name: 'rabbit.count' },
            { name: 'rabbit.wolfCount', crossLevelGhostOf: 'wolf.count' },
          ],
          requiredRelationships: [
            { from: 'rabbit.wolfCount', to: 'rabbit.predation', polarity: '+' },
            { from: 'rabbit.predation', to: 'rabbit.count', polarity: '-' }
          ]
        }],
        expectedModules: ["wolf", "rabbit"]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain(`rabbit.wolfCount which ghosts wolf.count`);
    });

    /*it('should fail when creating a relationship between two components in different modules', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'wolf.count', equation: '10' },
            { type: 'stock', name: 'rabbit.count', equation: '10' },
            { type: 'flow', name: 'rabbit.predation' }
          ],
          relationships: [
            { from: 'wolf.count', to: 'rabbit.predation', polarity: '+' },
            { from: 'rabbit.predation', to: 'rabbit.count', polarity: '-' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Infection dynamics",
          requiredVariables: [
            { name: 'wolf.count' },
            { name: 'rabbit.count' },
          ],
          requiredRelationships: [
            { from: 'rabbit.predation', to: 'rabbit.count', polarity: '-' }
          ]
        }],
        expectedModules: ["wolf", "rabbit"]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Invalid relationship');
      expect(failures[0].details).toContain(`Relationship between "wolf.count" and "rabbit.predation" is invalid (different modules without ghosting)`);
    });*/
  });
});