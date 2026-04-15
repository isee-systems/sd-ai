import logger from '../../utilities/logger.js';

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
    // Dynamically import the engine
    const { default: QuantitativeEngine } = await import('../../engines/quantitative/engine.js');

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
    const { default: QualitativeEngine } = await import('../../engines/qualitative/engine.js');

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
export async function callSeldonEngine(prompt, model, feedbackLoops, parameters = {}) {
  try {
    const { default: SeldonEngine } = await import('../../engines/seldon/engine.js');

    const engine = new SeldonEngine(parameters);

    // Prepare parameters for Seldon
    const seldonParams = {
      ...parameters,
      feedbackContent: feedbackLoops ? { feedbackLoops } : undefined
    };

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
    const { default: SeldonILEEngine } = await import('../../engines/seldon-ile-user/engine.js');

    const engine = new SeldonILEEngine(parameters);

    // Prepare parameters
    const seldonParams = {
      ...parameters,
      currentRunName: runName
    };

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
    const { default: DocumentationEngine } = await import('../../engines/generate-documentation/engine.js');

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
export async function callLTMEngine(model, feedbackLoops, parameters = {}) {
  try {
    const { default: LTMEngine } = await import('../../engines/ltm-narrative/engine.js');

    const engine = new LTMEngine(parameters);

    // LTM needs feedback loop content
    const ltmParams = {
      ...parameters,
      feedbackContent: { feedbackLoops }
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
export async function callSeldonMentorEngine(prompt, model, parameters = {}) {
  try {
    const { default: SeldonMentorEngine } = await import('../../engines/seldon-mentor/engine.js');

    const engine = new SeldonMentorEngine(parameters);

    const result = await engine.generate(prompt, model, parameters);

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

/**
 * Get list of available engines with their metadata
 */
export async function getAvailableEngines() {
  // Dynamically import all engines to get their metadata
  const { default: QuantitativeEngine } = await import('../../engines/quantitative/engine.js');
  const { default: QualitativeEngine } = await import('../../engines/qualitative/engine.js');
  const { default: SeldonEngine } = await import('../../engines/seldon/engine.js');
  const { default: SeldonILEEngine } = await import('../../engines/seldon-ile-user/engine.js');
  const { default: DocumentationEngine } = await import('../../engines/generate-documentation/engine.js');
  const { default: LTMEngine } = await import('../../engines/ltm-narrative/engine.js');
  const { default: SeldonMentorEngine } = await import('../../engines/seldon-mentor/engine.js');

  return [
    {
      name: 'generate_quantitative_model',
      displayName: 'Quantitative Model Generator',
      description: QuantitativeEngine.description(),
      modes: QuantitativeEngine.supportedModes(),
      wrapper: callQuantitativeEngine
    },
    {
      name: 'generate_qualitative_model',
      displayName: 'Qualitative Model Generator',
      description: QualitativeEngine.description(),
      modes: QualitativeEngine.supportedModes(),
      wrapper: callQualitativeEngine
    },
    {
      name: 'discuss_model_with_seldon',
      displayName: 'Seldon Expert Discussion',
      description: SeldonEngine.description(),
      modes: SeldonEngine.supportedModes(),
      wrapper: callSeldonEngine
    },
    {
      name: 'discuss_model_across_runs',
      displayName: 'Cross-Run Model Discussion',
      description: SeldonILEEngine.description(),
      modes: SeldonILEEngine.supportedModes(),
      wrapper: callSeldonILEEngine
    },
    {
      name: 'generate_documentation',
      displayName: 'Documentation Generator',
      description: DocumentationEngine.description(),
      modes: DocumentationEngine.supportedModes(),
      wrapper: callDocumentationEngine
    },
    {
      name: 'generate_ltm_narrative',
      displayName: 'LTM Narrative Generator',
      description: LTMEngine.description(),
      modes: LTMEngine.supportedModes(),
      wrapper: callLTMEngine
    },
    {
      name: 'discuss_with_mentor',
      displayName: 'Seldon Mentor Discussion',
      description: SeldonMentorEngine.description(),
      modes: SeldonMentorEngine.supportedModes(),
      wrapper: callSeldonMentorEngine
    }
  ];
}
