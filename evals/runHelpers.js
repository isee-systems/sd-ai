const BASELINE_TOKEN_USAGE = 3000;
const TOKENS_PER_MINUTE = 30_000;
const REQUESTS_PER_MINUTE = 400;

function applyDefaultLimits(engineConfig) {
  const limits = {
    tokensPerMinute: TOKENS_PER_MINUTE,
    requestsPerMinute: REQUESTS_PER_MINUTE,
    baselineTokenUsage: BASELINE_TOKEN_USAGE,
    ...engineConfig.limits,
  };
  return { ...engineConfig, limits };
}

function loadCategoryTests(groups, filter) {
  if (filter === true) return groups;
  if (filter === false) return {};
  return Object.fromEntries(
    Object.entries(groups).filter(([groupName, _]) => {
      return filter.includes(groupName);
    })
  );
}

function buildTestEntry(test, engineConfig, engineConfigName, categoryName, groupName) {
  return {
    engineConfig,
    engineConfigName,
    category: categoryName,
    group: groupName,
    testParams: test,
  };
}

function loadTestsForEngine(allTests, engineConfig, engineConfigName) {
  return Object.entries(allTests).flatMap(([categoryName, groups]) => {
    return Object.entries(groups).flatMap(([groupName, tests]) => {
      return tests.map((test) => buildTestEntry(test, engineConfig, engineConfigName, categoryName, groupName));
    });
  });
}

// Backoff, scoped per engine config. A retrying test's siblings are pointed at the same
// provider, so backing one test off politely while the other thirty keep calling at full
// rate is exactly what turns a single 429 into a wave of them. Holding the whole config
// gives the provider real quiet time, and leaves every other config running at full speed.
function createEngineBackoff() {
  const until = new Map();

  return {
    // Extends an existing hold rather than shortening it: two tests failing at once should
    // leave the config paused for the longer of the two delays.
    hold(engineConfigName, ms) {
      const deadline = Date.now() + ms;
      if (deadline > (until.get(engineConfigName) ?? 0)) {
        until.set(engineConfigName, deadline);
      }
    },

    // Loops rather than sleeping once, because a concurrent failure can push the hold
    // further out while this caller is already waiting on it. Costs nothing on a healthy
    // config: with no hold recorded the first check falls through without awaiting.
    async wait(engineConfigName) {
      for (;;) {
        const remaining = (until.get(engineConfigName) ?? 0) - Date.now();
        if (remaining <= 0) return;
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }
    },
  };
}

export {
  BASELINE_TOKEN_USAGE,
  TOKENS_PER_MINUTE,
  REQUESTS_PER_MINUTE,
  applyDefaultLimits,
  loadCategoryTests,
  buildTestEntry,
  loadTestsForEngine,
  createEngineBackoff,
};
