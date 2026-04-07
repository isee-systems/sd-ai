import utils from '../../utilities/utils.js'
import { LLMWrapper } from '../../utilities/LLMWrapper.js'
import { marked } from 'marked';

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
}

class SeldonILEUserBrain {

    static DEFAULT_SYSTEM_PROMPT =
`You are an expert at helping people understand simulation results. Users will ask you questions about their simulation model and the results it produces. Your job is to help them understand what they're seeing in plain, everyday language. Users are NOT System Dynamics experts, so avoid jargon and technical terminology.

IMPORTANT: You must set feedbackInformationRequired to true for questions that fundamentally require understanding model dynamics to answer properly. This includes:
- Questions explicitly about feedback loops
- Questions asking why or how things happen in the model
- Questions about what drives model behavior or dynamics
- Questions about causality within the model

VERY IMPORTANT: NEVER mark feedbackInformationRequired to true if the model is empty (has no variables) or if the model has equation or syntax errors that prevent it from simulating. Feedback information is only relevant for valid, populated models.

When feedbackInformationRequired is true and no feedback information was passed, your response should be only one sentence long explaining why feedback loop information is necessary to properly answer the question.

When helping users understand their simulation results:

1. Use plain language. Avoid technical terms like "stock", "flow", "auxiliary", or System Dynamics jargon. Instead, talk about what accumulates, what changes over time, and what influences what.

2. When discussing feedback processes, tell the story of how things interact. Describe the causal mechanisms at work - how one thing affects another, which then affects something else, potentially coming back to influence the original thing. Never refer to loops by their ID numbers. Focus on the narrative of cause and effect.

3. When discussing delays or why things take time to change, explain it in terms of what's accumulating or what information takes time to gather or process. Make it concrete and relatable.

4. Focus on helping users understand WHY they're seeing the behavior they're seeing in their simulation. What's driving the patterns? What are the key mechanisms at work?

5. If you don't have enough information to answer confidently, tell the user and suggest what additional information would help you provide a better answer.

RESPONSE STYLE:
- Provide direct, clear answers in plain language
- Use everyday analogies and examples when helpful
- When discussing feedback processes, tell the causal story of how things interact rather than citing loop IDs or technical terminology
- Focus on explaining WHY the simulation behaves the way it does
- Make it conversational and accessible to non-experts`

    static DEFAULT_STRUCTURE_PROMPT =
`I want your response to consider the model which you have already so helpfully given to us.`

 static DEFAULT_BEHAVIOR_PROMPT = `I want your response to consider the behavior of the model which you have already so helpfully given to us.

 {behaviorContent}`

  static DEFAULT_FEEDBACK_PROMPT = `I want your response to consider all of the feedback loops in the model. There are no other feedback loops in the model that matter besides these.

When discussing feedback processes, describe how the variables interact with each other to create reinforcing or balancing behavior. Explain the causal story in plain language - how changes propagate through the system - rather than referring to loops by their ID numbers. Help the user understand the dynamic mechanisms at work without using System Dynamics jargon.

A dominant feedback process is one that drives more than 50% of the model's behavior over a particular time period. When determining dominance, you're looking for the smallest set of causal mechanisms (of the same polarity) that together explain the majority of the system's dynamics.

{feedbackContent}`

    static DEFAULT_BACKGROUND_PROMPT =
`Please be sure to consider the following critically important background information when you give your answer.

{backgroundKnowledge}`

    static DEFAULT_PROBLEM_STATEMENT_PROMPT =
`The user is trying to understand the following situation or problem better through this simulation.

{problemStatement}`

    #data = {
        backgroundKnowledge: null,
        problemStatement: null,
        openAIKey: null,
        googleKey: null,
        behaviorContent: null,
        feedbackContent: null,
        currentRunName: null,
        underlyingModel: LLMWrapper.NON_BUILD_DEFAULT_MODEL,
        systemPrompt: SeldonILEUserBrain.DEFAULT_SYSTEM_PROMPT,
        structurePrompt: SeldonILEUserBrain.DEFAULT_STRUCTURE_PROMPT,
        behaviorPrompt: SeldonILEUserBrain.DEFAULT_BEHAVIOR_PROMPT,
        feedbackPrompt: SeldonILEUserBrain.DEFAULT_FEEDBACK_PROMPT,
        backgroundPrompt: SeldonILEUserBrain.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: SeldonILEUserBrain.DEFAULT_PROBLEM_STATEMENT_PROMPT
    };

    #llmWrapper;

    constructor(params) {
        Object.assign(this.#data, params);

        if (!this.#data.problemStatementPrompt.includes('{problemStatement')) {
            this.#data.problemStatementPrompt = this.#data.problemStatementPrompt.trim() + "\n\n{problemStatement}";
        }

        if (!this.#data.backgroundPrompt.includes('{backgroundKnowledge')) {
            this.#data.backgroundPrompt = this.#data.backgroundPrompt.trim() + "\n\n{backgroundKnowledge}";
        }

        this.#llmWrapper = new LLMWrapper(this.#data);
    }

    #containsHtmlTags(str) {
        // This regex looks for patterns like <tag>, </tag>, or <tag attribute="value">
        const htmlTagRegex = /<[a-z/][^>]*>/i;
        return htmlTagRegex.test(str);
    }


    async #processResponse(originalResponse) {
        let reply = originalResponse.response || "";
        //if the string is html just returned
        if (!this.#containsHtmlTags(reply))
            reply = await marked.parse(reply);

        if (originalResponse.feedbackInformationRequired && !this.#isValidFeedbackContent()) {
            reply = "<b><i>Please re-run the model to compute the information we need to answer your question.</i></b><br/>" + reply;
        }

        return reply;
    }

    #isValidFeedbackContent() {
        return utils.isValidFeedbackContent(this.#data.feedbackContent);
    }

    #filterModelForErrors(model) {
        // If no variables have equations, remove the errors field
        if (!model || !model.variables) {
            return model;
        }

        const hasEquations = model.variables.some(variable =>
            variable.equation && variable.equation.trim() !== ''
        );

        if (!hasEquations && model.errors) {
            delete model.errors;
        }

        return model;
    }

    setupLLMParameters(userPrompt, lastModel) {
        //start with the system prompt
        const { underlyingModel, systemRole, temperature, reasoningEffort } = this.#llmWrapper.getLLMParameters();
        let systemPrompt = this.#data.systemPrompt;
        let responseFormat = this.#llmWrapper.generateSeldonResponseSchema();

        let messages = [{
            role: systemRole,
            content: systemPrompt
        }];

        if (this.#data.backgroundKnowledge) {
            messages.push({
                role: "user",
                content:  this.#data.backgroundPrompt.replaceAll("{backgroundKnowledge}", this.#data.backgroundKnowledge),
            });
        }

        if (this.#data.problemStatement) {
            messages.push({
                role: systemRole,
                content: this.#data.problemStatementPrompt.replaceAll("{problemStatement}", this.#data.problemStatement),
            });
        }

        if (lastModel && lastModel.variables && lastModel.variables.length > 0) {
            const filteredModel = this.#filterModelForErrors(lastModel);

            messages.push({ role: "assistant", content: JSON.stringify(filteredModel, null, 2) });

            if (this.#data.structurePrompt)
                messages.push({ role: "user", content: this.#data.structurePrompt });

            if (this.#data.behaviorPrompt && this.#data.behaviorContent)
                messages.push({ role: "user", content: this.#data.behaviorPrompt.replaceAll("{behaviorContent}", this.#data.behaviorContent) });

            if (this.#data.currentRunName) {
                messages.push({
                    role: "user",
                    content: `The current simulation run the user is working with is called: "${this.#data.currentRunName}"`
                });
            }

            if (this.#isValidFeedbackContent()) {
                const feedbackPromptContent = this.#data.feedbackPrompt
                    .replaceAll("{feedbackContent}", JSON.stringify(this.#data.feedbackContent, null, 2));
                messages.push({ role: "user", content: feedbackPromptContent });
            }
        } else {

            if (this.#data.behaviorPrompt && this.#data.behaviorContent)
                messages.push({ role: "user", content: this.#data.behaviorPrompt.replaceAll("{behaviorContent}", this.#data.behaviorContent) });

        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });

        return {
            messages,
            model: underlyingModel,
            temperature: temperature,
            reasoningEffort: reasoningEffort,
            responseFormat: responseFormat
        };
    }

    async converse(userPrompt, lastModel) {
        const llmParams = this.setupLLMParameters(userPrompt, lastModel);

        //get its response
        const originalResponse = await this.#llmWrapper.createChatCompletion(
            llmParams.messages,
            llmParams.model,
            llmParams.responseFormat,
            llmParams.temperature,
            llmParams.reasoningEffort
        );

        if (originalResponse.refusal) {
            throw new ResponseFormatError(originalResponse.refusal);
        } else if (originalResponse.parsed) {
            return this.#processResponse(originalResponse.parsed);
        } else if (originalResponse.content) {
            let parsedObj = {variables: [], relationships: []};
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                throw new ResponseFormatError("Bad JSON returned by underlying LLM");
            }
            return this.#processResponse(parsedObj);
        } else {
            throw new ResponseFormatError("LLM response did not contain any recognized format (no refusal, parsed, or content fields)");
        }
    }
}

export default SeldonILEUserBrain;
