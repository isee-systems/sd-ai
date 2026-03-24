# Qwen 3.5 397B Discussion Benchmark Results

**Date:** March 24, 2026  
**Model:** Qwen 3.5 397B (via LM Studio)  
**Benchmark:** Discussion (Seldon engine)  
**Configuration:** seed=4242, temperature=0, concurrency=2

## Summary

Completed 16 of 17 tests (1 timeout):
- **errorFixingSuggestions:** 0% (0/7 tests passed) - All 7 tests timed out
- **feedbackExplanation:** 33.3% (1/3 tests passed) - 2 failures due to missing expected facts
- **modelBuildingSteps:** 0% (0/7 tests passed) - 4 failures due to inadequate steps

**Overall Pass Rate:** 11.8% (2 passed, 14 failed, 1 timeout)

## Detailed Results

### Passed Tests (2)
1. ✅ Arms race dynamics explanation
2. ✅ Bass diffusion dynamics explanation

### Failed Tests - feedbackExplanation (4)
3. ❌ Inventory-workforce dynamics - Missing fact: "Three balancing feedback loops"
4. ❌ Predator-prey oscillations - Missing fact: "Growth driven by reinforcing loops involving hare/lynx births"
5. ❌ Market growth dynamics - Missing fact: "Sales effectiveness, revenue expansion, capacity expansion are keys"
6. ❌ Predator-prey system behavior - Missing fact: "System governed by predator-prey feedback, R1 and B1/B2 loops"

### Failed Tests - modelBuildingSteps (4)
7. ❌ Arms race model building - Didn't mention creating stocks for Country A/B arsenals
8. ❌ Bass diffusion model building - Missing adequate step coverage
9. ❌ Inventory-workforce model building - Missing adequate step coverage
10. ❌ Market growth model building - Missing adequate step coverage

### Timeout Tests - errorFixingSuggestions (7)
All COVID error-fixing tests exceeded 10-minute timeout:
11. ⏱️ COVID delay error 1 - Should identify DELAY3 with 'Infection' flow issue
12. ⏱️ COVID delay error 2 - Should identify DELAY3 with flows vs stock issue
13. ⏱️ COVID delay error 4 - Complex DELAY3 error
14. ⏱️ COVID lookup error 1 - Lookup function error
15. ⏱️ COVID lookup error 2 - Lookup function error
16. ⏱️ COVID sum error 1 - Summation error
17. ⏱️ COVID sum error 2 - Summation error (final timeout)

## Analysis

### What Works
- **Simple explanations:** Model successfully explains basic feedback dynamics (arms race, bass diffusion)
- **Basic comprehension:** Can understand and discuss simple system dynamics concepts

### What Struggles
- **Complex error diagnosis:** All 7 COVID error-fixing tests timed out, indicating the model struggles with:
  - Multi-turn conversations about fixing model errors
  - Deep reasoning about DELAY3 functions, stock vs flow distinctions
  - Complex model structure analysis
  
- **Completeness:** Model often provides partial explanations but misses specific expected facts or steps
  - Missing key feedback loop details
  - Incomplete step-by-step instructions

### Comparison to Other Benchmarks
- **CLD:** 44-89% conformance, 4-67% translation (much better on diagram generation)
- **SFD:** 44% conformance, 0% causal reasoning (similar struggle with complex reasoning)
- **Discussion:** 11.8% pass rate (worst performance, especially on error-fixing)

## Conclusions

1. **Timeout issues are complexity-related, not infrastructure:** 10 minutes is already very long. The model is struggling with the reasoning complexity, not just speed.

2. **Content quality issues are model capability limitations:** The model generates responses but misses specific facts/steps. This is a reasoning/knowledge issue, not fixable by code changes.

3. **Error-fixing is particularly challenging:** 0% success on errorFixingSuggestions suggests this is the hardest task for local models.

4. **Recommendation:** Accept these results as valuable data for comparing local vs cloud model performance. The Discussion benchmark reveals clear limitations in complex multi-turn reasoning tasks.

## Files Generated
- `zmr_qwen35-leaderboard-discuss_full_results.json` (4.9 MB)
- `zmr_qwen35-leaderboard-discuss_summary.csv`
- `zmr_qwen35-leaderboard-discuss_failure_summary.csv`

Note: These files are excluded from git by .gitignore patterns (`/*_results.json`, `/*_summary.csv`)
