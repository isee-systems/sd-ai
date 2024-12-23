import utils from './utils.js'
import OpenAIWrapper from './OpenAIWrapper.js'

export function additionalParameters()  {
    const models = [ 'gpt-4o-mini',
        'chatgpt-4o-latest', 'gpt-4o', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo',
        'o1-preview', 'o1-mini'
    ];
    return { 
        openAIModel: `type=string, default='gpt-4o-mini', options are <${models.join("|")}>`,
        promptSchemeId: `type=string default='default', options are <${Object.keys(utils.promptingSchemes).join("|")}>`,
        openAIAPI: "type=string default='<HIDDEN>', Your OpenAI API Key should look like sk-project-XXXXX"
    };
}

export async function generate(prompt, currentModel, parameters) {
    const promptSchemeId = parameters.promptSchemeId;
    const openAIModel = parameters.openAIModel;
    const openAIAPI = parameters.openAIAPI; 
    try {
        let wrapper = new OpenAIWrapper({ openAIAPI, openAIModel, promptSchemeId });
        const relationships = await wrapper.generateDiagram(prompt, currentModel);
        const variables =  [...new Set([...relationships.map( e => e.start),...relationships.map( e => e.end )])]
        return {
            relationships,
            variables
        }
    } catch(err) {
        console.error(err);
        return { err: err.toString() };
    }
}