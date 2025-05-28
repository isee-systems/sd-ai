import QuantitativeEngineBrain from './QuantitativeEngineBrain.js'

class Engine {
    constructor() {

    }

    static supportedModes() {
        return ["sfd"];
    }

    additionalParameters()  {
        return [{
            name: "googleKey",
            type: "string",
            required: true,
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
        }];
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let brain = new QuantitativeEngineBrain(parameters);
            const response = await brain.generateModel(prompt, currentModel);
            return {
                supportingInfo: {
                    explanation: response.explanation,
                    title: response.title
                },
                model: {
                    relationships: response.relationships,
                    variables: response.variables
                }
            };
        } catch(err) {
            console.error(err);
            return { 
                err: err.toString() 
            };
        }
    }
}

export default Engine;