import { evaluate } from '../../../evals/categories/qualitativeCausalReasoning.js';

describe('QualitativeCausalReasoning Evaluate', () => {
  describe('basic CLD structure validation', () => {
    it('should pass when model has variables and relationships', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'disease transmission', equation: '' },
            { name: 'policy interventions', equation: '' }
          ],
          relationships: [
            { from: 'disease transmission', to: 'policy interventions', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing variables', () => {
      const generatedResponse = {
        model: {
          variables: [],
          relationships: [
            { from: 'a', to: 'b', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('No variables found');
    });

    it('should detect missing relationships', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'disease transmission', equation: '' }
          ],
          relationships: []
        }
      };

      const expectations = {
        expectedVariableGroups: []
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('No causal relationships found');
    });
  });

  describe('variable group validation - required variables', () => {
    it('should pass when all required variables are present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'disease_transmission_rate', equation: '' },
            { name: 'policy_interventions_strength', equation: '' },
            { name: 'economic_impact_level', equation: '' },
            { name: 'public_compliance_rate', equation: '' }
          ],
          relationships: [
            { from: 'disease_transmission_rate', to: 'policy_interventions_strength', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Core pandemic dynamics",
          requiredVariables: ["disease transmission", "policy interventions", "economic impact", "public compliance"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should pass with case-insensitive and whitespace/underscore-insensitive matching', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'DISEASE TRANSMISSION', equation: '' },
            { name: 'policy-interventions', equation: '' },
            { name: 'EconomicImpact', equation: '' },
            { name: 'public_compliance', equation: '' }
          ],
          relationships: [
            { from: 'DISEASE TRANSMISSION', to: 'policy-interventions', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Core pandemic dynamics",
          requiredVariables: ["disease transmission", "policy interventions", "economic impact", "public compliance"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should pass with bidirectional variable name matching', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'experienced_staff_burnout', equation: '' },
            { name: 'total_employee_satisfaction', equation: '' }
          ],
          relationships: [
            { from: 'experienced_staff_burnout', to: 'total_employee_satisfaction', polarity: '-' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Staff model",
          requiredVariables: ["experienced", "employee"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect missing required variables', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'disease_transmission', equation: '' }
          ],
          relationships: [
            { from: 'disease_transmission', to: 'policy_interventions', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Core pandemic dynamics",
          requiredVariables: ["disease transmission", "policy interventions", "economic impact"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key variable group');
      expect(failures[0].details).toContain('Core pandemic dynamics');
      expect(failures[0].details).toContain('variables: policy interventions, economic impact');
    });
  });

  describe('variable group validation - required relationships', () => {
    it('should pass when all required relationships are present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'disease_transmission', equation: '' },
            { name: 'policy_interventions', equation: '' },
            { name: 'economic_impact', equation: '' },
            { name: 'public_compliance', equation: '' }
          ],
          relationships: [
            { from: 'disease_transmission', to: 'policy_interventions', polarity: '+' },
            { from: 'policy_interventions', to: 'economic_impact', polarity: '+' },
            { from: 'economic_impact', to: 'public_compliance', polarity: '-' },
            { from: 'public_compliance', to: 'disease_transmission', polarity: '-' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Pandemic feedback loop",
          requiredRelationships: [
            { from: "disease transmission", to: "policy interventions", polarity: "+" },
            { from: "policy interventions", to: "economic impact", polarity: "+" },
            { from: "economic impact", to: "public compliance", polarity: "-" },
            { from: "public compliance", to: "disease transmission", polarity: "-" }
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
            { name: 'disease_transmission', equation: '' },
            { name: 'policy_interventions', equation: '' },
            { name: 'economic_impact', equation: '' }
          ],
          relationships: [
            { from: 'disease_transmission', to: 'policy_interventions', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Pandemic dynamics",
          requiredRelationships: [
            { from: "disease transmission", to: "policy interventions", polarity: "+" },
            { from: "policy interventions", to: "economic impact", polarity: "+" },
            { from: "public trust", to: "public compliance", polarity: "+" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key variable group');
      expect(failures[0].details).toContain('Pandemic dynamics');
      expect(failures[0].details).toContain('relationships:');
      expect(failures[0].details).toContain('policy interventions → economic impact');
      expect(failures[0].details).toContain('public trust → public compliance');
    });

    it('should handle relationships without polarity constraints', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'leadership_support', equation: '' },
            { name: 'technology_adoption', equation: '' }
          ],
          relationships: [
            { from: 'leadership_support', to: 'technology_adoption', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Digital transformation",
          requiredRelationships: [
            { from: "leadership", to: "technology_adoption" } // No polarity specified
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
            { name: 'social_isolation', equation: '' },
            { name: 'mental_health', equation: '' },
            { name: 'community_support', equation: '' }
          ],
          relationships: []
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Mental health dynamics",
          requiredRelationships: [
            { from: "social isolation", to: "mental_health", polarity: "-" },
            { from: "community_support", to: "social isolation", polarity: "-" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(2); // Basic structure + missing group
      const groupFailure = failures.find(f => f.type === 'Missing key variable group');
      expect(groupFailure).toBeTruthy();
      expect(groupFailure.details).toContain('relationships:');
      expect(groupFailure.details).toContain('social isolation → mental_health (-)');
      expect(groupFailure.details).toContain('community_support → social isolation (-)');
    });
  });


  describe('complex variable group validation', () => {
    it('should pass when complex variable group with multiple requirements is fully present', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'technology_adoption_rate', equation: '' },
            { name: 'employee_resistance_level', equation: '' },
            { name: 'skill_development_progress', equation: '' },
            { name: 'leadership_support_strength', equation: '' },
            { name: 'change_management_effectiveness', equation: '' }
          ],
          relationships: [
            { from: 'technology_adoption_rate', to: 'employee_resistance_level', polarity: '+' },
            { from: 'employee_resistance_level', to: 'technology_adoption_rate', polarity: '-' },
            { from: 'skill_development_progress', to: 'employee_resistance_level', polarity: '-' },
            { from: 'leadership_support_strength', to: 'technology_adoption_rate', polarity: '+' },
            { from: 'leadership_support_strength', to: 'change_management_effectiveness', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Digital transformation dynamics",
          requiredVariables: ["technology adoption", "employee resistance", "skill development"],
          requiredRelationships: [
            { from: "technology adoption", to: "employee resistance", polarity: "+" },
            { from: "employee resistance", to: "technology adoption", polarity: "-" },
            { from: "skill development", to: "employee resistance", polarity: "-" },
            { from: "leadership support", to: "technology adoption", polarity: "+" },
            { from: "leadership support", to: "change management", polarity: "+" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toEqual([]);
    });

    it('should detect multiple missing elements in complex variable group', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'technology_adoption', equation: '' },
            { name: 'employee_resistance', equation: '' }
          ],
          relationships: [
            { from: 'technology_adoption', to: 'employee_resistance', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Digital transformation dynamics",
          requiredVariables: ["technology adoption", "employee resistance", "skill development", "organizational culture"],
          requiredRelationships: [
            { from: "technology adoption", to: "employee resistance", polarity: "+" },
            { from: "skill development", to: "employee resistance", polarity: "-" },
            { from: "organizational culture", to: "employee resistance", polarity: "-" },
            { from: "leadership support", to: "technology adoption", polarity: "+" }
          ]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key variable group');
      expect(failures[0].details).toContain('variables: skill development, organizational culture');
      expect(failures[0].details).toContain('relationships: skill development → employee resistance');
    });
  });

  describe('edge cases', () => {
    it('should handle empty model', () => {
      const generatedResponse = {
        model: {
          variables: [],
          relationships: []
        }
      };

      const expectations = {
        expectedVariableGroups: [{
          name: "Basic group",
          requiredVariables: ["test_variable"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures.length).toBeGreaterThan(0);
      
      const failureTypes = failures.map(f => f.type);
      expect(failureTypes).toContain('No variables found');
      expect(failureTypes).toContain('No causal relationships found');
      expect(failureTypes).toContain('Missing key variable group');
    });

    it('should handle missing model', () => {
      const generatedResponse = {};

      const expectations = {
        expectedVariableGroups: [{
          name: "Basic group",
          requiredVariables: ["test_variable"]
        }]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures.length).toBeGreaterThan(0);
    });

    it('should handle multiple variable groups with mixed success', () => {
      const generatedResponse = {
        model: {
          variables: [
            { name: 'disease_transmission', equation: '' },
            { name: 'policy_interventions', equation: '' },
            { name: 'economic_impact', equation: '' }
          ],
          relationships: [
            { from: 'disease_transmission', to: 'policy_interventions', polarity: '+' }
          ]
        }
      };

      const expectations = {
        expectedVariableGroups: [
          {
            name: "Group 1 - Complete",
            requiredVariables: ["disease transmission", "policy interventions"],
            requiredRelationships: [
              { from: "disease transmission", to: "policy interventions", polarity: "+" }
            ]
          },
          {
            name: "Group 2 - Missing elements", 
            requiredVariables: ["public trust", "vaccination rollout"],
            requiredRelationships: [
              { from: "public trust", to: "vaccination rollout", polarity: "+" }
            ]
          }
        ]
      };

      const failures = evaluate(generatedResponse, expectations);
      expect(failures).toHaveLength(1);
      expect(failures[0].type).toBe('Missing key variable group');
      expect(failures[0].details).toContain('Group 2 - Missing elements');
    });
  });
});