import { evaluate, groups } from '../../../evals/categories/quantitativeModularReasoning.js';

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


describe('the modular test definitions themselves', () => {
  // A required relationship naming a module the test never declares can never be satisfied,
  // so the test fails for every engine forever and reads as a capability gap. That is what
  // "chickens.death rate -> chicken.deaths" did: four required relationships pointed at a
  // module called "chicken" in a test whose modules are lions, foxes and chickens, and all
  // seven v2 engine configs failed the group.
  const moduleOf = (name) => { return name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : null };

  for (const [groupName, tests] of Object.entries(groups)) {
    for (const t of tests) {
      const declared = new Set(t.expectations.expectedModules || []);
      if (declared.size === 0) continue;

      it(`${groupName}/${t.name} only names modules it declares`, () => {
        const qualified = [];
        for (const process of (t.expectations.expectedProcesses || [])) {
          for (const stock of (process.requiredStocks || [])) qualified.push(stock);
          for (const flow of (process.requiredFlows || [])) qualified.push(flow);
          for (const variable of (process.requiredVariables || [])) {
            qualified.push(variable.name);
            if (variable.crossLevelGhostOf) qualified.push(variable.crossLevelGhostOf);
          }
          for (const rel of (process.requiredRelationships || [])) {
            qualified.push(rel.from);
            qualified.push(rel.to);
          }
        }

        const undeclared = [...new Set(
          qualified.map(moduleOf).filter((m) => { return m !== null && !declared.has(m) })
        )];

        expect(undeclared).toEqual([]);
      });
    }
  }
});
