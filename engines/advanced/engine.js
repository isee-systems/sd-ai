import OpenAIWrapper from './../default/OpenAIWrapper.js'
import Engine from './../default/engine.js'

class AdvancedEngine extends Engine {
    static SYSTEM_PROMPT_DESC = 
`
An system prompt is a predefined instruction or set of instructions provided to guide the behavior, style, or functionality of a language model during a conversation. This prompt sets the tone, context, and boundaries for how the AI should interact with the user.

Key Features of a System Prompt:

1. Behavior Definition:
It specifies the role the AI should take. For example: "You are an AI assistant." or "You are a helpful tutor for physics concepts."

2. Scope and Boundaries:
It defines what the AI can or cannot do. For instance: "Stick to verified information."

3. Context Initialization:
It provides context for the conversation, such as introducing a fictional scenario, setting up a task, or clarifying the AI's expertise.

4. User Experience Shaping:
It ensures the AI’s responses align with the intended user experience, such as focusing on clarity, brevity, or detail.
`

    constructor() {
        super();
    }

    additionalParameters()  {
        const models = [ 
            {label: "GPT-4o", value: 'gpt-4o'}, 
            {label: "GPT-4o-mini", value: 'gpt-4o-mini'}, 
            {label: "GPT-4.5-preview", value: 'gpt-4.5-preview'}, 
            {label: "GPT-4.1", value: 'gpt-4.1'}, 
            {label: "GPT-4.1-mini", value: 'gpt-4.1-mini'}, 
            {label: "GPT-4.1-nano", value: 'gpt-4.1-nano'}, 
            {label: "Gemini 2.5-flash", value: 'gemini-2.5-flash-preview-04-17'},
            {label: "Gemini 2.5-pro", value: 'gemini-2.5-pro-preview-03-25'},
            {label: "Gemini 2.0", value: 'gemini-2.0-flash'},
            {label: "Gemini 2.0-Lite", value: 'gemini-2.0-flash-lite'},
            {label: "Gemini 1.5", value: 'gemini-1.5-flash'},
            {label: "o1", value: 'o1'}, 
            {label: "o3-mini low", value: 'o3-mini low'}, 
            {label: "o3-mini medium", value: 'o3-mini medium'}, 
            {label: "o3-mini high", value: 'o3-mini high'},
            {label: "o4-mini", value: 'o4-mini'}
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
                name: "googleKey",
                type: "string",
                required: true,
                uiElement: "password",
                saveForUser: "global",
                label: "Google API Key",
                description: "Leave blank for the default, or your Google API key - XXXXXX"
            },{
                name: "underlyingModel",
                type: "string",
                defaultValue: OpenAIWrapper.DEFAULT_MODEL,
                required: false,
                options: models,
                uiElement: "combobox",
                saveForUser: "local",
                label: "LLM Model",
                description: "The LLM model that you want to use to process your queries."
            },{
                name: "systemPrompt",
                type: "string",
                defaultValue: OpenAIWrapper.DEFAULT_SYSTEM_PROPMT,
                required: false,
                uiElement: "textarea",
                saveForUser: "global",
                label: "System Prompt",
                description: AdvancedEngine.SYSTEM_PROMPT_DESC,
                minHeight: 100
            },{
                name: "backgroundPrompt",
                type: "string",
                defaultValue: OpenAIWrapper.DEFAULT_BACKGROUND_PROMPT,
                required: false,
                uiElement: "textarea",
                saveForUser: "global",
                label: "Background Knowledge Prompt",
                description: "This prompt its given to the AI to help it make sense of, and to urge it to include this information into its thinking.  This prompt MUST contain the string {backgroundKnowledge}",
                minHeight: 50,
            },{
                name: "problemStatementPrompt",
                type: "string",
                defaultValue: OpenAIWrapper.DEFAULT_PROBLEM_STATEMENT_PROMPT,
                required: false,
                uiElement: "textarea",
                saveForUser: "global",
                label: "Problem Statement Prompt",
                description: "This prompt its given to the AI to help it make sense of, and to urge it use the user given problem statement in its response.  This prompt MUST contain the string {problemStatement}",
                minHeight: 50,
            },{
                name: "assistantPrompt",
                type: "string",
                defaultValue: OpenAIWrapper.DEFAULT_ASSISTANT_PROMPT,
                required: false,
                uiElement: "textarea",
                saveForUser: "global",
                label: "Assistant Prompt",
                description: "A prompt given to the AI immediately after it has recieved a copy of the current state of the model.  This prompt should remind the AI to close feedback, and to include the information that it has already generated into its next response",
                minHeight: 50,
            },{
                name: "feedbackPrompt",
                type: "string",
                defaultValue: OpenAIWrapper.DEFAULT_FEEDBACK_PROMPT,
                required: false,
                uiElement: "textarea",
                saveForUser: "global",
                label: "Feedback Prompt",
                description: "This is the final message given to the AI before it generates a diagram.  Typically this prompt urges the AI to include feedback in its response",
                minHeight: 50,
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
}

export default AdvancedEngine;