import { LLMWrapper } from '../../utils.js';
import LTMNarrativeToolBrain from './LTMNarrativeToolBrain.js'
import logger from '../../logger.js'

class Engine {
    constructor() {

    }

    static role() {
        return "analyze";
    }

    static supportedModes() {
        return ["ltm-analyze"];
    }

    static description() {
        return ` This engine is used to automate the process of performing a Loops That Matter (LTM) feedback narrative construction process. It automates the Feedback Narrative cirriculum developed at the University of Bergen which can be downloaded here: https://proceedings.systemdynamics.org/2024/supp/S1041.zip`;    
    }

    static link() {
        return "https://proceedings.systemdynamics.org/2024/papers/O1041.pdf";
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
            description: "Background information you want the LLM model to consider when generating a model for you",
            minHeight: 100
        },{
            name: "behaviorContent",
            type: "string",
            required: false,
            uiElement: "textarea",
            label: "Behavioral Description",
            description: "Copy and paste the contents of a table from your model with the variables you want the AI to help you to understand the behavior of. Or give it a text description of your reference mode or any other behavioral elements related to your model",
            minHeight: 100,
            maxHeight: 100
        },{
            name: "feedbackContent",
            type: "feedbackJSON",
            required: false,
            uiElement: "hidden",
            label: "JSON Description of feedback loops",
            description: "A JSON array of feedback loops in the model"
        }];
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let brain = new LTMNarrativeToolBrain(parameters);
            const response = await brain.generate(prompt, currentModel);
            return {
                feedbackLoops: response.feedbackLoops,
                output: {
                    textContent: response.narrative
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