import {LLMWrapper} from "../../utilities/LLMWrapper.js";
import utils from "../../utilities/utils.js";
import { marked } from 'marked';

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
}

class LTMNarrativeBrain {

    static DEFAULT_SYSTEM_PROMPT = 
`You are the world's best System Dynamics Modeler. It is your job to take feedback loop names and descriptions and weave them into a narrative essay describing the origins of behavior in the model the feedback loops come from. When you give a name to a feedback loop it must be short, describe what the loop means, and be distinctive relative to the other loops you give names to.  

In the essay you produce you will discuss how loop dominance evovles overtime as a way of helping the user to understand why the model produces the behavior it does.

For each period with a different set of dominant feedback loops you will:
1. Identify the time period.
2. Only if there is a single feedback loop that is dominant in that period, can you refer to a specific loop as the cause of behavior during that time period.
3. If there are multiple feedback loops that are together dominant in that period, you will refer to concepts shared across all of those feedback loops as being responsible for behavior in that time period.

You can only use the information given to you by the user in your work. Any information you receive about feedback loops is accurate and correct, do not question it, nor should you use words that express uncertainity about the role of the feedback in creating model behavior. Rely on the information given by the user, and on the feedback loop descriptions you've written. Avoid the use of strong adjectives when describing changes in model behavior. Present the narrative in essay form using multiple paragraphs unless instructed to do otherwise.`

  static DEFAULT_FEEDBACK_PROMPT = 
`I want your response to consider all of the feedback loops in the model which you have already so helpfully given to us. There are no other feedback loops in the model that matter besides these. Remember, a dominant feedback loop or set of feedback loops is when one or more feedback loops together of the same polarity add up to explain more than 50% of the model's behavior.  When determining which feedback loops are dominant you're trying to find the smallest number of feedback loops that add up to at least 50% with the same polarity.`

  static DEFAULT_BEHAVIOR_PROMPT = 
`I want your response to consider the behavior of the model which you have already so helpfully given to us. 
 
{behaviorContent}`

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
        underlyingModel: LLMWrapper.NON_BUILD_DEFAULT_MODEL,
        systemPrompt: LTMNarrativeBrain.DEFAULT_SYSTEM_PROMPT,
        behaviorPrompt: LTMNarrativeBrain.DEFAULT_BEHAVIOR_PROMPT,
        feedbackPrompt: LTMNarrativeBrain.DEFAULT_FEEDBACK_PROMPT,
        backgroundPrompt: LTMNarrativeBrain.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: LTMNarrativeBrain.DEFAULT_PROBLEM_STATEMENT_PROMPT
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

    #isValidFeedbackContent() {
        return utils.isValidFeedbackContent(this.#data.feedbackContent);
    }

    #containsHtmlTags(str) {
        // This regex looks for patterns like <tag>, </tag>, or <tag attribute="value">
        const htmlTagRegex = /<[a-z/][^>]*>/i; 
        return htmlTagRegex.test(str);
    }

    processFeedbackContent(feedbackJSON) {
        //test if feedbackJSON contains an attribute called feedbackLoops that is an array
        //if it is, go through each object and remove the name attribute as long as an identifier attribute exists
        
        if (feedbackJSON && Array.isArray(feedbackJSON.feedbackLoops)) {
            feedbackJSON.feedbackLoops.forEach(loop => {
                if (loop.identifier && loop.name) {
                    //if the loop name begins with B, Bu, R, Ru, or U all followed by a number delete the name
                    if (/^(B\d|Bu\d|R\d|Ru\d|U\d)/.test(loop.name)) {
                        delete loop.name;
                    }
                }
            });
        }
        return feedbackJSON;
    }

    async #processResponse(originalResponse) {
        if (!originalResponse.feedbackLoops) {
            originalResponse.feedbackLoops = [];
            debugger;
        }

        //if the string is html just returned
        originalResponse.narrative = originalResponse.narrativeMarkdown;
        delete originalResponse.narrativeMarkdown;
        
        if (this.#containsHtmlTags(originalResponse.narrative))
            return originalResponse;

        originalResponse.narrative = await marked.parse(originalResponse.narrative);
        return originalResponse;
    }

    setupLLMParameters(userPrompt, lastModel) {
        //ignore lastModel we don't need it for this engine!!!

        if (!this.#isValidFeedbackContent())
            throw new Error("Without active Loops that Matter Information I am unable to provide a feedback based explanation of behavior. Please turn LTM on and rerun the model.");

        //start with the system prompt
        const { underlyingModel, systemRole, temperature, reasoningEffort } = this.#llmWrapper.getLLMParameters();
        let responseFormat = this.#llmWrapper.generateLTMNarrativeResponseSchema();
        let systemPrompt = this.#data.systemPrompt;

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
                    
        messages.push({ role: "assistant", content: JSON.stringify(this.processFeedbackContent(this.#data.feedbackContent), null, 2) });

        if (this.#data.feedbackPrompt)
            messages.push({ role: "user", content: this.#data.feedbackPrompt });
        
        if (this.#data.behaviorPrompt && this.#data.behaviorContent)
            messages.push({ role: "user", content: this.#data.behaviorPrompt.replaceAll("{behaviorContent}", this.#data.behaviorContent) });

        //give it the user prompt
        if (userPrompt)
            messages.push({ role: "user", content: userPrompt });

        return {
            messages,
            model: underlyingModel,
            temperature: temperature,
            reasoningEffort: reasoningEffort,
            responseFormat: responseFormat
        };
    }

    async generate(userPrompt, lastModel) {
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
            return await this.#processResponse(originalResponse.parsed);
        } else if (originalResponse.content) {
            let parsedObj = {feedbackLoops: [], narrative: ""};
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                throw new ResponseFormatError("Bad JSON returned by underlying LLM");
            }
            return await this.#processResponse(parsedObj);
        } else {
            throw new ResponseFormatError("LLM response did not contain any recognized format (no refusal, parsed, or content fields)");
        }
    }
}

export default LTMNarrativeBrain;