import { z } from 'zod';

const EvaluationFailure = z.object({
  type: z.string(),
  details: z.string(),
});

const EvaluationResult = z.array(EvaluationFailure);

function validateEvaluationResult(result) {
  return EvaluationResult.parse(result);
}

export { EvaluationFailure, EvaluationResult, validateEvaluationResult };
