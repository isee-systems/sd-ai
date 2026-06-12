import logger from '../../utilities/logger.js';
import QuantitativeEngine from '../../engines/quantitative/engine.js';
import QualitativeEngine from '../../engines/qualitative/engine.js';
import SeldonEngine from '../../engines/seldon/engine.js';
import SeldonILEEngine from '../../engines/seldon-ile-user/engine.js';
import DocumentationEngine from '../../engines/generate-documentation/engine.js';
import SeldonMentorEngine from '../../engines/seldon-mentor/engine.js';
import LTMEngine from '../../engines/ltm-narrative/engine.js';
import SeldonEngineBrain from '../../engines/seldon/SeldonBrain.js';
import SeldonILEUserBrain from '../../engines/seldon-ile-user/SeldonILEUserBrain.js';

/**
 * EngineWrapper
 * Adapts existing SD-AI engines to be called as functions
 *
 * Provides a unified interface to call:
 * - Quantitative Engine (SFD generation)
 * - Qualitative Engine (CLD generation)
 * - Seldon (expert discussion)
 * - Seldon-ILE-User (user-friendly discussion)
 * - Generate Documentation
 * - LTM Narrative
 */

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * Every engine assembles an LLM request from a fixed set of inputs, and several
 * push the user prompt unconditionally. When the prompt is empty and nothing
 * else supplies content, the request collapses to a bare system instruction:
 * Gemini's SDK then throws a cryptic "contents are required" and other providers
 * reject the empty turn list too. The guards below catch that at the wrapper
 * boundary so the agent gets an actionable error it can recover from, rather
 * than a confusing failure from deep inside a provider SDK.
 *
 * Documentation and LTM are deliberately called with an empty prompt and already
 * self-guard inside their brains (a model with variables / valid feedback content
 * is required, and is always appended to the request), so they need no guard here.
 *
 * Generation engines (quantitative/qualitative) can build from a prompt, a
 * problem statement, background knowledge, or an existing model — require at
 * least one.
 */
export function assertGenerationInput(prompt, currentModel, parameters) {
  const hasModel = !!currentModel && ((currentModel.variables?.length > 0) || (currentModel.relationships?.length > 0));

  if (!hasText(prompt) && !hasText(parameters?.problemStatement) && !hasText(parameters?.backgroundKnowledge) && !hasModel) {
    throw new Error('A non-empty prompt is required (or a problem statement, background knowledge, or existing model to build from).');
  }
}

/**
 * Discussion engines (Seldon / Seldon-ILE / Seldon Mentor) answer a question
 * about a model, so they require a non-empty prompt — there is nothing to
 * discuss without one.
 */
export function assertDiscussionPrompt(prompt) {
  if (!hasText(prompt)) {
    throw new Error('A non-empty prompt (the question or topic to discuss) is required.');
  }
}

/**
 * Call the Quantitative Engine
 */
export async function callQuantitativeEngine(prompt, currentModel, parameters = {}) {
  try {
    assertGenerationInput(prompt, currentModel, parameters);

    // Create engine instance with parameters
    const engine = new QuantitativeEngine(parameters);

    // Call generate method
    const result = await engine.generate(prompt, currentModel, parameters);

    return {
      success: true,
      model: result.model,
      supportingInfo: result.supportingInfo
    };

  } catch (error) {
    logger.error('Quantitative Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Call the Qualitative Engine
 */
export async function callQualitativeEngine(prompt, currentModel, parameters = {}) {
  try {
    assertGenerationInput(prompt, currentModel, parameters);

    const engine = new QualitativeEngine(parameters);
    const result = await engine.generate(prompt, currentModel, parameters);

    return {
      success: true,
      model: result.model,
      supportingInfo: result.supportingInfo
    };

  } catch (error) {
    logger.error('Qualitative Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Call Seldon (expert discussion)
 */
export async function callSeldonEngine(prompt, model, feedbackContent, parameters = {}) {
  try {
    assertDiscussionPrompt(prompt);

    const engine = new SeldonEngine(parameters);

    const seldonParams = {
      ...parameters,
      ...(feedbackContent && { feedbackContent })
    };

    const beBrief = "\n\n**CRITICAL**\nBe brief in your response.";
    seldonParams.systemPrompt = SeldonEngineBrain.DEFAULT_SYSTEM_PROMPT + beBrief 

    const result = await engine.generate(prompt, model, seldonParams);

    return {
      success: true,
      output: result.output
    };

  } catch (error) {
    logger.error('Seldon Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Call Seldon-ILE-User (user-friendly discussion)
 */
export async function callSeldonILEEngine(prompt, model, runName, parameters = {}) {
  try {
    assertDiscussionPrompt(prompt);

    const engine = new SeldonILEEngine(parameters);

    // Prepare parameters
    const seldonParams = {
      ...parameters,
      currentRunName: runName
    };

    const beBrief = "\n\n**CRITICAL**\nBe brief in your response.";
    seldonParams.systemPrompt = SeldonILEUserBrain.DEFAULT_SYSTEM_PROMPT + beBrief 


    const result = await engine.generate(prompt, model, seldonParams);

    return {
      success: true,
      output: result.output
    };

  } catch (error) {
    logger.error('Seldon-ILE Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Call Generate Documentation Engine
 */
export async function callDocumentationEngine(model, parameters = {}) {
  try {

    const engine = new DocumentationEngine(parameters);

    // Documentation engine typically doesn't need a prompt
    const result = await engine.generate('', model, parameters);

    return {
      success: true,
      model: result.model,
      supportingInfo: result.supportingInfo
    };

  } catch (error) {
    logger.error('Documentation Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Call LTM Narrative Engine
 */
export async function callLTMEngine(model, feedbackContent, parameters = {}) {
  try {

    const engine = new LTMEngine(parameters);

    const ltmParams = {
      ...parameters,
      feedbackContent
    };

    const result = await engine.generate('', model, ltmParams);

    return {
      success: true,
      feedbackLoops: result.feedbackLoops,
      output: result.output
    };

  } catch (error) {
    logger.error('LTM Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Call Seldon Mentor Engine
 */
export async function callSeldonMentorEngine(prompt, model, feedbackContent, parameters = {}) {
  try {
    assertDiscussionPrompt(prompt);

    const engine = new SeldonMentorEngine(parameters);

    const mentorParams = {
      ...parameters,
      ...(feedbackContent && { feedbackContent })
    };

    const beBrief = "\n\n**CRITICAL**\nBe brief in your response.";
    mentorParams.systemPrompt = SeldonEngineBrain.MENTOR_SYSTEM_PROMPT + beBrief

    const result = await engine.generate(prompt, model, mentorParams);

    return {
      success: true,
      output: result.output
    };

  } catch (error) {
    logger.error('Seldon Mentor Engine error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}