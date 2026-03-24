# Sequential Execution Fix for Local LLM Benchmarks

## Problem

When running benchmarks with local LLMs via LM Studio, parallel execution caused severe timeout issues:

### Parallel Execution Issues
- **Engine-Level Parallelism**: All 4 engines ran concurrently using `Promise.all`
- **Test-Level Parallelism**: Within each engine, multiple tests ran in parallel (27-28 tests simultaneously)
- **Single LM Studio Instance**: All parallel requests hit the same LM Studio server on port 1234
- **Sequential Processing**: LM Studio processes requests one at a time, creating a queue
- **Timeout Cascade**: Tests waiting in the queue timed out before LM Studio could process them

### Observed Behavior
```
qualitative-qwen3.5-397b: 1 passed + 10 failed (timeouts) = 11 of 53
qualitative-zero-qwen3.5-397b: 3 passed + 8 failed (timeouts) = 11 of 53
causal-chains-qwen3.5-397b: 7 passed + 1 failed = 8 of 53
recursivecausal-qwen3.5-397b: 0 passed + 9 failed (timeouts) = 9 of 53
```

With 27-28 tests generating simultaneously, tests at the back of the queue would timeout even with a 10-minute timeout.

## Solution

The benchmark system supports a `"sequential": true` flag in experiment configurations that runs engines one at a time instead of in parallel.

### Code Location
File: [`evals/run.js`](evals/run.js:490-496)

```javascript
const output = experiment.sequential
  ? await Object.entries(tests).reduce(async (promise, engineEntry) => {
      const acc = await promise;
      const result = await runEngineTests(engineEntry);
      return [...acc, result];
    }, Promise.resolve([]))
  : await Promise.all(Object.entries(tests).map(runEngineTests));
```

### Configuration Changes

Added `"sequential": true` to all local LLM benchmark configurations:

1. **CLD Benchmarks**: [`evals/experiments/local-leaderboard-cld.json`](evals/experiments/local-leaderboard-cld.json)
2. **SFD Benchmarks**: [`evals/experiments/local-leaderboard-sfd.json`](evals/experiments/local-leaderboard-sfd.json)
3. **Discussion Benchmarks**: [`evals/experiments/local-leaderboard-discuss.json`](evals/experiments/local-leaderboard-discuss.json)
4. **Multi-Model CLD**: [`evals/experiments/multi-model-leaderboard-cld.json`](evals/experiments/multi-model-leaderboard-cld.json)
5. **Multi-Model SFD**: [`evals/experiments/multi-model-leaderboard-sfd.json`](evals/experiments/multi-model-leaderboard-sfd.json)
6. **Multi-Model Discussion**: [`evals/experiments/multi-model-leaderboard-discuss.json`](evals/experiments/multi-model-leaderboard-discuss.json)

Example configuration:
```json
{
    "sequential": true,
    "engineConfigs": {
        "qualitative-qwen3.5-397b": {
            "engine": "qualitative",
            "additionalParameters": {
                "underlyingModel": "qwen3.5-397b-a17b"
            },
            "limits": {
                "tokensPerMinute": 15000,
                "requestsPerMinute": 5,
                "baselineTokenUsage": 8000
            }
        },
        ...
    }
}
```

## Benefits

### Sequential Engine Execution
- **One Engine at a Time**: Engines run sequentially (qualitative → causal-chains → recursivecausal → qualitative-zero)
- **Reduced Queue Depth**: Only one engine's tests are in the LM Studio queue at a time
- **Better Timeout Management**: Tests are more likely to complete within the 10-minute timeout
- **Predictable Resource Usage**: Single LM Studio instance handles manageable load

### Expected Behavior
- Each engine completes all its tests before the next engine starts
- LM Studio processes requests from one engine at a time
- Timeout errors should be significantly reduced
- Progress is more linear and predictable

## Combined Fixes

This sequential execution fix works together with previous optimizations:

1. **10-Minute Timeout**: Increased from 5 to 10 minutes in [`utilities/LLMWrapper.js`](utilities/LLMWrapper.js:119)
2. **Symbol Comparison Fix**: Fixed model detection in 3 files (see [`SYMBOL_COMPARISON_FIX.md`](SYMBOL_COMPARISON_FIX.md))
3. **Simplified Messages**: Local models use simplified message structures to avoid Jinja errors
4. **Sequential Execution**: This fix - runs engines one at a time

## Usage

Run benchmarks with sequential execution:

```bash
# CLD benchmarks (qualitative engines)
npm run evals -- -e evals/experiments/local-leaderboard-cld.json

# SFD benchmarks (quantitative engine)
npm run evals -- -e evals/experiments/local-leaderboard-sfd.json

# Discussion benchmarks (Seldon engine)
npm run evals -- -e evals/experiments/local-leaderboard-discuss.json

# Multi-model pipeline (all 3 models)
npm run evals -- -e evals/experiments/multi-model-leaderboard-cld.json
```

## Performance Impact

### Trade-offs
- **Slower Total Time**: Sequential execution takes longer than parallel
- **Higher Success Rate**: Significantly fewer timeout errors
- **Better for Local LLMs**: Single LM Studio instance can't handle parallel load anyway
- **Optimal for Resource-Constrained Environments**: Perfect for local GPU-based inference

### Recommendation
Use `"sequential": true` for:
- Local LLM benchmarks via LM Studio
- Single API endpoint serving multiple models
- Resource-constrained environments
- Any scenario where parallel requests cause timeouts

Use parallel execution (default) for:
- Cloud API providers (OpenAI, Anthropic, Google)
- Multiple independent API endpoints
- High-throughput production environments
- When timeout errors are not occurring

## Related Documentation

- [`LOCAL_LLM_BENCHMARKING.md`](LOCAL_LLM_BENCHMARKING.md) - Complete local LLM setup guide
- [`SYMBOL_COMPARISON_FIX.md`](SYMBOL_COMPARISON_FIX.md) - Model detection bug fix
- [`MULTI_MODEL_BENCHMARK_GUIDE.md`](MULTI_MODEL_BENCHMARK_GUIDE.md) - Multi-model pipeline guide
- [`LM_STUDIO_FIX_SUMMARY.md`](LM_STUDIO_FIX_SUMMARY.md) - LM Studio compatibility fixes
