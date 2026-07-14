import { evaluate, describeVariable } from '../../../evals/categories/variableDocumentation.js';

// These tests deliberately never reach the LLM quality judge. The evaluate() cases below
// either produce no model or contain at least one undocumented non-ghost variable, which is a
// coverage failure that short-circuits before any LLM call. describeVariable() is a pure
// string builder. Fully-documented models are intentionally not exercised here.
describe('variableDocumentation evaluate (deterministic, no LLM)', () => {
  it('reports "No model produced" when the response has no variables', async () => {
    const failures = await evaluate({}, { systemName: 'X', problemStatement: 'x' });
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe('No model produced');
  });

  it('reports missing documentation for an undocumented variable', async () => {
    const generatedResponse = { model: { variables: [
      { name: 'population', type: 'stock', equation: '100', documentation: 'The number of people.' },
      { name: 'births', type: 'flow', equation: 'population * 0.03', documentation: '' }
    ], relationships: [] } };

    const failures = await evaluate(generatedResponse, { systemName: 'Pop', problemStatement: 'pop' });
    expect(failures).toHaveLength(1);
    expect(failures[0].type).toBe('Missing documentation');
    expect(failures[0].details).toContain('births');
  });

  it('does not require documentation on ghost (crossLevelGhostOf) variables', async () => {
    // Modular model: a documented real var, an UNdocumented real var (which forces the early
    // coverage return, keeping us off the LLM), and two undocumented ghost variables. Only the
    // real undocumented variable may be reported; ghosts are cross-module reference copies and
    // are exempt from the documentation requirement.
    const generatedResponse = { model: { variables: [
      { name: 'Hares.Hares', type: 'stock', equation: '100', documentation: 'Hare population.' },
      { name: 'Hares.hare births', type: 'flow', equation: 'Hares.Hares * 0.1', documentation: '' },
      { name: 'Hares.Lynx', type: 'variable', crossLevelGhostOf: 'Lynx.Lynx', documentation: '' },
      { name: 'Lynx.hare density', type: 'variable', crossLevelGhostOf: 'Hares.hare density', documentation: '' }
    ], relationships: [] } };

    const failures = await evaluate(generatedResponse, { systemName: 'PredPrey', problemStatement: 'pp' });
    expect(failures).toHaveLength(1);
    expect(failures[0].details).toContain('Hares.hare births');
    expect(failures.some((f) => f.details.includes('Hares.Lynx'))).toBe(false);
    expect(failures.some((f) => f.details.includes('Lynx.hare density'))).toBe(false);
  });
});

describe('variableDocumentation describeVariable (structural rendering for the judge)', () => {
  const model = { relationships: [] };

  it('renders a scalar variable equation plainly', () => {
    const out = describeVariable(
      { name: 'birth rate', type: 'variable', equation: '0.03' },
      model
    );
    expect(out).toContain('Equation: 0.03');
    expect(out).not.toContain('Graphical function');
    expect(out).not.toContain('Arrayed over');
  });

  it('labels a graphical-function equation as the lookup input and lists its points', () => {
    const out = describeVariable(
      {
        name: 'attractiveness multiplier', type: 'variable', equation: 'Delivery_Delay_Ratio',
        graphicalFunction: { points: [{ x: 0, y: 1.5 }, { x: 1, y: 1 }, { x: 2, y: 0.4 }] }
      },
      model
    );
    expect(out).toContain('Graphical function input');
    expect(out).toContain('Delivery_Delay_Ratio');
    expect(out).toContain('(0, 1.5), (1, 1), (2, 0.4)');
    // It must not be presented as a plain closed-form equation.
    expect(out).not.toContain('Equation: Delivery_Delay_Ratio');
  });

  it('treats an empty graphicalFunction.points array as no graphical function', () => {
    const out = describeVariable(
      { name: 'k', type: 'variable', equation: '0.5', graphicalFunction: { points: [] } },
      model
    );
    expect(out).toContain('Equation: 0.5');
    expect(out).not.toContain('Graphical function');
  });

  it('renders arrayed dimensions and per-element equations', () => {
    const out = describeVariable(
      {
        name: 'sales', type: 'flow', dimensions: ['Product'],
        arrayEquations: [
          { forElements: ['Pizza'], equation: 'base_demand * 1.0' },
          { forElements: ['Kebab'], equation: 'base_demand * 0.8' }
        ]
      },
      model
    );
    expect(out).toContain('Arrayed over dimension(s): Product');
    expect(out).toContain('[Pizza] = base_demand * 1.0');
    expect(out).toContain('[Kebab] = base_demand * 0.8');
  });

  it('labels an apply-to-all arrayEquation (empty forElements)', () => {
    const out = describeVariable(
      { name: 'capacity', type: 'variable', dimensions: ['Region'], arrayEquations: [{ forElements: [], equation: '1000' }] },
      model
    );
    expect(out).toContain('[apply to all] = 1000');
  });
});
