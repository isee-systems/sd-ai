import {
  resultKey,
  validateResults,
  stampGeneration,
  mergeResults,
  summarizeByConfig,
} from '../../evals/collectHelpers.js';
import { DEFAULT_GENERATION } from '../../evals/leaderboardGenerations.js';

const row = (over = {}) => ({
  engineConfigName: 'quantitative-claude-opus-5',
  category: 'quantitativeTranslation',
  group: 'basic',
  testParams: { name: 'test A' },
  pass: true,
  ...over,
});

describe('resultKey', () => {
  it('ignores generation entirely', () => {
    // A leaderboard holds one current answer per test, so a v2 result must key onto the
    // v1 row it supersedes — including the untagged legacy rows, which are v1 by absence.
    expect(resultKey(row())).toBe(resultKey(row({ generation: DEFAULT_GENERATION })));
    expect(resultKey(row({ generation: 'v1' }))).toBe(resultKey(row({ generation: 'v2' })));
  });

  it('separates rows differing in any identifying field', () => {
    const base = resultKey(row());
    expect(resultKey(row({ engineConfigName: 'other' }))).not.toBe(base);
    expect(resultKey(row({ category: 'conformance' }))).not.toBe(base);
    expect(resultKey(row({ group: 'advanced' }))).not.toBe(base);
    expect(resultKey(row({ testParams: { name: 'test B' } }))).not.toBe(base);
  });
});

describe('validateResults', () => {
  it('accepts a well-formed result set', () => {
    expect(() => validateResults([row()], 'run.json')).not.toThrow();
  });

  it.each([
    ['engineConfigName', { engineConfigName: undefined }],
    ['category', { category: undefined }],
    ['group', { group: undefined }],
    ['testParams.name', { testParams: {} }],
  ])('rejects a set missing %s', (field, over) => {
    expect(() => validateResults([row(over)], 'run.json')).toThrow(new RegExp(field.split('.')[0]));
  });

  it('rejects a non-array and an empty array', () => {
    expect(() => validateResults(undefined, 'run.json')).toThrow(/results.*array/);
    expect(() => validateResults([], 'run.json')).toThrow(/no results/);
  });
});

describe('mergeResults', () => {
  it('appends a run into an empty leaderboard', () => {
    const incoming = stampGeneration([row(), row({ testParams: { name: 'test B' } })], 'v2');
    const merged = mergeResults([], incoming);

    expect(merged.results).toHaveLength(2);
    expect(merged.added).toBe(2);
    expect(merged.replaced).toBe(0);
    expect(merged.kept).toBe(0);
  });

  it('replaces a rerun row in place rather than appending a duplicate', () => {
    const existing = stampGeneration([row({ pass: false }), row({ testParams: { name: 'test B' } })], 'v2');
    const rerun = stampGeneration([row({ pass: true })], 'v2');

    const merged = mergeResults(existing, rerun);

    expect(merged.results).toHaveLength(2);
    expect(merged.added).toBe(0);
    expect(merged.replaced).toBe(1);
    expect(merged.kept).toBe(1);
    expect(merged.results[0].pass).toBe(true);
    // Position preserved so a diff of the published file shows the change, not a shuffle.
    expect(merged.results[0].testParams.name).toBe('test A');
  });

  it('overwrites an older generation\'s result for the same test', () => {
    const existing = stampGeneration([row({ pass: false })], 'v1');
    const incoming = stampGeneration([row({ pass: true })], 'v2');

    const merged = mergeResults(existing, incoming);

    expect(merged.results).toHaveLength(1);
    expect(merged.added).toBe(0);
    expect(merged.replaced).toBe(1);
    expect(merged.results[0].generation).toBe('v2');
    expect(merged.results[0].pass).toBe(true);
  });

  it('overwrites untagged legacy rows too', () => {
    // Legacy rows carry no generation field at all; they are v1 by absence and must be
    // superseded just the same, or the first v2 publish would duplicate every test.
    const existing = [row({ pass: false })];
    const merged = mergeResults(existing, stampGeneration([row({ pass: true })], 'v2'));

    expect(merged.results).toHaveLength(1);
    expect(merged.results[0].generation).toBe('v2');
    expect(merged.results[0].pass).toBe(true);
  });

  it('leaves a test the new generation did not re-run on its old result', () => {
    // The mixed state: partially re-running a board upgrades only what it covered.
    const existing = stampGeneration([row(), row({ testParams: { name: 'test B' } })], 'v1');
    const merged = mergeResults(existing, stampGeneration([row()], 'v2'));

    expect(merged.results).toHaveLength(2);
    expect(merged.results.map((r) => r.generation)).toEqual(['v2', 'v1']);
  });

  it('leaves other engine configs alone', () => {
    const existing = stampGeneration([row({ engineConfigName: 'other-engine' })], 'v2');
    const merged = mergeResults(existing, stampGeneration([row()], 'v2'));

    expect(merged.results).toHaveLength(2);
    expect(merged.kept).toBe(1);
  });

  describe('replaceConfigs', () => {
    it('drops stale rows for a config that dropped a category', () => {
      // The case a plain upsert cannot see: the rerun no longer covers 'conformance',
      // so without this the old conformance row survives as a stale score.
      const existing = stampGeneration([
        row(),
        row({ category: 'conformance', testParams: { name: 'test C' } }),
      ], 'v2');
      const rerun = stampGeneration([row({ pass: false })], 'v2');

      const merged = mergeResults(existing, rerun, { replaceConfigs: true });

      expect(merged.results).toHaveLength(1);
      expect(merged.removed).toBe(2);
      expect(merged.results[0].category).toBe('quantitativeTranslation');
      expect(merged.results[0].pass).toBe(false);
    });

    it('clears the config across every generation', () => {
      // The config is being republished wholesale, so leftovers from any generation are
      // stale by definition — including ones this run did not re-measure.
      const existing = [
        ...stampGeneration([row({ testParams: { name: 'test B' } })], 'v1'),
        ...stampGeneration([row({ category: 'conformance' })], 'v2'),
      ];
      const merged = mergeResults(existing, stampGeneration([row()], 'v2'), { replaceConfigs: true });

      expect(merged.results).toHaveLength(1);
      expect(merged.removed).toBe(2);
      expect(merged.results[0].generation).toBe('v2');
    });

    it('leaves engine configs the run does not mention', () => {
      const existing = stampGeneration([row({ engineConfigName: 'untouched' }), row()], 'v2');
      const merged = mergeResults(existing, stampGeneration([row({ pass: false })], 'v2'), {
        replaceConfigs: true,
      });

      expect(merged.results).toHaveLength(2);
      expect(merged.results.some((r) => r.engineConfigName === 'untouched')).toBe(true);
    });
  });

  it('collapses duplicate keys within one malformed run', () => {
    const incoming = stampGeneration([row({ pass: true }), row({ pass: false })], 'v2');
    const merged = mergeResults([], incoming);

    expect(merged.results).toHaveLength(1);
    expect(merged.added).toBe(1);
    expect(merged.results[0].pass).toBe(false); // last wins
  });

  it('does not mutate the inputs', () => {
    const existing = stampGeneration([row()], 'v2');
    const incoming = stampGeneration([row({ pass: false })], 'v2');
    const snapshot = JSON.stringify({ existing, incoming });

    mergeResults(existing, incoming, { replaceConfigs: true });

    expect(JSON.stringify({ existing, incoming })).toBe(snapshot);
  });
});

describe('summarizeByConfig', () => {
  it('reports pass counts and cost per config per generation', () => {
    const results = [
      ...stampGeneration([
        row({ pass: true, cost: { total: 1, reusedGeneration: false } }),
        row({ pass: false, testParams: { name: 'test B' }, cost: { total: 2, reusedGeneration: false } }),
      ], 'v2'),
      ...stampGeneration([row({ pass: true, testParams: { name: 'test C' } })], 'v1'),
    ];

    const summary = summarizeByConfig(results);
    const entry = summary.get('quantitative-claude-opus-5');

    // One entry per config, with the generation mix broken out inside it.
    expect(entry).toMatchObject({ tests: 3, passes: 2, cost: 3, hasCost: true });
    expect(entry.byGeneration).toEqual({ v1: 1, v2: 2 });
  });

  it('excludes rows that reused a sibling generation from the cost total', () => {
    // Those rows carry a copy of the originator's cost; summing them would bill one
    // engine call once per sibling.
    const results = stampGeneration([
      row({ cost: { total: 5, reusedGeneration: false } }),
      row({ testParams: { name: 'test B' }, cost: { total: 5, reusedGeneration: true } }),
    ], 'v2');

    expect(summarizeByConfig(results).get('quantitative-claude-opus-5').cost).toBe(5);
  });
});
