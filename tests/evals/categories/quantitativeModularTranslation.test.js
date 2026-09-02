import { evaluate } from '../../../evals/categories/quantitativeModularTranslation.js';

//a two module system where the second module draws on the first through a cross level ghost
const groundTruth = {
  timeUnit: 'day',
  stocks: [
    {
      name: 'frimbulators.count',
      initialValue: 20,
      inflows: [{ rate: 0.02, of: 'frimbulators' }],
      outflows: []
    },
    {
      name: 'priaries.count',
      initialValue: 100,
      inflows: [{ rate: 0.05, of: 'priaries.frimbulators count' }],
      outflows: []
    }
  ],
  variables: [
    { name: 'priaries.frimbulators count', crossLevelGhostOf: 'frimbulators.count' }
  ]
};

//builds the model an LLM would return, with every name run through the given renaming
const generateResponse = function(rename) {
  return {
    model: {
      specs: { timeUnits: 'day' },
      variables: [
        { type: 'stock', name: rename('frimbulators.count'), equation: '20', inflows: [rename('frimbulators.growth')], outflows: [] },
        { type: 'flow', name: rename('frimbulators.growth'), equation: rename('frimbulators.count') + ' * 0.02' },
        { type: 'stock', name: rename('priaries.count'), equation: '100', inflows: [rename('priaries.intake')], outflows: [] },
        { type: 'flow', name: rename('priaries.intake'), equation: rename('priaries.frimbulators count') + ' * 0.05' },
        { type: 'variable', name: rename('priaries.frimbulators count'), equation: rename('frimbulators.count'), crossLevelGhostOf: rename('frimbulators.count') }
      ],
      relationships: []
    }
  };
};

const identity = function(name) {
  return name;
};

describe('QuantitativeModularTranslation Evaluate', () => {
  describe('successful evaluations', () => {
    it('should return no failures when the AI response matches ground truth exactly', () => {
      expect(evaluate(generateResponse(identity), groundTruth)).toEqual([]);
    });
  });

  describe('pluralization tolerance', () => {
    //ground truth names are pluralized, both because the english pluralizes every noun and because
    //the prompt asks for pluralized module names, so the LLM may hand back either number
    const singularize = function(name) {
      return name.replace(/frimbulators/g, 'frimbulator').replace(/priaries/g, 'priary');
    };

    const regularize = function(name) {
      return name.replace(/priaries/g, 'priarys');
    };

    it('should accept singularized module names', () => {
      expect(evaluate(generateResponse(singularize), groundTruth)).toEqual([]);
    });

    it('should accept a regularized plural of an irregular noun', () => {
      expect(evaluate(generateResponse(regularize), groundTruth)).toEqual([]);
    });

    it('should accept a pluralized time unit', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.specs.timeUnits = 'days';
      expect(evaluate(generatedResponse, groundTruth)).toEqual([]);
    });
  });

  describe('failure detection', () => {
    it('should detect a module named after a different noun', () => {
      const rename = function(name) {
        return name.replace(/priaries/g, 'younjurings');
      };

      const failures = evaluate(generateResponse(rename), groundTruth);
      expect(failures.map((failure) => failure.type)).toEqual(
        expect.arrayContaining(['Fake stock found', 'Real stocks not found'])
      );
    });

    it('should detect a missing cross level ghost', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.variables = generatedResponse.model.variables.filter((variable) => {
        return variable.type !== 'variable';
      });

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Cross-level ghost variables not found');
    });

    it('should detect a ghost of the wrong variable', () => {
      const generatedResponse = generateResponse(identity);
      const ghost = generatedResponse.model.variables.find((variable) => { return variable.type === 'variable' });
      ghost.crossLevelGhostOf = 'younjurings.count';

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Cross-level ghost variables not found');
    });

    it('should detect an incorrect initial value', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.variables[0].equation = '999';

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Incorrect initial value discovered');
    });

    it('accepts an initial value written with a decimal point', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.variables[0].equation = '20.0';

      expect(evaluate(generatedResponse, groundTruth)).toEqual([]);
    });

    it('accepts a stock initialised from a named constant inside its own module', () => {
      // Naming the constant is the better modelling practice of the two, and in a modular
      // model the constant is module-qualified while the stock refers to it by the bare name
      // its module scope gives it. Compared as raw strings, every such stock failed.
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.variables[0].equation = 'initial_frimbulators';
      generatedResponse.model.variables.push({
        type: 'variable',
        name: 'frimbulators.initial_frimbulators',
        equation: '20'
      });

      expect(evaluate(generatedResponse, groundTruth)).toEqual([]);
    });

    it('still rejects a named constant holding the wrong value', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.variables[0].equation = 'initial_frimbulators';
      generatedResponse.model.variables.push({
        type: 'variable',
        name: 'frimbulators.initial_frimbulators',
        equation: '999'
      });

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Incorrect initial value discovered');
    });

    it('still rejects an equation naming a constant that does not exist', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.variables[0].equation = 'initial_frimbulators';

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Incorrect initial value discovered');
    });

    it('should detect an incorrect time unit', () => {
      const generatedResponse = generateResponse(identity);
      generatedResponse.model.specs.timeUnits = 'week';

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Incorrect time unit discovered');
    });

    it('should detect a flow which does not match its specification', () => {
      const generatedResponse = generateResponse(identity);
      const flow = generatedResponse.model.variables.find((variable) => { return variable.name === 'frimbulators.growth' });
      flow.equation = 'frimbulators.count * 0.99';

      const failures = evaluate(generatedResponse, groundTruth);
      expect(failures.map((failure) => failure.type)).toContain('Failed to find flow matching specification');
    });
  });
});
