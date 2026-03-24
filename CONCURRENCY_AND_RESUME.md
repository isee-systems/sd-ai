# Concurrency Control and Resume Functionality

## Overview

The benchmark system now supports two important features for local LLM testing:
1. **Controlled Concurrency**: Run multiple tests simultaneously (e.g., 2 at a time)
2. **Resume Functionality**: Pick up where tests left off after interruption

## Feature 1: Controlled Concurrency

### Problem
- **Fully sequential** (concurrency=1): Too slow, underutilizes LM Studio
- **Fully parallel** (concurrency=unlimited): Causes timeout cascade with 27-28 concurrent tests

### Solution
Run a controlled number of tests concurrently (e.g., 2 tests at a time) to balance speed and reliability.

### Configuration

Add `"concurrency": 2` to your experiment configuration:

```json
{
    "sequential": true,
    "concurrency": 2,
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
        }
    }
}
```

### Concurrency Levels

| Concurrency | Behavior | Use Case |
|-------------|----------|----------|
| `1` or `"sequential": true` | Fully sequential | Maximum reliability, slowest |
| `2` | 2 tests at a time | Balanced speed/reliability for local LLMs |
| `3-5` | 3-5 tests at a time | Faster, but may cause some timeouts |
| `undefined` or `>= total tests` | Fully parallel | Cloud APIs only, fastest |

### Implementation Details

**File**: [`evals/run.js`](evals/run.js:237-277)

```javascript
// Determine concurrency level
const concurrency = experiment.concurrency || (experiment.sequential ? 1 : engineTests.length);

if (concurrency === 1) {
  // Fully sequential execution
  testRuns = await engineTests.reduce(async (promise, test) => {
    const acc = await promise;
    const result = await runSingleTest(...);
    return [...acc, result];
  }, Promise.resolve([]));
} else if (concurrency >= engineTests.length) {
  // Fully parallel execution
  testRuns = await Promise.all(engineTests.map((test) => runSingleTest(...)));
} else {
  // Controlled concurrency execution
  testRuns = await runInBatches(engineTests, (test) => runSingleTest(...), concurrency);
}
```

**Helper**: [`evals/concurrencyHelper.js`](evals/concurrencyHelper.js)

The `runInBatches` function processes tests in batches:
- Batch size = concurrency level
- Each batch runs in parallel
- Batches run sequentially
- Results maintain original order

### Example Configurations

**Fully Sequential** (current default for local LLMs):
```json
{
    "sequential": true,
    "engineConfigs": { ... }
}
```

**2 Tests Concurrently** (recommended for local LLMs):
```json
{
    "sequential": true,
    "concurrency": 2,
    "engineConfigs": { ... }
}
```

**3 Tests Concurrently** (experimental):
```json
{
    "concurrency": 3,
    "engineConfigs": { ... }
}
```

### Performance Comparison

Assuming 8.5 seconds per test average:

| Concurrency | Time for 53 Tests | Speed Improvement |
|-------------|-------------------|-------------------|
| 1 (sequential) | ~7.5 minutes | Baseline |
| 2 (concurrent) | ~3.8 minutes | 2x faster |
| 3 (concurrent) | ~2.5 minutes | 3x faster (may have timeouts) |

### Usage

```bash
# Sequential execution (concurrency=1)
npm run evals -- -e evals/experiments/local-leaderboard-cld.json

# 2 tests concurrently
npm run evals -- -e evals/experiments/local-leaderboard-cld-concurrent2.json
```

## Feature 2: Resume Functionality

### Overview

The benchmark system automatically saves progress and can resume from where it left off if interrupted.

### How It Works

1. **Automatic Checkpointing**: Results are saved as tests complete
2. **Interruption Detection**: System detects incomplete runs on next start
3. **Resume Prompt**: Asks if you want to resume or start fresh
4. **Intelligent Merging**: Skips already-completed tests, runs only remaining tests

### File Naming

In-progress results are saved with a unique ID:
```
evals/results/local-leaderboard-cld_<unique-id>_in_progress.json
```

When complete, renamed to:
```
evals/results/local-leaderboard-cld_full_results.json
```

### Resume Workflow

**Step 1**: Start a benchmark
```bash
npm run evals -- -e evals/experiments/local-leaderboard-cld.json
```

**Step 2**: Interrupt with Ctrl+C (or crash/timeout)

**Step 3**: Restart the same benchmark
```bash
npm run evals -- -e evals/experiments/local-leaderboard-cld.json
```

**Step 4**: System detects in-progress file and prompts:
```
? Do you want to resume previous evaluation run? 
  Selecting no will discard previous in progress results. › (Y/n)
```

**Step 5**: Choose Yes to resume or No to start fresh

### Implementation Details

**File**: [`evals/run.js`](evals/run.js:59-82)

```javascript
if (matchingFiles.length > 0) {
    const response = await prompts({
      type: 'toggle',
      name: 'resume',
      message: 'Do you want to resume previous evaluation run? Selecting no will discard previous in progress results.',
      initial: true,
      active: 'yes',
      inactive: 'no'
    });
    isContinuing = response.resume;
    if (!isContinuing) {
      matchingFiles.forEach(f => {
        fs.unlinkSync(f);
      });
    }
}
```

**Result Merging**: [`evals/run.js`](evals/run.js:121-123)

```javascript
if (isContinuing) {
  console.log(`  will attempt to use ${previousResults.length} previously saved test results`);
}
```

The system:
1. Loads previous results
2. Compares with current test list
3. Skips tests that already have results
4. Runs only remaining tests
5. Merges old and new results

### Benefits

- **Save Time**: Don't re-run completed tests after interruption
- **Fault Tolerance**: Recover from crashes, timeouts, or manual stops
- **Iterative Testing**: Run a few tests, review, then continue
- **Cost Savings**: Don't waste API calls/compute on duplicate tests

### Multiple In-Progress Files

If multiple in-progress files exist:
```
Found multiple in progress experiment runs. 
Please delete all files you don't wish to resume from.
- evals/results/local-leaderboard-cld_abc123_in_progress.json
- evals/results/local-leaderboard-cld_def456_in_progress.json
```

**Solution**: Delete unwanted files manually, keep only the one you want to resume.

## Combined Usage

You can use both features together:

```json
{
    "sequential": true,
    "concurrency": 2,
    "engineConfigs": { ... }
}
```

**Workflow**:
1. Start benchmark with concurrency=2
2. Interrupt after some tests complete
3. Restart - system prompts to resume
4. Choose Yes - continues with concurrency=2 from where it left off

## Configuration Files

### Available Configurations

1. **Sequential (concurrency=1)**:
   - [`evals/experiments/local-leaderboard-cld.json`](evals/experiments/local-leaderboard-cld.json)
   - [`evals/experiments/local-leaderboard-sfd.json`](evals/experiments/local-leaderboard-sfd.json)
   - [`evals/experiments/local-leaderboard-discuss.json`](evals/experiments/local-leaderboard-discuss.json)

2. **Concurrent (concurrency=2)**:
   - [`evals/experiments/local-leaderboard-cld-concurrent2.json`](evals/experiments/local-leaderboard-cld-concurrent2.json)

### Creating Custom Configurations

Copy an existing configuration and modify:

```bash
cp evals/experiments/local-leaderboard-cld.json evals/experiments/my-custom-config.json
```

Edit `my-custom-config.json`:
```json
{
    "sequential": true,
    "concurrency": 2,  // Add this line
    "engineConfigs": { ... }
}
```

## Recommendations

### For Local LLMs (LM Studio)

**Start with concurrency=1** (fully sequential):
- Most reliable
- Establishes baseline performance
- Identifies any configuration issues

**Then try concurrency=2**:
- 2x faster
- Still manageable for single LM Studio instance
- Good balance of speed and reliability

**Avoid concurrency > 2** unless:
- You have multiple LM Studio instances
- You're using a very fast GPU
- You've tested and confirmed no timeout issues

### For Cloud APIs

**Use full parallelism** (no concurrency limit):
- Cloud APIs handle concurrent requests well
- Much faster completion
- Rate limiting handles load automatically

```json
{
    "engineConfigs": { ... }
    // No "sequential" or "concurrency" - defaults to full parallelism
}
```

## Troubleshooting

### Issue: Timeouts with concurrency=2

**Solution**: Reduce to concurrency=1 or increase timeout in [`utilities/LLMWrapper.js`](utilities/LLMWrapper.js:119)

### Issue: Resume not working

**Check**:
1. Are you using the exact same experiment file?
2. Is there an `_in_progress.json` file in `evals/results/`?
3. Did you choose "Yes" when prompted?

### Issue: Multiple in-progress files

**Solution**: Delete unwanted files:
```bash
rm evals/results/*_in_progress.json  # Delete all
# Or delete specific ones
rm evals/results/local-leaderboard-cld_abc123_in_progress.json
```

## Related Documentation

- [`SEQUENTIAL_EXECUTION_FIX.md`](SEQUENTIAL_EXECUTION_FIX.md) - Why sequential execution was needed
- [`LOCAL_LLM_BENCHMARKING.md`](LOCAL_LLM_BENCHMARKING.md) - Complete local LLM setup guide
- [`SYMBOL_COMPARISON_FIX.md`](SYMBOL_COMPARISON_FIX.md) - Model detection bug fix
- [`MULTI_MODEL_BENCHMARK_GUIDE.md`](MULTI_MODEL_BENCHMARK_GUIDE.md) - Multi-model pipeline guide
