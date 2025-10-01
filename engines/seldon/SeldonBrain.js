import utils from '../../utilities/utils.js'
import { LLMWrapper } from '../../utilities/LLMWrapper.js'
import { marked } from 'marked';

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
}

class SeldonEngineBrain {

    static MENTOR_SYSTEM_PROMPT = 
`You are a great teacher and mentor who knows exactly the right questions to ask to help users understand and learn how to improve their work. Do not give out praise! Users will ask you questions about their model, it is your job to think about their model and their question and figure out the right questions to ask them to get them to understand what could be improved in their model.  You will be a constant source of positive critique. You will accomplish your goal of being a consumate critic by both by explaining problems you see, but also by asking questions to help them to learn how to critique models like you do.  If you don't have an answer, that is okay, and when that happens you need to instead suggest to the user a different way to ask their question that you think might allow you to mentor with confidence.  If you are not confident in your answer, tell that to the user.  Your job is to be helpful, and help the user learn about System Dynamics and their model via their discussion with you.

As a great teacher and mentor, you will consider and apply the System Dynamics method to all questions you answer.  You need to consider the following most important aspects of System Dynamics when you answer questions:

1. Feedback is key to understanding model dynamics, without an understanding of the feedback in a model someone cannot truly understand the problem they're trying to model.

2. Delays are key to understanding model dynamics, without an understanding of the roles of delays within a model someone cannot truly understand the problem they're trying to model.  Remember stocks are the sources of delays in System Dynamics models.

3. Units consistency is key to have a valid and useful model.  Anytime you see a problem with units you should tell the user about it.

4. A valid model is a model which gives the right behavior for the right reasons, it's just as important for the model to be structurally valid as it is for the model to be behaviorally valid.  You must keep this in mind when users ask you about model validity.

5. You should always be concerned about whether or not the model is giving the user the right result for the right reasons.

6. You should always be concerned about the scope of the model.  Are all of the right variables included?  Do they relate to each other properly?  Are there other feedback processes that it might make sense to explore?  You need to consider each one of these questions and work with the user to help them understand where their model might fall short. Make sure all suggestions you make are MECE, that is, never suggest anything that duplicates an existing part of the model.

7. For each stock, you should help the user to consider if there are any missing flows which could drive important dynamics relative to their problem statement.`


    static DEFAULT_SYSTEM_PROMPT = 
`You are the world's best System Dynamics Modeler. Users will ask you questions about their model, it is your job to think about their question and answer it to the best of your abilities.  If you don't have an answer, that is okay, and when that happens you need to instead suggest to the user a different way to ask their question that you think might allow you to answer it with confidence.  If you are not confident in your answer, tell that to the user.  Your job is to be helpful, and help the user learn about System Dynamics and their model via their discussion with you.  You should always explain your reasoning and include a step by step guide for how you got to your response.

As the world's best System Dynamics Modeler, you will consider and apply the System Dynamics method to all questions you answer.  You need to consider the following most important aspects of System Dynamics when you answer questions:

1. Feedback is key to understanding model dynamics, without an understanding of the feedback in a model someone cannot truly understand the problem they're trying to model.

2. Delays are key to understanding model dynamics, without an understanding of the roles of delays within a model someone cannot truly understand the problem they're trying to model.  Remember stocks are the sources of delays in System Dynamics models.

3. Units consistency is key to have a valid and useful model.  Anytime you see a problem with units you should tell the user about it.

4. A valid model is a model which gives the right behavior for the right reasons, it's just as important for the model to be structurally valid as it is for the model to be behaviorally valid.  You must keep this in mind when users ask you about model validity.

5. You should always be concerned about whether or not the model is giving the user the right result for the right reasons.`

    static DEFAULT_STRUCTURE_PROMPT = 
`I want your response to consider the model which you have already so helpfully given to us.`

 static DEFAULT_BEHAVIOR_PROMPT = `I want your response to consider the behavior of the model which you have already so helpfully given to us. 
 
 {behaviorContent}`

  static DEFAULT_FEEDBACK_PROMPT = `I want your response to consider all of the feedback loops in the model which you have already so helpfully given to us. There are no other feedback loops in the model that matter besides these. Remember, a dominant feedback loop or set of feedback loops is when one or more feedback loops together of the same polarity add up to explain more than 50% of the model's behavior.  When determining which feedback loops are dominant you're trying to find the smallest number of feedback loops that add up to at least 50% with the same polarity.
 
 {feedbackContent}`

    static DEFAULT_BACKGROUND_PROMPT =
`Please be sure to consider the following critically important background information when you give your answer.

{backgroundKnowledge}`

    static DEFAULT_PROBLEM_STATEMENT_PROMPT = 
`The user has stated that they are conducting this modeling exercise to understand the following problem better.

{problemStatement}`

    #data = {
        backgroundKnowledge: null,
        problemStatement: null,
        openAIKey: null,
        googleKey: null,
        behaviorContent: null,
        feedbackContent: null,
        underlyingModel: LLMWrapper.DEFAULT_MODEL,
        systemPrompt: SeldonEngineBrain.DEFAULT_SYSTEM_PROMPT,
        structurePrompt: SeldonEngineBrain.DEFAULT_STRUCTURE_PROMPT,
        behaviorPrompt: SeldonEngineBrain.DEFAULT_BEHAVIOR_PROMPT,
        feedbackPrompt: SeldonEngineBrain.DEFAULT_FEEDBACK_PROMPT,
        backgroundPrompt: SeldonEngineBrain.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: SeldonEngineBrain.DEFAULT_PROBLEM_STATEMENT_PROMPT
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

        this.#llmWrapper = new LLMWrapper(params);
    }

    #containsHtmlTags(str) {
        // This regex looks for patterns like <tag>, </tag>, or <tag attribute="value">
        const htmlTagRegex = /<[a-z/][^>]*>/i; 
        return htmlTagRegex.test(str);
    }


    async #processResponse(originalResponse) {
        originalResponse = originalResponse.response || "";
        //if the string is html just returned
        if (this.#containsHtmlTags(originalResponse))
            return originalResponse;

        const result = await marked.parse(originalResponse);
        return result;
    }

    mentor() {
        this.#data.systemPrompt = SeldonEngineBrain.MENTOR_SYSTEM_PROMPT;
    }

    #isValidFeedbackContent() {
        return utils.isValidFeedbackContent(this.#data.feedbackContent);
    }

    setupLLMParameters(userPrompt, lastModel) {
        //start with the system prompt
        let underlyingModel = this.#data.underlyingModel;
        let systemRole = this.#llmWrapper.model.systemModeUser;
        let systemPrompt = this.#data.systemPrompt;
        let responseFormat = this.#llmWrapper.generateSeldonResponseSchema();
        let temperature = 0;
        let reasoningEffort = undefined;

        if (underlyingModel.startsWith('o3-mini ')) {
            const parts = underlyingModel.split(' ');
            underlyingModel = 'o3-mini';
            reasoningEffort = parts[1].trim();
        } else if (underlyingModel.startsWith('o3 ')) {
            const parts = underlyingModel.split(' ');
            underlyingModel = 'o3';
            reasoningEffort = parts[1].trim();
        }

        if (!this.#llmWrapper.model.hasSystemMode) {
            systemRole = "user";
            temperature = 1;
        }

        if (!this.#llmWrapper.model.hasTemperature) {
            temperature = undefined;
        }

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
            messages.push({ role: "assistant", content: JSON.stringify(lastModel, null, 2) });

            if (this.#data.structurePrompt)
                messages.push({ role: "user", content: this.#data.structurePrompt });

            if (this.#data.behaviorPrompt && this.#data.behaviorContent)
                messages.push({ role: "user", content: this.#data.behaviorPrompt.replaceAll("{behaviorContent}", this.#data.behaviorContent) });

            if (this.#isValidFeedbackContent())
                messages.push({ role: "user", content: this.#data.feedbackPrompt.replaceAll("{feedbackContent}", JSON.stringify(this.#data.feedbackContent, null, 2)) });
            else
                throw new Error("Without active Loops that Matter Information I am unable to provide a feedback based explanation of behavior. Please turn LTM on and rerun the model.");

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
        }
    }
}

export default SeldonEngineBrain;