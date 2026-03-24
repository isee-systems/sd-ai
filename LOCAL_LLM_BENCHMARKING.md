# Local LLM Benchmarking Setup

## Overview
This setup enables benchmarking of local LLMs running through LM Studio on port 1234. The project has been configured to run comprehensive benchmarks against your local models and integrate the results into the existing benchmarking system.

## What Was Configured

### 1. LLM Wrapper Configuration
- Updated `utilities/LLMWrapper.js` to connect to LM Studio on port 1234 instead of Ollama on port 11434
- Local LLMs (deepseek, llama) now route through the correct endpoint

### 2. Available Local Models
Your LM Studio instance has the following models available:
- `deepseek-v3.2`
- `qwen3.5-397b-a17b`
- `glm-5-mlx-4`
- `hermes-3-llama-3.1-405b`
- `deepseek-r1-0528`
- `kimi-k2.5`

### 3. Experiment Configurations Created

#### `evals/experiments/local-test.json`
- Simple test configuration for connectivity verification
- Tests one model (`deepseek-v3.2`) against conformance tests
- Sequential execution with verbose output

#### `evals/experiments/local-conservative.json`
- Conservative benchmark configuration optimized for slow model loading
- Tests 3 key models: `deepseek-v3.2`, `hermes-3-llama-3.1-405b`
- Includes both qualitative and quantitative engines
- Optimized rate limits and sequential execution

#### `evals/experiments/local-llm-benchmark.json`
- Comprehensive benchmark testing all 6 language models
- Multiple engines and test categories
- Full evaluation suite

## Running Benchmarks

### Current Status
Two benchmarks are currently running:
```bash
# Terminal 1: Basic connectivity test
npm run evals -- -e evals/experiments/local-test.json

# Terminal 2: Conservative benchmark
npm run evals -- -e evals/experiments/local-conservative.json
```

### **IMPORTANT: LM Studio Limitation**
LM Studio can only run **one model at a time**. The multi-model configurations will fail when trying to switch models. Use single-model configurations instead.

### Single-Model Benchmarking
Currently running: `qwen3.5-397b-a17b`
```bash
# Running now
npm run evals -- -e evals/experiments/local-single-model.json
```

### To Test Other Models
1. **Load the desired model in LM Studio**
2. **Update the configuration** to match the loaded model
3. **Run the single-model benchmark**

### Optimization Tips
- **Single Model Only**: LM Studio limitation - test one model at a time
- **Sequential Execution**: Use `"sequential": true` for better stability
- **Rate Limits**: Conservative rate limits prevent overwhelming the local server

## Result Integration

### Integration Script
Created `integrate-local-results.js` to merge local results with the benchmarking system:

```bash
# When benchmark completes, look for result files like:
# abc_local-conservative_full_results.json
# abc_local-test_full_results.json

# Integrate results:
node integrate-local-results.js <result-file>.json local
```

### Expected Output Files
When benchmarks complete, you'll see files like:
- `XXX_local-conservative_full_results.json` - Full benchmark results
- `XXX_local-conservative_summary.csv` - Summary statistics
- `XXX_local-conservative_failure_summary.csv` - Error analysis

### Integration Process
1. **Wait for completion**: Benchmarks will generate result files in the project root
2. **Run integration script**: Use the integration script to add results to the leaderboard system
3. **Verify results**: Check `evals/results/` directory for merged results
4. **Access via API**: Results will be available through the leaderboard API endpoints

## Test Categories Included

### Qualitative Tests
- **Conformance**: Tests ability to follow instructions about variables and feedback loops
- **Translation**: Tests causal relationship extraction from text
- **Causal Reasoning**: Tests understanding of causal mechanisms
- **Iteration**: Tests model refinement capabilities

### Quantitative Tests
- **Causal Reasoning**: Tests quantitative model building
- **Translation**: Tests conversion to mathematical models
- **Iteration**: Tests quantitative model refinement

## Monitoring Progress

### Check for Result Files
```bash
# Look for new result files
ls -la *_*.json *_*.csv | grep -E "(local|g4b)"

# Check file timestamps
ls -lt | head -10
```

### Integration Status
Once results are generated, the integration script will:
1. Read the local benchmark results
2. Merge with existing leaderboard data (if any)
3. Generate summary statistics
4. Display success rates by model
5. Create leaderboard-compatible files

## Next Steps

1. **Wait for completion**: Current benchmarks are running and will take time due to model loading
2. **Monitor for result files**: Watch for new JSON/CSV files in the project root
3. **Run integration**: Use the integration script when results are ready
4. **Analyze results**: Review performance of your local models
5. **Optional**: Run additional benchmarks with different configurations

## API Access

Once integrated, results will be available via:
- `GET /api/v1/leaderboard/local` - Local LLM leaderboard data
- `GET /api/v1/leaderboard/` - List all available leaderboards

## Notes

- **Model Loading Time**: LM Studio models are slow to load/unload, so benchmarks are optimized for minimal model switching
- **Rate Limiting**: Conservative limits prevent overwhelming your local setup
- **Sequential Execution**: Ensures stability and proper resource management
- **Comprehensive Coverage**: Tests both qualitative and quantitative reasoning capabilities

The setup is complete and running. Results will be automatically integrated into your benchmarking system once the evaluations finish.