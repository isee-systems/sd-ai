import SeldonILEUserBrain from './SeldonILEUserBrain.js'
import logger from '../../utilities/logger.js'

class Engine {
    constructor() {

    }

    static supportedModes() {
        return ["sfd-discuss", "cld-discuss"];
    }

    static description() {
        return ` This engine is used to help end users understand simulation results in plain language. It discusses
    the model and its behavior without System Dynamics jargon, making it accessible to users who don't have
    technical modeling expertise.`;
    }

    static link() {
        return "https://onlinelibrary.wiley.com/doi/abs/10.1002/sdr.70019";
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
            supportsComparative: true,
            required: false,
            uiElement: "hidden",
            label: "JSON Description of feedback loops",
            description: "A JSON object representing all of the feedback loops in the model"
        },{
            name: "currentRunName",
            type: "string",
            required: false,
            uiElement: "hidden",
            label: "Current Run Name",
            description: "The name of the current simulation run"
        }];
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let brain = new SeldonILEUserBrain(parameters);
            const response = await brain.converse(prompt, currentModel);
            return {
                output: response
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
