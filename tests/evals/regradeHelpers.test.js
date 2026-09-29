import path from 'path';
import { fileURLToPath } from 'url';
import { canonicalJson, findCurrentTest, regradeEligibility, categoryUsesLlmJudge, regradeRow } from '../../evals/regradeHelpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('regradeHelpers', () => {
    const currentTest = {
        name: 'Simple Pendulum',
        prompt: 'Build a pendulum',
        additionalParameters: { problemStatement: 'p' },
        expectations: { period: 2 }
    };
    const row = {
        engineConfigName: 'engine',
        category: 'physicalLaws',
        group: 'pendulum',
        name: 'Simple Pendulum',
        testParams: { name: 'Simple Pendulum', prompt: 'Build a pendulum', additionalParameters: { problemStatement: 'p' }, expectations: { period: 1 } },
        generatedResponse: { model: { variables: [] } },
        cost: { total: 0.5 },
        duration: 1000,
        generation: 'v2',
        failures: [{ type: 'Wrong period', details: 'x' }],
        failureSummary: { 'Wrong period': 1 },
        pass: false
    };

    test('canonicalJson ignores key order', () => {
        expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }));
    });

    test('finds the current test by group and name', () => {
        expect(findCurrentTest({ pendulum: [currentTest] }, row)).toBe(currentTest);
        expect(findCurrentTest({ other: [currentTest] }, row)).toBeUndefined();
    });

    test('allows a re-grade when only the expectations changed', () => {
        expect(regradeEligibility(row, currentTest).ok).toBe(true);
    });

    test('never re-grades a generation that failed', () => {
        const failed = { ...row, generatedResponse: { err: 'SDCodeError: component x is not defined' } };
        const result = regradeEligibility(failed, currentTest);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/generation failed/);
    });

    test('treats an empty field the engine added to the input model as no change', () => {
        const withModel = { ...currentTest, currentModel: { variables: [{ name: 'a' }] } };
        const stored = { ...row, testParams: { ...row.testParams, currentModel: { variables: [{ name: 'a' }], modules: [] } } };
        expect(regradeEligibility(stored, withModel).ok).toBe(true);
    });

    test('refuses a re-grade when the engine was asked something else', () => {
        const changed = { ...currentTest, prompt: 'Build a better pendulum' };
        const result = regradeEligibility(row, changed);
        expect(result.ok).toBe(false);
        expect(result.reason).toMatch(/re-run/);
        expect(regradeEligibility(row, undefined).ok).toBe(false);
        expect(regradeEligibility({ ...row, generatedResponse: undefined }, currentTest).ok).toBe(false);
    });

    test('keeps what the engine produced and replaces only the verdict', async () => {
        const { row: updated, changed } = await regradeRow(row, currentTest, async () => [], '2026-09-29');
        expect(changed).toBe(true);
        expect(updated.pass).toBe(true);
        expect(updated.failures).toEqual([]);
        expect(updated.failureSummary).toEqual({});
        expect(updated.testParams.expectations).toEqual({ period: 2 });
        expect(updated.regradedAt).toBe('2026-09-29');
        expect(updated.generatedResponse).toBe(row.generatedResponse);
        expect(updated.cost).toBe(row.cost);
        expect(updated.generation).toBe('v2');
    });

    test('leaves a row untouched when the verdict is the same', async () => {
        const { row: same, changed } = await regradeRow(row, currentTest, async () => row.failures, '2026-09-29');
        expect(changed).toBe(false);
        expect(same).toBe(row);
    });

    test('recognizes categories graded by an LLM judge', () => {
        const categories = path.join(__dirname, '../../evals/categories');
        expect(categoryUsesLlmJudge(path.join(categories, 'feedbackExplanation.js'))).toBe(true);
        expect(categoryUsesLlmJudge(path.join(categories, 'physicalLaws.js'))).toBe(false);
    });
});
