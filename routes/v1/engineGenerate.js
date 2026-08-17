import express from 'express'
import path from 'path'
import utils from './../../utilities/utils.js'
import { ModelCapabilities, ModelType, LLMWrapper } from './../../utilities/LLMWrapper.js'
import logger from './../../utilities/logger.js'
import GenerateMetricsReporter from './../../utilities/GenerateMetricsReporter.js'
import config from './../../config.js'
import { engineNames } from './engineRegistry.js'

const router = express.Router()
const reporter = new GenerateMetricsReporter(config.metricsReporterURL)

// The bring-your-own-key parameters, paired with the model kind each one covers.
// A request carrying its own credentials runs on the caller's account, so it is
// allowed past AUTHENTICATION_KEY — that is the intended product behaviour.
const CLIENT_CREDENTIAL_PARAMS = [
    { name: 'openAIKey',     kind: ModelType.OPEN_AI },
    { name: 'googleKey',     kind: ModelType.GEMINI },
    { name: 'anthropicKey',  kind: ModelType.CLAUDE },
    { name: 'openRouterKey', kind: ModelType.OPEN_ROUTER },
    { name: 'deepseekKey',   kind: ModelType.DEEPSEEK },
];

/**
 * Is the caller genuinely paying for this request with their own key?
 *
 * The waiver is only sound while every engine reads its credentials under these
 * exact names, because that is what makes "the client sent openAIKey" equivalent
 * to "the client's key will be used". causal-chains broke that equivalence by
 * naming its parameter `apiKey`: the route saw `openAIKey`, waived
 * authentication, and the engine — finding no `apiKey` — fell back to
 * `process.env.OPENAI_API_KEY`, spending the operator's credits on an
 * unauthenticated request. It has been renamed to match.
 *
 * The invariant that keeps this true is enforced by
 * tests/routes/v1/engineCredentialNames.test.js, which fails CI if any engine
 * declares a credential parameter outside this set. Checking
 * additionalParameters() here instead would be wrong: that list is what the
 * client UI renders, and several engines (qualitative, for one) advertise only
 * the key for their default model while LLMWrapper still honours every name in
 * CLIENT_CREDENTIAL_PARAMS regardless.
 *
 * Pairing each name with a kind is what keeps the waiver honest across the two
 * ways one vendor can be reached. A namespaced slug ('deepseek/deepseek-v4-pro')
 * is kind OPEN_ROUTER and is paid for with openRouterKey; the bare id
 * ('deepseek-v4-pro') is kind DEEPSEEK and is paid for with deepseekKey. Sending
 * the wrong one of the pair waives nothing, because the request would still run
 * on the server's key for the route it actually takes.
 *
 * The key's *value* is not verified. An invalid one simply 401s upstream, which
 * costs the operator nothing — the failure mode that matters is a valid request
 * silently running on server credentials, and that is what the naming invariant
 * rules out.
 */
function suppliesOwnCredentials(req) {
    const underlyingModel = req.body.underlyingModel || LLMWrapper.BUILD_DEFAULT_MODEL;
    const { kind } = new ModelCapabilities(underlyingModel);

    return CLIENT_CREDENTIAL_PARAMS.some(param =>
        param.kind === kind && typeof req.body[param.name] === 'string' && req.body[param.name].length > 0
    );
}

router.post("/:engine/generate", async (req, res) => {
    // Allowlist, not existsSync on a caller-built path — see engineRegistry.js.
    if (!engineNames().has(req.params.engine)) {
        return res.status(404).send({
            success: false,
            message: `Engine "${req.params.engine}" not found`
        });
    }

    const authenticationKey = process.env.AUTHENTICATION_KEY;
    if (authenticationKey && !suppliesOwnCredentials(req)) {
        if (!req.header('Authentication') || req.header('Authentication') !== authenticationKey) {
          return res.status(403).send({ "success": false, message: 'Unauthorized, please pass valid Authentication header or provide a valid API key.' });
        }
    }

    const enginePath = path.join(process.cwd(), 'engines', req.params.engine, 'engine.js');
    const importPath = process.platform === 'win32' ? `file://${enginePath}` : enginePath;
    const engine = await import(importPath);
    const instance = new engine.default();

    const prompt = req.body.prompt;
  
    // `source` names the agent a call was made for in the token usage report, and
    // this route is by definition not one: everything else in the body is forwarded
    // to the engine verbatim, so without dropping it a caller could bill their
    // /generate traffic to whichever agent they named.
    const engineSpecificParameters = Object.fromEntries(Object.entries(req.body).filter(([k, v]) => {
       return ["prompt", "currentModel", "source"].indexOf(k) == -1
    }));

    instance.additionalParameters().forEach((param) => {
      let uncastedValue = engineSpecificParameters[param.name];
      let castedValue = uncastedValue;
      if (uncastedValue) { //if the uncasted value is not defined skip it... only cast defined values to the proper type
        switch (param.type) {
          case "number":
            castedValue = Number(uncastedValue);
            break;

          case "boolean":
            castedValue = Boolean(uncastedValue);
            break;

          case "string":
            castedValue = uncastedValue.toString();
            break;
        }

        engineSpecificParameters[param.name] = castedValue;
      }
    });

    let currentModel = {variables: [], relationships: []};
    if ('currentModel' in req.body) {
      currentModel = req.body.currentModel
    }

    // Track timing for reporter
    const startTime = Date.now();
    let generateResponse = await instance.generate(prompt, currentModel, engineSpecificParameters);
    const duration = Date.now() - startTime;

    // Report metrics
    reporter.report({
      engine: req.params.engine,
      underlyingModel: req.body.underlyingModel || null,
      duration: duration
    }).catch(err => {
      // Don't let reporting errors affect the main response
      console.error('Reporter error:', err);
    });
  
    if (generateResponse.err) {
      return res.send({
        success: false,
        message: "Request failed: " + generateResponse.err
      })
    }
  
    let response = {
      success: true
    };

    if ('model' in generateResponse) {
      response.model = generateResponse.model;
    }
    
    if ('output' in generateResponse) {
      response.output = generateResponse.output;
    }

    if ('feedbackLoops' in generateResponse) {
      response.feedbackLoops = generateResponse.feedbackLoops;
    }

    if ('supportingInfo' in generateResponse) {
      response.supportingInfo = generateResponse.supportingInfo
    }

    const isDebugging = typeof v8debug === 'object';
    if (isDebugging) {
      logger.log(response);
    }
  
    return res.send(response)
})

export default router;