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

/**
 * Call the Quantitative Engine
 */
export async function callQuantitativeEngine(prompt, currentModel, parameters = {}) {
  try {

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

    const engine = new SeldonMentorEngine(parameters);

    const mentorParams = {
      ...parameters,
      ...(feedbackContent && { feedbackContent })
    };

    const beBrief = "\n\n**CRITICAL**\nBe brief in your response.";
    seldonParams.systemPrompt = SeldonEngineBrain.MENTOR_SYSTEM_PROMPT + beBrief 

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