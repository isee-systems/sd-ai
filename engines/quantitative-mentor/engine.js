import QuantitativeEngineBrain from './../quantitative/QuantitativeEngineBrain.js'
import logger from '../../utilities/logger.js'

class Engine {
    constructor() {

    }

    static supportedModes() {
        return ["sfd"];
    }

    static description() {
        return `Based on SD-AI's original and most popular engine for generating simulating Stock Flow Diagrams (SFDs).  Quantitative-Mentor doesn't actually build the whole model for you.  It gives you enough to work with and encourages you to build the rest. 
Works by sending Google's Gemini Flash 2.5 LLM the user's request along with a set of systems thinking process descriptions and tips.`
    }

    static link() {
        return "";
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
        }];
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let brain = new QuantitativeEngineBrain(parameters);
            brain.mentor();
            
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