import express from 'express'
import fs from 'fs'
import path from 'path'
import utils from './../../utilities/utils.js'
import { ModelCapabilities, ModelType, LLMWrapper } from './../../utilities/LLMWrapper.js'
import logger from './../../utilities/logger.js'

const router = express.Router()

router.post("/:engine/generate", async (req, res) => {
    const enginePath = path.join(process.cwd(), 'engines', req.params.engine, 'engine.js');

    // Check if engine file exists
    if (!fs.existsSync(enginePath)) {
        return res.status(404).send({
            success: false,
            message: `Engine "${req.params.engine}" not found`
        });
    }

    const authenticationKey = process.env.AUTHENTICATION_KEY;
    const underlyingModel = req.body.underlyingModel || LLMWrapper.BUILD_DEFAULT_MODEL;
    const capabilities = new ModelCapabilities(underlyingModel);

    let hasApiKey = false;
    if (req.body.openAIKey && capabilities.kind === ModelType.OPEN_AI) {
      hasApiKey = true;
    } else if (req.body.googleKey && capabilities.kind === ModelType.GEMINI) {
      hasApiKey = true;
    } else if (req.body.anthropicKey && capabilities.kind == ModelType.CLAUDE) {
      hasApiKey = true;
    }

    if (!hasApiKey && authenticationKey) {
        if (!req.header('Authentication') || req.header('Authentication') !== authenticationKey) {
          return res.status(403).send({ "success": false, message: 'Unauthorized, please pass valid Authentication header.' });
        }
    }

    const importPath = process.platform === 'win32' ? `file://${enginePath}` : enginePath;
    const engine = await import(importPath);
    const instance = new engine.default();

    const prompt = req.body.prompt;
  
    const engineSpecificParameters = Object.fromEntries(Object.entries(req.body).filter(([k, v]) => {
       return ["prompt", "currentModel"].indexOf(k) == -1
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
  
    let generateResponse = await instance.generate(prompt, currentModel, engineSpecificParameters);
  
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