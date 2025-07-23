import QualitativeEngineBrain from './QualitativeEngineBrain.js'
import logger from '../../logger.js'

class Engine {
    constructor() {

    }

    static description() {
        return `SD-AI's original and most popular engine for generating Causal Loop Diagrams (CLDs). 
        Works by sending Google's Gemini Flash 2.5 LLM the user's request along with a set of systems thinking process descriptions and tips.`
    }

    static link() {
        return "https://arxiv.org/abs/2503.15580";
    }

    static supportedModes() {
        return ["cld"];
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
            let brain = new QualitativeEngineBrain(parameters);
            const response = await brain.generateDiagram(prompt, currentModel);
            const variables =  [...new Set([...response.relationships.map( e => e.from),...response.relationships.map( e => e.to )])].map((v)=> {
                return {
                    name: v,
                    type: "variable"
                };
            });
            return {
                supportingInfo: {
                    explanation: response.explanation,
                    title: response.title
                },
                model: {
                    relationships: response.relationships,
                    variables: variables
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