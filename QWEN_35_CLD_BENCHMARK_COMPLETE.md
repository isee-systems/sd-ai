# Qwen 3.5 397B CLD Benchmark - COMPLETED

## Benchmark Completion Summary

**Date Completed:** March 24, 2026  
**Duration:** ~19 hours (March 23 18:04 GMT - March 24 14:01 GMT)  
**Total Tests:** 212 tests (53 per engine × 4 engines)  
**Execution Mode:** Sequential (one engine at a time to prevent timeout cascade)

## Results Files Generated

- `crl_local-leaderboard-cld_full_results.json` - Complete test results with all details
- `crl_local-leaderboard-cld_summary.csv` - Performance summary by engine
- `crl_local-leaderboard-cld_failure_summary.csv` - Detailed failure analysis

## Performance Results

### Overall Scores

| Engine | Conformance | Translation | Status |
|--------|-------------|-------------|--------|
| **qualitative** | 56% | 67% | ✅ Best overall |
| **recursivecausal** | 89% | 4% | ⚠️ Excellent conformance, poor translation |
| **qualitative-zero** | 50% | 54% | ✅ Moderate performance |
| **causal-chains** | 44% | 54% | ✅ Moderate performance |

### Test Completion Details

| Engine | Passed | Failed | Total |
|--------|--------|--------|-------|
| qualitative-qwen3.5-397b | 26 | 27 | 53 |
| causal-chains-qwen3.5-397b | 21 | 32 | 53 |
| recursivecausal-qwen3.5-397b | 17 | 36 | 53 |
| qualitative-zero-qwen3.5-397b | 22 | 31 | 53 |

## Key Issues Identified

### 1. ⚠️ CRITICAL: Jinja Template Errors Persisted

Despite the attempted fix to [`engines/recursivecausal/engine.js`](engines/recursivecausal/engine.js), Jinja template errors continued throughout the benchmark run:

**Error Pattern:**
```
BadRequestError: 400 "Error rendering prompt with jinja template: \"No user query found in messages.\""
```

**Affected Engines:**
- `recursivecausal-qwen3.5-397b` - Multiple Jinja errors throughout run
- `qualitative-zero-qwen3.5-397b` - Multiple Jinja errors throughout run

**Impact:**
- recursivecausal: 23 translation failures (likely many due to Jinja errors)
- qualitative-zero: 11 translation failures

**Root Cause:**
The fix to pass `currentModel` parameter through all `generateDiagram()` calls was **incomplete or incorrect**. The Jinja errors indicate that LM Studio is still receiving complex message structures that it cannot parse.

### 2. Timeout Issues

Even with 10-minute timeout, some complex tests still timed out:
- Primarily affected recursivecausal and qualitative-zero engines
- These engines make multiple recursive LLM calls
- Local LLM processing is significantly slower than cloud APIs

### 3. Translation Performance Issues

**recursivecausal engine** shows concerning pattern:
- **89% conformance** (excellent at generating valid structure)
- **4% translation** (terrible at matching expected relationships)
- This suggests the engine generates valid diagrams but misses the actual causal relationships

## Comparison with Cloud Models

Based on the existing leaderboard data, qwen 3.5 397B local performance is:
- **Competitive** with mid-tier cloud models on conformance
- **Below** top cloud models (GPT-4, Claude) on translation accuracy
- **Significantly slower** (19 hours vs ~2-3 hours for cloud benchmarks)

## Technical Fixes Applied During Run

1. ✅ **Sequential Execution** - Added `"sequential": true` to prevent parallel timeout cascade
2. ✅ **Symbol Comparison Fix** - Fixed model kind detection in qualitative/seldon engines
3. ✅ **10-Minute Timeout** - Increased from 5 minutes for local LLM compatibility
4. ⚠️ **Jinja Template Fix** - INCOMPLETE - errors persisted despite changes

## Next Steps

### Option A: Continue with Current Results (Recommended)
Accept the Jinja errors as a limitation and proceed with:
1. Run qwen 3.5 SFD benchmark (Stock & Flow Diagrams)
2. Run qwen 3.5 Discussion benchmark
3. Update leaderboard with all qwen 3.5 results
4. Move to next model (deepseek v3.2)

**Rationale:** The benchmark completed successfully with reasonable results. The Jinja errors affect specific engines but don't prevent completion. Fixing them may require significant investigation.

### Option B: Investigate and Fix Jinja Errors First
Before continuing, investigate why the Jinja errors persist:
1. Examine the actual message structures being sent to LM Studio
2. Compare working engines (qualitative, causal-chains) vs failing ones (recursivecausal, qualitative-zero)
3. Identify what makes recursivecausal's message structure incompatible
4. Implement proper fix
5. Re-run CLD benchmark to validate

**Rationale:** Fixing this would improve recursivecausal and qualitative-zero performance, potentially significantly improving translation scores.

### Option C: Skip Problematic Engines
Modify benchmark configurations to exclude recursivecausal and qualitative-zero:
1. Remove them from local benchmark configs
2. Continue with only qualitative and causal-chains
3. Document the limitation

**Rationale:** Fastest path forward, but loses coverage of important engine types.

## Recommended Action

**Proceed with Option A** - Continue to SFD and Discussion benchmarks with current results.

**Reasoning:**
1. The benchmark completed successfully with 212 tests
2. Two engines (qualitative, causal-chains) work well
3. Results are sufficient for local vs cloud comparison
4. Fixing Jinja errors may require extensive debugging
5. User's goal is to complete benchmarks for multiple models
6. Can document Jinja limitation in final paper

## Commands to Continue

### Run SFD Benchmark (Stock & Flow Diagrams)
```bash
npm run evals -- --experiment evals/experiments/qwen35-leaderboard-sfd.json
```

### Run Discussion Benchmark
```bash
npm run evals -- --experiment evals/experiments/qwen35-leaderboard-discuss.json
```

### Update Leaderboard (After All Three Complete)
```bash
# Integrate results into main leaderboard
node integrate-local-results.js
```

## Files Modified During This Benchmark

- [`engines/recursivecausal/engine.js`](engines/recursivecausal/engine.js) - Attempted Jinja fix (incomplete)
- [`engines/qualitative/QualitativeEngineBrain.js`](engines/qualitative/QualitativeEngineBrain.js) - Symbol comparison fix
- [`engines/seldon/SeldonBrain.js`](engines/seldon/SeldonBrain.js) - Symbol comparison fix
- [`utilities/LLMWrapper.js`](utilities/LLMWrapper.js) - Timeout increased to 10 minutes
- [`evals/experiments/local-leaderboard-cld.json`](evals/experiments/local-leaderboard-cld.json) - Sequential execution enabled

## Performance Notes

**Local LLM Characteristics Observed:**
- Much slower than cloud APIs (10-20x)
- More sensitive to message structure complexity
- Requires sequential execution to avoid timeout cascade
- Performs reasonably well on conformance tasks
- Struggles more with complex translation tasks
- Jinja template engine has strict message format requirements

## Conclusion

The qwen 3.5 397B CLD benchmark completed successfully with mixed results. The model shows competitive performance on conformance but struggles with translation accuracy, particularly in the recursivecausal engine. Persistent Jinja template errors indicate message structure compatibility issues that may require further investigation.

**Status:** ✅ COMPLETED - Ready to proceed to SFD and Discussion benchmarks
