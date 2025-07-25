import { evaluate } from '../../../evals/categories/quantitativeCausalReasoning.js';

describe('QuantitativeCausalReasoning Evaluate', () => {
  describe('basic quantitative structure validation', () => {
    it('should pass when model has stocks and flows', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'day' },
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'flow', name: 'infection', equation: 'susceptible * 0.01' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing stocks', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'flow', name: 'infection', equation: '10' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('No stocks found');
    });

    it('should detect missing flows', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('No flows found');
    });

    it('should detect incorrect time unit', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'week' },
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'flow', name: 'infection', equation: '10' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'day',
        expectedProcesses: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Incorrect time unit');
      expect(failures[0].details).toContain('Expected time unit to include "day", found "week"');
    });
  });

  describe('process validation - required stocks', () => {
    it('should pass when all required stocks are present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible_population', equation: '1000' },
            { type: 'stock', name: 'exposed_individuals', equation: '0' },
            { type: 'stock', name: 'infectious_people', equation: '10' },
            { type: 'flow', name: 'infection_rate', equation: '5' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "SEIR model",
          requiredStocks: ["susceptible", "exposed", "infectious"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should pass with case-insensitive and whitespace/underscore-insensitive matching', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'SUSCEPTIBLE POPULATION', equation: '1000' },
            { type: 'stock', name: 'exposed-individuals', equation: '0' },
            { type: 'stock', name: 'InfectiousPeople', equation: '10' },
            { type: 'flow', name: 'infection_rate', equation: '5' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "SEIR model",
          requiredStocks: ["susceptible", "exposed", "infectious"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should pass with bidirectional variable name matching', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'experienced_staff_members', equation: '100' },
            { type: 'stock', name: 'total_employees', equation: '1000' },
            { type: 'flow', name: 'hiring', equation: '5' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Staff model",
          requiredStocks: ["experienced", "employees"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing required stocks', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible_population', equation: '1000' },
            { type: 'flow', name: 'infection_rate', equation: '5' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "SEIR model",
          requiredStocks: ["susceptible", "exposed", "infectious"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain('SEIR model');
      expect(failures[0].details).toContain('stocks: exposed, infectious');
    });
  });

  describe('process validation - required flows', () => {
    it('should pass when all required flows are present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'flow', name: 'infection_flow', equation: '5' },
            { type: 'flow', name: 'recovery_process', equation: '3' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Disease dynamics",
          requiredFlows: ["infection", "recovery"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing required flows', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'flow', name: 'infection_flow', equation: '5' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Disease dynamics",
          requiredFlows: ["infection", "recovery", "death"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain('flows: recovery, death');
    });
  });

  describe('process validation - required relationships', () => {
    it('should pass when all required relationships are present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'stock', name: 'infectious_people', equation: '10' },
            { type: 'flow', name: 'infection', equation: '5' }
          ],
          relationships: [
            { from: 'infectious_people', to: 'infection', polarity: '+' },
            { from: 'susceptible', to: 'infection', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Infection dynamics",
          requiredRelationships: [
            { from: "infectious", to: "infection", polarity: "+" },
            { from: "susceptible", to: "infection", polarity: "+" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing required relationships', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'flow', name: 'infection', equation: '5' }
          ],
          relationships: [
            { from: 'infectious_people', to: 'infection_rate', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Infection dynamics", 
          requiredRelationships: [
            { from: "infectious", to: "infection", polarity: "+" },
            { from: "susceptible", to: "infection", polarity: "+" },
            { from: "contact_rate", to: "infection", polarity: "+" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain('Infection dynamics');
      expect(failures[0].details).toContain('relationships:');
      expect(failures[0].details).toContain('susceptible → infection');
      expect(failures[0].details).toContain('contact_rate → infection');
    });

    it('should handle relationships without polarity constraints', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'population', equation: '1000' },
            { type: 'flow', name: 'population_growth', equation: '10' },
            { type: 'variable', name: 'birth_rate_var', equation: '0.1' }
          ],
          relationships: [
            { from: 'birth_rate_var', to: 'population_growth', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Population growth",
          requiredRelationships: [
            { from: "birth_rate", to: "population_growth" } // No polarity specified
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should report missing relationships with polarity information', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'housing_supply', equation: '10000' },
            { type: 'variable', name: 'housing_prices', equation: '300000' },
            { type: 'flow', name: 'construction', equation: '100' }
          ],
          relationships: []
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Housing dynamics",
          requiredRelationships: [
            { from: "housing_supply", to: "housing_prices", polarity: "-" },
            { from: "demand", to: "prices", polarity: "+" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain('relationships:');
      expect(failures[0].details).toContain('housing_supply → housing_prices (-)');
      expect(failures[0].details).toContain('demand → prices (+)');
    });
  });

  describe('process validation - key variables', () => {
    it('should pass when all key variables are present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'patients_in_hospital', equation: '100' },
            { type: 'flow', name: 'patient_admissions', equation: '10' },
            { type: 'variable', name: 'workload_per_nurse', equation: '5' },
            { type: 'variable', name: 'burnout_level', equation: '0.3' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Healthcare dynamics",
          requiredVariables: [
            { name: "workload", type: "variable" },
            { name: "burnout", type: "variable" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should pass when key variables are present without type constraints', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible_population', equation: '1000' },
            { type: 'flow', name: 'vaccination_rate', equation: '100' },
            { type: 'variable', name: 'contact_frequency', equation: '10' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Public health interventions",
          requiredVariables: [
            { name: "vaccination" }, // No type specified
            { name: "contact" }      // No type specified
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing required variables', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'patients', equation: '100' },
            { type: 'flow', name: 'patient_flow', equation: '5' },
            { type: 'variable', name: 'workload', equation: '5' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Healthcare dynamics",
          requiredVariables: [
            { name: "workload", type: "variable" },
            { name: "burnout", type: "variable" },
            { name: "staff_satisfaction", type: "variable" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain('variables: burnout, staff_satisfaction');
    });
  });

  describe('complex process validation', () => {
    it('should pass when complex process with multiple requirements is fully present', () => {
      const generatedResponse = {
        model: {
          specs: { timeUnits: 'month' },
          variables: [
            { type: 'stock', name: 'housing_supply_total', equation: '10000' },
            { type: 'stock', name: 'housing_demand_current', equation: '12000' },
            { type: 'flow', name: 'new_construction_rate', equation: '50' },
            { type: 'flow', name: 'population_growth_flow', equation: '100' },
            { type: 'variable', name: 'housing_prices_avg', equation: '300000' },
            { type: 'variable', name: 'affordability_index', equation: '0.7' }
          ],
          relationships: [
            { from: 'housing_demand_current', to: 'housing_prices_avg', polarity: '+' },
            { from: 'housing_supply_total', to: 'housing_prices_avg', polarity: '-' },
            { from: 'housing_prices_avg', to: 'affordability_index', polarity: '-' }
          ]
        }
      };

      const expectations = {
        timeUnit: 'month',
        expectedProcesses: [{
          name: "Housing market dynamics",
          requiredStocks: ["housing_supply", "housing_demand"],
          requiredFlows: ["new_construction", "population_growth"],
          requiredRelationships: [
            { from: "housing_demand", to: "housing_prices", polarity: "+" },
            { from: "housing_supply", to: "housing_prices", polarity: "-" }
          ],
          requiredVariables: [
            { name: "housing_prices", type: "variable" },
            { name: "affordability", type: "variable" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect multiple missing elements in complex process', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'housing_supply', equation: '10000' },
            { type: 'variable', name: 'housing_prices', equation: '300000' }
          ],
          relationships: [
            { from: 'housing_supply', to: 'housing_prices', polarity: '-' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Housing market dynamics",
          requiredStocks: ["housing_supply", "housing_demand"],
          requiredFlows: ["new_construction", "population_growth"],
          requiredRelationships: [
            { from: "housing_demand", to: "housing_prices", polarity: "+" },
            { from: "housing_supply", to: "housing_prices", polarity: "-" }
          ],
          requiredVariables: [
            { name: "affordability", type: "variable" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(2);
      expect(failures[0].type).toBe('No flows found');
      expect(failures[1].type).toBe('Missing key process');
      expect(failures[1].details).toContain('stocks: housing_demand');
      expect(failures[1].details).toContain('flows: new_construction, population_growth');
      expect(failures[1].details).toContain('relationships: housing_demand → housing_prices');
      expect(failures[1].details).toContain('variables: affordability');
    });
  });

  describe('edge cases', () => {
    it('should handle empty model', () => {
      const generatedResponse = {
        model: {
          variables: []
        }
      };

      const expectations = {
        expectedProcesses: [{
          name: "Basic process",
          requiredStocks: ["test_stock"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures.length).toBeGreaterThan(0);
      
      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('No stocks found');
      expect(failureTypes).toContain('No flows found');
      expect(failureTypes).toContain('Missing key process');
    });

    it('should handle missing model', () => {
      const generatedResponse = {};

      const expectations = {
        expectedProcesses: [{
          name: "Basic process",
          requiredStocks: ["test_stock"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures.length).toBeGreaterThan(0);
    });

    it('should handle multiple processes with mixed success', () => {
      const generatedResponse = {
        model: {
          variables: [
            { type: 'stock', name: 'susceptible', equation: '1000' },
            { type: 'stock', name: 'infectious', equation: '10' },
            { type: 'flow', name: 'infection', equation: '5' },
            { type: 'flow', name: 'recovery', equation: '3' }
          ],
          relationships: [
            { from: 'infectious', to: 'infection', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedProcesses: [
          {
            name: "Process 1 - Complete",
            requiredStocks: ["susceptible", "infectious"],
            requiredFlows: ["infection"]
          },
          {
            name: "Process 2 - Missing elements", 
            requiredStocks: ["exposed", "recovered"],
            requiredFlows: ["incubation"]
          }
        ]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key process');
      expect(failures[0].details).toContain('Process 2 - Missing elements');
    });
  });
});