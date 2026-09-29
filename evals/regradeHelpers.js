/**
 * The pure parts of `evals/regrade.js`: deciding which published rows can be re-graded, and
 * re-grading one.
 *
 * A re-grade passes a row's stored `generatedResponse` back through its category's current
 * `evaluate()`. That is only honest when the engine was asked exactly what the current test
 * asks: a changed prompt, input model or background makes the stored response an answer to a
 * different question, and that row needs a re-run instead.
 */
import fs from 'fs';

/**
 * JSON with object keys sorted, so two values compare equal whatever order their keys were
 * written in.
 * @param {*} value Any JSON value
 * @returns {string} A canonical JSON string
 */
export function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

/**
 * Find the current definition of the test a row was produced by.
 * @param {Object} groups The category's exported `groups`
 * @param {Object} row A published result row
 * @returns {Object|undefined} The test, or undefined when the test no longer exists
 */
export function findCurrentTest(groups, row) {
    const tests = (groups && groups[row.group]) || [];
    return tests.find((test) => test.name === row.name);
}

/**
 * The inputs of a test that its engine saw. Expectations are left out: they are exactly what
 * a re-grade is allowed to change.
 * @param {Object} params A test definition or a row's stored `testParams`
 * @returns {string} Canonical JSON of the prompt, input model and additional parameters
 */
function testInputs(params) {
    return canonicalJson(withoutEmpty({
        prompt: params.prompt,
        currentModel: params.currentModel,
        additionalParameters: params.additionalParameters
    }));
}

/**
 * Drop empty arrays and objects, recursively. An engine writes defaults such as `modules: []`
 * onto the test object it is handed, so a stored row's input model can carry fields the test
 * definition leaves out, and a missing field and an empty one give the engine the same input.
 * @param {*} value Any JSON value
 * @returns {*} The value without empty arrays or objects
 */
function withoutEmpty(value) {
    if (Array.isArray(value)) return value.map(withoutEmpty);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            const cleaned = withoutEmpty(item);
            const empty = cleaned === undefined
                || (Array.isArray(cleaned) && cleaned.length === 0)
                || (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0);
            if (!empty) out[key] = cleaned;
        }
        return out;
    }
    return value;
}

/**
 * Whether a row can be re-graded against the current test, and if not, why.
 * @param {Object} row A published result row
 * @param {Object|undefined} currentTest The current definition of its test
 * @returns {{ok: boolean, reason: string}} The decision
 */
export function regradeEligibility(row, currentTest) {
    if (!currentTest) return { ok: false, reason: 'test no longer exists' };
    if (!row.generatedResponse || typeof row.generatedResponse !== 'object') {
        return { ok: false, reason: 'no stored response' };
    }
    // A generation that failed stored only its error. Grading that object would replace the
    // honest "Generation failed" with whatever the category makes of an empty answer.
    if (row.generatedResponse.err !== undefined) {
        return { ok: false, reason: 'the generation failed, so there is no response to grade' };
    }
    if (testInputs(row.testParams || {}) !== testInputs(currentTest)) {
        return { ok: false, reason: 'test inputs changed since the row was produced (needs a re-run)' };
    }
    return { ok: true, reason: '' };
}

/**
 * Whether a category's grading calls an LLM judge, read from its source. Re-grading such a
 * category spends AI calls and is not deterministic, so it happens only when asked for.
 * @param {string} categoryPath Path to the category module
 * @returns {boolean} True when the category uses an LLM judge
 */
export function categoryUsesLlmJudge(categoryPath) {
    return /\bLLMWrapper\b/.test(fs.readFileSync(categoryPath, 'utf8'));
}

/**
 * Re-grade one row, returning the updated row. Everything the engine produced (response,
 * cost, duration, generation) is kept; only the verdict and the expectations it was judged
 * against change.
 * @param {Object} row A published result row
 * @param {Object} currentTest The current definition of its test
 * @param {function(Object, Object): Promise<Array<Object>>} evaluate The category's evaluate()
 * @param {string} regradedAt The date to record on a row whose verdict changes
 * @returns {Promise<{row: Object, changed: boolean}>} The updated row, and whether the verdict changed
 */
export async function regradeRow(row, currentTest, evaluate, regradedAt) {
    const failures = await evaluate(row.generatedResponse, currentTest.expectations);
    const failureSummary = failures.reduce((acc, failure) => {
        acc[failure.type] = (acc[failure.type] || 0) + 1;
        return acc;
    }, {});
    const pass = failures.length === 0;
    const changed = pass !== Boolean(row.pass) || canonicalJson(failures) !== canonicalJson(row.failures || []);
    if (!changed) return { row, changed: false };
    return {
        row: {
            ...row,
            testParams: { ...row.testParams, expectations: currentTest.expectations },
            failures,
            failureSummary,
            pass,
            regradedAt
        },
        changed: true
    };
}
