# Multi-Model Benchmark Guide

## Overview
This guide explains how to run comprehensive benchmarks across multiple local models (qwen 3.5, deepseek v3.2, kimi k2.5) to populate the leaderboard.

## Configuration Files Created

### 1. CLD (Causal Loop Diagrams) Benchmarks
**File**: [`evals/experiments/multi-model-leaderboard-cld.json`](evals/experiments/multi-model-leaderboard-cld.json)

**Engines tested per model**:
- qualitative
- causal-chains
- recursivecausal
- qualitative-zero

**Total configurations**: 12 (4 engines × 3 models)

**Run command**:
```bash
npm run evals -- -e evals/experiments/multi-model-leaderboard-cld.json
```

### 2. SFD (Stock & Flow Diagrams) Benchmarks
**File**: [`evals/experiments/multi-model-leaderboard-sfd.json`](evals/experiments/multi-model-leaderboard-sfd.json)

**Engines tested per model**:
- quantitative

**Total configurations**: 3 (1 engine × 3 models)

**Run command**:
```bash
npm run evals -- -e evals/experiments/multi-model-leaderboard-sfd.json
```

### 3. Discussion/Analysis Benchmarks
**File**: [`evals/experiments/multi-model-leaderboard-discuss.json`](evals/experiments/multi-model-leaderboard-discuss.json)

**Engines tested per model**:
- Seldon

**Total configurations**: 3 (1 engine × 3 models)

**Run command**:
```bash
npm run evals -- -e evals/experiments/multi-model-leaderboard-discuss.json
```

## Models Included

All configurations test these three local models:
1. **qwen3.5-397b-a17b** - Qwen 3.5 (397B parameters)
2. **deepseek-v3.2** - DeepSeek V3.2
3. **kimi-k2.5** - Kimi K2.5

## Sequential Execution Strategy

Since you can only run one model at a time in LM Studio, the benchmarks will automatically run sequentially:

1. **Start with CLD** (currently running in Terminal 1)
   - Tests all 4 engines on qwen 3.5
   - Then tests all 4 engines on deepseek v3.2
   - Finally tests all 4 engines on kimi k2.5

2. **Continue with SFD** (after CLD completes)
   ```bash
   npm run evals -- -e evals/experiments/multi-model-leaderboard-sfd.json
   ```

3. **Finish with Discussion** (after SFD completes)
   ```bash
   npm run evals -- -e evals/experiments/multi-model-leaderboard-discuss.json
   ```

## Results Location

All results are saved to:
- [`evals/results/leaderboard_local_full_results.json`](evals/results/leaderboard_local_full_results.json)

## Progress Monitoring

The terminal will show real-time progress:
- ✅ Green numbers = passed tests
- ❌ Red numbers = failed tests
- ETA = estimated time remaining
- Current engine and test names displayed

## Expected Runtime

With local LLMs and 5-minute timeouts:
- **CLD**: ~2-4 hours (53 tests × 12 configurations)
- **SFD**: ~30-60 minutes (varies by test count × 3 configurations)
- **Discussion**: ~30-60 minutes (varies by test count × 3 configurations)

**Total estimated time**: 3-6 hours for complete multi-model benchmarking

## Fixes Applied

All configurations benefit from these critical fixes:
1. ✅ Symbol comparison fix for model detection
2. ✅ Simplified message structure for local models
3. ✅ Extended timeouts (5 minutes) for local LLM processing
4. ✅ Proper parameter passing for quantitative engine
5. ✅ Jinja template error elimination

## Leaderboard Update

After all benchmarks complete, update the leaderboard:

```bash
# The results are automatically saved to leaderboard_local_full_results.json
# View results summary:
node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync('evals/results/leaderboard_local_full_results.json', 'utf8')); console.log('Total results:', data.results.length);"
```

## Troubleshooting

### If a benchmark stops or errors:
1. Check LM Studio is running and model is loaded
2. Verify no Google API key errors (should be eliminated with fixes)
3. Check for Jinja template errors (should be eliminated with Symbol comparison fix)
4. Restart the specific benchmark configuration

### To run individual model benchmarks:
Use the single-model configurations:
- [`evals/experiments/local-leaderboard-cld.json`](evals/experiments/local-leaderboard-cld.json) - qwen 3.5 only
- [`evals/experiments/qwen35-leaderboard-sfd.json`](evals/experiments/qwen35-leaderboard-sfd.json) - qwen 3.5 only
- [`evals/experiments/qwen35-leaderboard-discuss.json`](evals/experiments/qwen35-leaderboard-discuss.json) - qwen 3.5 only

## Next Steps After Completion

1. ✅ Verify all results in leaderboard_local_full_results.json
2. ✅ Analyze performance metrics across models
3. ✅ Compare local vs cloud model performance
4. ✅ Create git pull request with results
5. ✅ Generate performance comparison paper

## Notes

- The evaluation system automatically handles rate limiting
- Each model will be tested independently
- Failed tests are tracked and reported
- Conformance scores are calculated automatically
- All fixes ensure compatibility with LM Studio's prompt templates
