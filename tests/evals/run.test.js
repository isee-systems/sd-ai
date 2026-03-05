import {
  BASELINE_TOKEN_USAGE,
  TOKENS_PER_MINUTE,
  REQUESTS_PER_MINUTE,
  applyDefaultLimits,
  loadCategoryTests,
  buildTestEntry,
  loadTestsForEngine,
} from '../../evals/runHelpers.js';

describe('Run Helpers', () => {
  describe('applyDefaultLimits', () => {
    it('should apply all defaults when limits is missing', () => {
      const engineConfig = {};
      const result = applyDefaultLimits(engineConfig);

      expect(result.limits.tokensPerMinute).toBe(30000);
      expect(result.limits.requestsPerMinute).toBe(400);
      expect(result.limits.baselineTokenUsage).toBe(3000);
    });

    it('should apply all defaults when limits object exists but is empty', () => {
      const engineConfig = { limits: {} };
      const result = applyDefaultLimits(engineConfig);

      expect(result.limits.tokensPerMinute).toBe(30000);
      expect(result.limits.requestsPerMinute).toBe(400);
      expect(result.limits.baselineTokenUsage).toBe(3000);
    });

    it('should preserve specified values and fill in missing defaults', () => {
      const engineConfig = {
        limits: { tokensPerMinute: 50000 },
      };
      const result = applyDefaultLimits(engineConfig);

      expect(result.limits.tokensPerMinute).toBe(50000);
      expect(result.limits.requestsPerMinute).toBe(400);
      expect(result.limits.baselineTokenUsage).toBe(3000);
    });

    it('should not overwrite any specified limits', () => {
      const engineConfig = {
        limits: {
          tokensPerMinute: 25000,
          requestsPerMinute: 200,
          baselineTokenUsage: 5000,
        },
      };
      const result = applyDefaultLimits(engineConfig);

      expect(result.limits.tokensPerMinute).toBe(25000);
      expect(result.limits.requestsPerMinute).toBe(200);
      expect(result.limits.baselineTokenUsage).toBe(5000);
    });

    it('should preserve non-limits properties on the config', () => {
      const engineConfig = {
        engine: 'myEngine',
        additionalParameters: { temperature: 0.5 },
      };
      const result = applyDefaultLimits(engineConfig);

      expect(result.engine).toBe('myEngine');
      expect(result.additionalParameters).toEqual({ temperature: 0.5 });
      expect(result.limits.tokensPerMinute).toBe(30000);
    });

    it('should not mutate the input engineConfig', () => {
      const engineConfig = {
        engine: 'myEngine',
        limits: { tokensPerMinute: 50000 },
      };
      const snapshot = structuredClone(engineConfig);

      applyDefaultLimits(engineConfig);

      expect(engineConfig).toEqual(snapshot);
    });
  });

  describe('loadCategoryTests', () => {
    it('should return all groups when filter is true', () => {
      const groups = {
        groupA: ['test1', 'test2'],
        groupB: ['test3', 'test4'],
        groupC: ['test5'],
      };

      const result = loadCategoryTests(groups, true);

      expect(result).toBe(groups);
    });

    it('should return empty object when filter is false', () => {
      const groups = {
        groupA: ['test1', 'test2'],
        groupB: ['test3', 'test4'],
      };

      const result = loadCategoryTests(groups, false);

      expect(result).toEqual({});
    });

    it('should filter groups by array list of group names', () => {
      const groups = {
        groupA: ['test1', 'test2'],
        groupB: ['test3', 'test4'],
        groupC: ['test5'],
      };

      const result = loadCategoryTests(groups, ['groupA', 'groupC']);

      expect(result).toEqual({
        groupA: ['test1', 'test2'],
        groupC: ['test5'],
      });
    });

    it('should not include groups not in the filter array', () => {
      const groups = {
        groupA: ['test1'],
        groupB: ['test2'],
        groupC: ['test3'],
      };

      const result = loadCategoryTests(groups, ['groupA']);

      expect(result).toEqual({
        groupA: ['test1'],
      });
    });

    it('should not error if filter array contains nonexistent group names', () => {
      const groups = {
        groupA: ['test1'],
        groupB: ['test2'],
      };

      const result = loadCategoryTests(groups, ['groupA', 'groupNonexistent']);

      expect(result).toEqual({
        groupA: ['test1'],
      });
    });
  });

  describe('buildTestEntry', () => {
    it('should build test entry with all required fields', () => {
      const test = { name: 'test1', prompt: 'prompt text' };
      const engineConfig = { engine: 'gpt-4' };
      const engineConfigName = 'gpt4-config';
      const categoryName = 'translation';
      const groupName = 'groupA';

      const result = buildTestEntry(test, engineConfig, engineConfigName, categoryName, groupName);

      expect(result).toEqual({
        engineConfig,
        engineConfigName: 'gpt4-config',
        category: 'translation',
        group: 'groupA',
        testParams: test,
      });
    });

    it('should have exactly the expected keys', () => {
      const test = { name: 'test1' };
      const engineConfig = {};
      const result = buildTestEntry(test, engineConfig, 'config-name', 'category', 'group');

      const keys = Object.keys(result);
      expect(keys).toHaveLength(5);
      expect(keys).toEqual(['engineConfig', 'engineConfigName', 'category', 'group', 'testParams']);
    });
  });

  describe('loadTestsForEngine', () => {
    it('should flatten nested tests structure into array of test entries', () => {
      const allTests = {
        category1: {
          groupA: [
            { name: 'test1' },
            { name: 'test2' },
          ],
          groupB: [
            { name: 'test3' },
          ],
        },
        category2: {
          groupC: [
            { name: 'test4' },
            { name: 'test5' },
          ],
        },
      };
      const engineConfig = { engine: 'gpt-4' };
      const engineConfigName = 'gpt4-config';

      const result = loadTestsForEngine(allTests, engineConfig, engineConfigName);

      expect(result).toHaveLength(5);
      expect(result.every(entry => entry.engineConfigName === 'gpt4-config')).toBe(true);
      expect(result.every(entry => entry.engineConfig === engineConfig)).toBe(true);
    });

    it('should correctly map category, group, and testParams', () => {
      const allTests = {
        translation: {
          groupA: [
            { name: 'test1', prompt: 'translate this' },
          ],
        },
      };
      const engineConfig = { engine: 'claude' };

      const result = loadTestsForEngine(allTests, engineConfig, 'claude-config');

      expect(result[0].category).toBe('translation');
      expect(result[0].group).toBe('groupA');
      expect(result[0].testParams).toEqual({ name: 'test1', prompt: 'translate this' });
    });

    it('should return empty array for empty allTests', () => {
      const allTests = {};
      const engineConfig = { engine: 'gpt-4' };

      const result = loadTestsForEngine(allTests, engineConfig, 'gpt4-config');

      expect(result).toEqual([]);
    });

    it('should return empty array for categories with no groups', () => {
      const allTests = {
        category1: {},
        category2: {},
      };
      const engineConfig = { engine: 'gpt-4' };

      const result = loadTestsForEngine(allTests, engineConfig, 'gpt4-config');

      expect(result).toEqual([]);
    });

    it('should handle multiple categories and groups correctly', () => {
      const allTests = {
        category1: {
          groupA: [{ name: 'test1' }, { name: 'test2' }],
          groupB: [{ name: 'test3' }],
        },
        category2: {
          groupC: [{ name: 'test4' }],
          groupD: [{ name: 'test5' }, { name: 'test6' }],
        },
      };
      const engineConfig = { engine: 'gpt-4' };

      const result = loadTestsForEngine(allTests, engineConfig, 'config');

      expect(result).toHaveLength(6);

      const categories = new Set(result.map(e => e.category));
      expect(categories).toEqual(new Set(['category1', 'category2']));

      const groups = new Set(result.map(e => e.group));
      expect(groups).toEqual(new Set(['groupA', 'groupB', 'groupC', 'groupD']));
    });
  });
});
