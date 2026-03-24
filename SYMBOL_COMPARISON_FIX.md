# Symbol Comparison Fix for Local Model Detection

## Issue Discovered
The Jinja template errors were persisting in the discussion benchmarks despite applying the simplified message structure fix to the Seldon engine and evaluation categories. The root cause was identified as incorrect model kind comparison logic.

## Root Cause
The `ModelType` enum in [`LLMWrapper.js`](utilities/LLMWrapper.js:8) uses JavaScript Symbols:

```javascript
export const ModelType = Object.freeze({
  GEMINI:   Symbol("Gemini"),
  OPEN_AI:  Symbol("OpenAI"),
  LLAMA: Symbol("Llama"),
  DEEPSEEK: Symbol("Deepseek"),
  CLAUDE: Symbol("Claude")
});
```

However, the code was comparing model kinds using **string literals** instead of **Symbol references**:

```javascript
// INCORRECT - String comparison
if (this.#llmWrapper.model.kind === 'LLAMA' || this.#llmWrapper.model.kind === 'DEEPSEEK') {
```

This caused the condition to always evaluate to `false`, meaning local models were never detected and always used the complex message structure that triggers Jinja template errors in LM Studio.

## Solution
Changed all model kind comparisons to use proper Symbol references:

```javascript
// CORRECT - Symbol comparison
if (this.#llmWrapper.model.kind === ModelType.LLAMA || this.#llmWrapper.model.kind === ModelType.DEEPSEEK) {
```

## Files Modified

### 1. [`engines/seldon/SeldonBrain.js`](engines/seldon/SeldonBrain.js)
- **Line 2**: Added `ModelType` to import statement
  ```javascript
  import { LLMWrapper, ModelType } from '../../utilities/LLMWrapper.js'
  ```
- **Line 189**: Fixed comparison to use Symbol references
  ```javascript
  if (this.#llmWrapper.model.kind === ModelType.LLAMA || this.#llmWrapper.model.kind === ModelType.DEEPSEEK) {
  ```

### 2. [`engines/qualitative/QualitativeEngineBrain.js`](engines/qualitative/QualitativeEngineBrain.js)
- **Line 1**: Added `ModelType` to import statement
  ```javascript
  import {LLMWrapper, ModelType} from "../../utilities/LLMWrapper.js";
  ```
- **Line 203**: Fixed comparison to use Symbol references
  ```javascript
  const isLocalModel = this.#llmWrapper.model.kind === ModelType.LLAMA || this.#llmWrapper.model.kind === ModelType.DEEPSEEK;
  ```

### 3. [`evals/categories/feedbackExplanation.js`](evals/categories/feedbackExplanation.js)
- **Line 15**: Added `ModelType` to import statement
  ```javascript
  import { LLMWrapper, ModelType } from '../../utilities/LLMWrapper.js';
  ```
- **Line 94**: Fixed comparison to use Symbol references
  ```javascript
  if (modelKind === ModelType.LLAMA || modelKind === ModelType.DEEPSEEK) {
  ```

## Verification
Created test script [`test-feedback-eval.js`](test-feedback-eval.js) to verify the fix:

**Before Fix:**
```
Model kind: Symbol(Llama)
Using original message structure for cloud model  ❌
```

**After Fix:**
```
Model kind: Symbol(Llama)
Using simplified message structure for local model  ✓
```

## Impact
This fix ensures that:
1. Local models (qwen, deepseek, llama, etc.) are correctly detected
2. Simplified message structures are used for local models
3. Jinja template errors are eliminated in LM Studio
4. Discussion benchmarks can now run successfully with local models
5. Evaluation categories properly handle local model responses

## Related Issues
- Original Jinja template error: "No user query found in messages"
- This was caused by LM Studio's prompt template expecting a specific message structure
- The simplified structure combines multiple messages into single user/system messages
- Without proper Symbol comparison, the simplified structure was never applied

## Testing
Run the verification test:
```bash
node test-feedback-eval.js
```

Expected output should show "Using simplified message structure for local model" and successfully complete without errors.

## Next Steps
With this fix applied:
1. ✅ Seldon engine will correctly detect local models
2. ✅ Qualitative engines will correctly detect local models  
3. ✅ Evaluation categories will correctly detect local models
4. ✅ Discussion benchmarks can proceed without Jinja template errors
5. ⏳ Complete qwen 3.5 SFD and Discussion benchmarks
6. ⏳ Proceed with multi-model benchmarking pipeline (deepseek v3.2, kimi k 2.5, etc.)
