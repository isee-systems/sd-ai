import GenerateDocumentationBrain from './GenerateDocumentationBrain.js'
import {LLMWrapper} from "../../utilities/LLMWrapper.js";
import logger from "../../utilities/logger.js";


class Engine {
    constructor() {

    }

    static supportedModes() {
        return ["documentation"];
    }

    static description() {
        return `This engine generates comprehensive documentation for all variables in a model. It uses structured output to create consistent, well-formatted documentation that describes the purpose, behavior, and role of each variable within the model.`;
    }

    additionalParameters()  {
        let parameters = LLMWrapper.additionalParameters(LLMWrapper.NON_BUILD_DEFAULT_MODEL);
        
        return parameters.concat([{
            name: "documentConnectors",
            type: "boolean",
            required: false,
            uiElement: "checkbox",
            saveForUser: "local",
            label: "Document Connectors",
            description: "Whether or not you want to generate documentation for connectors",
        },{
            name: "generatePolarity",
            type: "boolean",
            required: false,
            uiElement: "checkbox",
            saveForUser: "local",
            label: "Update Polarity",
            description: "Whether or not you want to generate polarity symbols for connectors",
        },{
            name: "problemStatement",
            type: "string",
            required: false,
            uiElement: "textarea",
            saveForUser: "local",
            label: "Problem Statement",
            description: "Description of a dynamic issue within the system you are studying that highlights an undesirable behavior over time.",
            minHeight: 50,
            maxHeight: 100
        },{
            name: "backgroundKnowledge",
            type: "string",
            required: false,
            uiElement: "textarea",
            saveForUser: "local",
            label: "Background Knowledge",
            description: "Background information you want the LLM model to consider when generating a model for you",
            minHeight: 100
        }]);
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let brain = new GenerateDocumentationBrain(parameters);
            const response = await brain.generate(prompt, currentModel);
            return {
                model: response.model,
                supportingInfo: {
                    explanation: response.explanation,
                    title: response.title
                }
            };
        } catch(err) {
            logger.error(err);
            return {
                err: err.toString()
            };
        }
    }
}

export default Engine;
