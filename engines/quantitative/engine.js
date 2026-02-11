import QuantitativeEngineBrain from './QuantitativeEngineBrain.js'
import logger from '../../utilities/logger.js'

class Engine {
    constructor() {

    }

    static supportedModes() {
        return ["sfd"];
    }

    static description() {
        return `SD-AI's original and most popular engine for generating simulating Stock Flow Diagrams (SFDs). 
Works by sending Google's Gemini Flash 2.5 LLM the user's request along with a set of systems thinking process descriptions and tips.`
    }

    static link() {
        return "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=5341966";
    }

    additionalParameters()  {
        return [{
            name: "googleKey",
            type: "string",
            required: false,
            uiElement: "password",
            saveForUser: "global",
            label: "Google API Key",
            description: "Leave blank for the default, or your Google API key - XXXXXX"
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
            description: "Background information you want the LLM model to consider when generating a diagram for you",
            minHeight: 100
        },{
            name: "supportsArrays",
            type: "boolean",
            required: false,
            uiElement: "hidden",
            description: "Whether or not your client can handle arrayed models"
        },{
            name: "supportsModules",
            type: "boolean",
            required: false,
            uiElement: "hidden",
            description: "Whether or not your client can handle models with modules"
        }];
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let brain = new QuantitativeEngineBrain(parameters);
            const response = await brain.generateModel(prompt, currentModel);
            let returnValue = {
                supportingInfo: {
                    explanation: response.explanation,
                    title: response.title
                },
                model: {
                    relationships: response.relationships,
                    variables: response.variables
                }
            };
            if (response.specs)
                returnValue.model.specs = response.specs;
            return returnValue;
        } catch(err) {
            logger.error(err);
            return { 
                err: err.toString() 
            };
        }
    }
}

export default Engine;