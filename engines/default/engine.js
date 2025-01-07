import utils from './utils.js'
import OpenAIWrapper from './OpenAIWrapper.js'
import config from './config.js'

class Engine {
    constructor() {

    }

    additionalParameters()  {
        const models = [ 'gpt-4o-mini',
            'chatgpt-4o-latest', 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
            'o1-preview', 'o1-mini'
        ];

        return [{
                name: "openAIKey",
                type: "string",
                required: true,
                uiElement: "password",
                saveForUser: "global",
                label: "Open AI API Key",
                description: "Leave blank for the default, or your Open AI key - skprojectXXXXX"
            },{
                name: "openAIModel",
                type: "string",
                defaultValue: config.defaultModel,
                required: false,
                options: models.map(function(model) {
                    return {
                        label: model,
                        value: model,
                    };
                }),
                uiElement: "combobox",
                saveForUser: "local",
                label: "Open AI Model",
                description: "The OpenAI model that you want to use to process your queries."
            },{
                name: "promptSchemeId",
                type: "string",
                defaultValue: config.defaultPromptSchemeId,
                required: false,
                options: Object.keys(utils.promptingSchemes).map(function(scheme) {
                    return {
                        label: scheme,
                        value: scheme,
                    };
                }),
                uiElement: "combobox",
                saveForUser: "local",
                label: "Prompt Scheme",
                description: "The collection of templates you want your queries to use.  These templates instruct the OpenAI model how to respond to your queries."
            },{
                name: "backgroundKnowledge",
                type: "string",
                required: false,
                uiElement: "textarea",
                saveForUser: "local",
                label: "Background Knowledge",
                description: "Background information you want the OpenAI model to consider when generating a diagram for you"
            }
        ];
    }

    async generate(prompt, currentModel, session, parameters) {
        const openAIModel = parameters.openAIModel;
        const promptSchemeId = parameters.promptSchemeId;
        const openAIKey = parameters.openAIKey;
        const backgroundKnowledge = parameters.backgroundKnowledge;

        try {
            let wrapper = new OpenAIWrapper(openAIModel, promptSchemeId, backgroundKnowledge, openAIKey);
            const relationships = await wrapper.generateDiagram(prompt, currentModel);
            const variables =  [...new Set([...relationships.map( e => e.start),...relationships.map( e => e.end )])];
            return {
                success: true,
                relationships: relationships,
                variables: variables
            };
        } catch(err) {
            console.error(err);
            return { 
                success: false, 
                err: err.toString() 
            };
        }
    }
}

export default Engine;