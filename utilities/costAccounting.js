/**
 * Per-scope LLM cost accounting.
 *
 * Evals need to answer "what did this test cost?", and the spend is scattered: a
 * plain engine makes its own LLM calls, while an agent engine makes many — its own
 * conversation turns plus every engine it reaches through a tool, each with its own
 * LLMWrapper and its own TokenUsageReporter. Threading a total back up through all
 * of that would mean changing the return shape of every engine.
 *
 * Instead the caller opens a scope around the work and every reporter inside it
 * contributes, wherever it sits in the call tree. AsyncLocalStorage is what makes
 * that safe under the eval runner's default concurrency: each `generate()` runs in
 * its own context, so two tests in flight at once never mix their totals.
 *
 * Outside a scope every entry point here is a no-op, which is the production case —
 * nothing opens one, so serving a request costs exactly what it did before.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

/**
 * Record one LLM call against the active scope, if there is one.
 *
 * `cost` is null when no price could be established at all — in practice an
 * OpenRouter call whose response carried no `usage.cost`, since every other
 * provider falls back to default rates in pricing.js. Those calls are counted
 * separately rather than folded in as zero: a total that silently omits them
 * reads as "this was cheap" when the truth is "we don't know", and the two must
 * not look alike in a results file.
 *
 * @param {Object} params
 * @param {string} params.provider - Provider enum value from TokenUsageReporter
 * @param {string} params.model - Resolved model id the call was billed against
 * @param {number|null} params.cost - Total USD for the call, or null when unpriced
 */
export function recordCallCost({ provider, model, cost }) {
    const scope = storage.getStore();
    if (!scope) return;

    scope.calls += 1;
    const key = `${provider}/${model}`;
    const perModel = scope.byModel[key] ??= { calls: 0, cost: 0, unpricedCalls: 0 };
    perModel.calls += 1;

    if (typeof cost === 'number') {
        scope.totalCost += cost;
        perModel.cost += cost;
    } else {
        scope.unpricedCalls += 1;
        perModel.unpricedCalls += 1;
    }
}

/**
 * Run `fn` in a fresh accounting scope and return what it produced alongside the
 * bill for every LLM call it made.
 *
 * The accounting object is read after `fn` settles, so it covers everything that
 * was awaited. Work `fn` fired and did not await (a floating promise) may land
 * after this returns and is not guaranteed to be included — the caller has to
 * await what it wants counted, which every engine's `generate()` does.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<{value: T, accounting: {totalCost: number, calls: number, unpricedCalls: number, byModel: Object}}>}
 */
export async function withCostAccounting(fn) {
    const scope = { totalCost: 0, calls: 0, unpricedCalls: 0, byModel: {} };
    const value = await storage.run(scope, fn);
    return { value, accounting: scope };
}
