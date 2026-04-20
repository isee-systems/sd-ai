import { z } from 'zod';

const EvaluationFailure = z.object({
  type: z.string(),
  details: z.string(),
});

const EvaluationResult = z.array(EvaluationFailure);

function validateEvaluationResult(result) {
  return EvaluationResult.parse(result);
}

async function withRetry(fn, { retries = 3, initialDelay = 2000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, initialDelay * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export { EvaluationFailure, EvaluationResult, validateEvaluationResult, withRetry };
