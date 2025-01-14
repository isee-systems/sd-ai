import OpenAIWrapper from './OpenAIWrapper.js'

class Engine {
    constructor() {

    }

    additionalParameters()  {
        return [{
                name: "openAIKey",
                type: "string",
                required: true,
                uiElement: "password",
                saveForUser: "global",
                label: "Open AI API Key",
                description: "Leave blank for the default, or your Open AI key - skprojectXXXXX"
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
                description: "Background information you want the OpenAI model to consider when generating a diagram for you",
                minHeight: 100
            }
        ];
    }

    async generate(prompt, currentModel, parameters) {
        try {
            let wrapper = new OpenAIWrapper(parameters);
            const response = await wrapper.generateDiagram(prompt, currentModel);
            const variables =  [...new Set([...response.relationships.map( e => e.from),...response.relationships.map( e => e.to )])];
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
            console.error(err);
            return { 
                err: err.toString() 
            };
        }
    }
}

export default Engine;