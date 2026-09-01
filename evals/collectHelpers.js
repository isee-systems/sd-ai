/**
 * Merge logic for folding an eval run into a leaderboard file.
 *
 * A leaderboard is rarely produced by one execution: engines get added over time, a
 * config errors out and is rerun on its own, a new category is backfilled across
 * everything, and a new generation of the benchmark re-measures what an older one
 * already covered. So the published file is built up rather than written once, and this
 * is the part that decides what a new run does to what is already there.
 */
import { generationOf } from './leaderboardGenerations.js';

/**
 * Identity of a single test result: one test, for one engine config.
 *
 * Deliberately NOT keyed on generation. A leaderboard holds one current answer per
 * test, so re-running a test under v2 REPLACES its v1 row rather than sitting beside
 * it — the newer measurement is simply the better one. What the generation tag does is
 * record which version of the benchmark produced the row that survived, so the site can
 * label the rows still carrying older numbers.
 *
 * Group is part of the key because a category may reuse a test name across groups.
 */
export function resultKey(row) {
    return JSON.stringify([
        row.engineConfigName,
        row.category,
        row.group,
        row.testParams?.name,
    ]);
}

/**
 * Fields a row needs before it can be keyed or rendered. A file missing them is far
 * more likely to be the wrong file than a corrupt one, so this is checked up front
 * rather than surfacing later as an undefined in the published leaderboard.
 */
export function validateResults(results, label) {
    if (!Array.isArray(results)) {
        throw new Error(`${label}: expected a "results" array`);
    }
    if (results.length === 0) {
        throw new Error(`${label}: contains no results`);
    }
    results.forEach((row, i) => {
        for (const field of ['engineConfigName', 'category', 'group']) {
            if (!row?.[field]) {
                throw new Error(`${label}: result ${i} is missing "${field}" — is this an eval results file?`);
            }
        }
        if (!row.testParams?.name) {
            throw new Error(`${label}: result ${i} is missing "testParams.name" — is this an eval results file?`);
        }
    });
}

/** Stamp every row with the generation it is being published into. */
export function stampGeneration(results, generationId) {
    return results.map((row) => ({ ...row, generation: generationId }));
}

/**
 * Fold one run's results into an existing leaderboard.
 *
 * Default is a per-row upsert: a row the run produced replaces the matching row, a row
 * it didn't touch is left alone. That is what makes rerunning a single engine config,
 * or backfilling one new category, safe against a published file.
 *
 * `replaceConfigs` first drops every existing row for each engine config the run
 * mentions, whatever generation produced it. Use it when the rerun is meant to be the
 * whole truth for those configs — a config that dropped a category would otherwise keep
 * its stale rows for it, which an upsert alone cannot detect.
 *
 * Order is preserved: surviving rows keep their positions and genuinely new rows are
 * appended, so a diff of the published file shows the change rather than a reshuffle.
 *
 * @returns {{results: Array, added: number, replaced: number, removed: number, kept: number}}
 */
export function mergeResults(existing, incoming, { replaceConfigs = false } = {}) {
    let survivors = existing;
    if (replaceConfigs) {
        const targeted = new Set(incoming.map((r) => r.engineConfigName));
        survivors = existing.filter((r) => !targeted.has(r.engineConfigName));
    }
    const removed = existing.length - survivors.length;

    const byKey = new Map();
    for (const row of survivors) byKey.set(resultKey(row), row);
    const survivorKeys = new Set(byKey.keys());

    let added = 0;
    let replaced = 0;
    const appended = [];
    for (const row of incoming) {
        const key = resultKey(row);
        if (survivorKeys.has(key)) {
            replaced += 1;
        } else if (!byKey.has(key)) {
            // New to the file. Two incoming rows sharing a key means the run itself is
            // malformed; the Map keeps the last and it is counted once.
            added += 1;
            appended.push(key);
        }
        byKey.set(key, row);
    }

    const results = [
        ...survivors.map((r) => byKey.get(resultKey(r))),
        ...appended.map((key) => byKey.get(key)),
    ];

    return { results, added, replaced, removed, kept: survivors.length - replaced };
}

/**
 * Per-engine-config view of a result set, for the before/after the CLI prints.
 *
 * Generation is a breakdown within a config rather than part of its identity: because a
 * newer result overwrites an older one, a config that has only been partly re-run holds
 * a mix, and that mix is exactly what an operator needs to see to know what is left to
 * re-run. Cost is summed the way the rest of the pipeline does it — originator rows
 * only, since siblings that reused a generation carry a copy of its cost.
 */
export function summarizeByConfig(results) {
    const byConfig = new Map();
    for (const row of results) {
        const entry = byConfig.get(row.engineConfigName)
            ?? { engineConfigName: row.engineConfigName, tests: 0, passes: 0, cost: 0, hasCost: false, byGeneration: {} };
        entry.tests += 1;
        if (row.pass) entry.passes += 1;
        const gen = generationOf(row);
        entry.byGeneration[gen] = (entry.byGeneration[gen] ?? 0) + 1;
        if (row.cost) {
            entry.hasCost = true;
            if (!row.cost.reusedGeneration) entry.cost += row.cost.total;
        }
        byConfig.set(row.engineConfigName, entry);
    }
    return byConfig;
}

/** Categories present in a result set. */
export function categoriesIn(results) {
    return new Set(results.map((r) => r.category));
}
