# LM Studio Structured Output Fix

## Problem Identified
When using structured output (Zod schemas) with LM Studio's OpenAI-compatible API, the JSON response was being placed in the `reasoning_content` field instead of the `content` field, causing ResponseFormatError in the SD-AI evaluation system.

## Root Cause
LM Studio's implementation differs from OpenAI's API in how it handles structured output requests:
- **OpenAI**: Places structured JSON in `message.content` or `message.parsed`
- **LM Studio**: Places structured JSON in `message.reasoning_content`, leaves `message.content` empty

## Solution
Modified [`utilities/LLMWrapper.js`](utilities/LLMWrapper.js:493-503) `#createOpenAIChatCompletion` method to detect this LM Studio behavior and automatically move the JSON content from `reasoning_content` to `content` for LLAMA-type models when using structured output.

```javascript
// Handle LM Studio quirk: when using structured output, it puts JSON in reasoning_content instead of content
if (this.model.kind === ModelType.LLAMA && zodSchema && message.reasoning_content && (!message.content || message.content.trim() === '')) {
  // For LM Studio, move reasoning_content to content when using structured output
  message.content = message.reasoning_content;
}
```

## Testing
- Verified qwen model detection works correctly (LLAMA type)
- Confirmed LM Studio response format compatibility
- Tested structured output fix resolves ResponseFormatError
- Ready for full benchmark execution with improved GPU settings

## Files Modified
1. [`utilities/LLMWrapper.js`](utilities/LLMWrapper.js) - Added LM Studio structured output compatibility
2. [`engines/qualitative-zero/engine.js`](engines/qualitative-zero/engine.js) - Fixed parameter handling bug
3. [`evals/experiments/local-single-model.json`](evals/experiments/local-single-model.json) - Created single-model config
4. [`LM_STUDIO_CONFIG.md`](LM_STUDIO_CONFIG.md) - Configuration guide for optimal settings

This fix enables the SD-AI evaluation system to properly benchmark local LLMs running in LM Studio with structured output requirements.