import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import projectUtils from './../../utils.js'
import config from './../../config.js'
import crypto from 'crypto'

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
};

class OpenAIWrapper {
    
    static SCHEMA_STRINGS = {
        "from": "This is a variable which causes the to variable in this relationship that is between two variables, from and to.  The from variable is the equivalent of a cause.  The to variable is the equivalent of an effect",
        "to": "This is a variable which is impacted by the from variable in this relationship that is between two variables, from and to.  The from variable is the equivalent of a cause.  The to variable is the equivalent of an effect",
        "reasoning": "This is an explanation for why this relationship exists",
        "polarity": "There are two possible kinds of relationships.  The first are relationships with positive polarity that are represented with a + symbol.  In relationships with positive polarity when there is an increase in the from variable causes an increase in the to variable.  The second are relationships with negative polarity (-) where an increase in the from variable causes a decrease in the to variable.",
        "polarityReasoning": "This is the reason for why the polarity for this relationship was choosen",
        "relationship": "This is a relationship between two variables, from and to (from is the cause, to is the effect).  The relationship also contains a polarity which describes how a change in the from variable impacts the to variable",
        "relationships": "The list of relationships you think are appropriate to satisfy my request based on all of the information I have given you",
        "explanation": "Concisely explain your reasoning for each change you made to the old CLD to create the new CLD. Speak in plain English, don't reference json specifically. Don't reiterate the request or any of these instructions.",
        "title": "A highly descriptive 7 word max title describing your explanation."
    };
    
    static DEFAULT_MODEL = 'gpt-4o';

    static DEFAULT_SYSTEM_PROPMT = 
`You are a System Dynamics Professional Modeler. Users will give you text, and it is your job to generate causal relationships from that text.

You will conduct a multistep process:

1. You will identify all the entities that have a cause-and-effect relationships between. These entities are variables. Name these variables in a concise manner. A variable name should not be more than 5 words. Make sure that you minimize the number of variables used. Variable names should be neutral, i.e., there shouldn't be positive or negative meaning in variable names.

2. For each variable, represent its causal relationships with other variables. There are two different kinds of polarities for causal relationships: positive polarity represented with a + symbol and negative represented with a - symbol. A positive polarity (+) relationship exits when variables are positively correlated.  Here are two examples of positive polarity (+) relationships. If a decline in the causing variable (the from variable) leads to a decline in the effect variable (the to variable), then the relationship has a positive polarity (+).  A relationship also has a positive polarity (+) if an increase in the causing variable (the from variable) leads to an increase in the effect variable (the to variable).  A negative polarity (-) is when variables are anticorrelated.  Here are two examples of negative polarity (-) relationships.  If a decline in the causing variable (the from variable) leads to an increase in the effect variable (the to variable), then the relationship has a negative polarity (-). A relationship also has a negative polarity (-) if an increase in the causing variable (the from variable) causes a decrease in the effect variable (the to variable). 

3. Not all variables will have relationships with all other variables.

4. When three variables are related in a sentence, make sure the relationship between second and third variable is correct. For example, if "Variable1" inhibits "Variable2", leading to less "Variable3", "Variable2" and "Variable3" have a positive polarity (+) relationship.

5. If there are no causal relationships at all in the provided text, return an empty JSON array.  Do not create relationships which do not exist in reality.

6. Try as hard as you can to close feedback loops between the variables you find. It is very important that your answer includes feedback.  A feedback loop happens when there is a closed causal chain of relationships.  An example would be “Variable1” causes “Variable2” to increase, which causes “Variable3” to decrease which causes “Variable1” to again increase.  Try to find as many of the feedback loops as you can.`

    static DEFAULT_ASSISTANT_PROMPT = 
`I want your response to consider all of the above relationships which you have already so helpfully given to us.  Your response should add new relationships and close feedback loops wherever you have evidence to support the existence of the relationships needed to close the feedback loop.  Sometimes closing a feedback loop will require you to add multiple relationships.`

    static DEFAULT_BACKGROUND_PROMPT =
`Please be sure to consider the following critically important information when you give your answer.

{backgroundKnowledge}`

    static DEFAULT_FEEDBACK_PROMPT =
`Find out if there are any possibilities of forming closed feedback loops that are implied in the analysis that you are doing. If it is possible to create a feedback loop using the variables you've found in your analysis, then close any feedback loops you can by adding the extra relationships which are necessary to do so.  This may require you to add many relationships.  This is okay as long as there is evidence to support each relationship you add.`

    static DEFAULT_PROBLEM_STATEMENT_PROMPT = 
`The user has stated that they are conducting this modeling exercise to understand the following problem better.

{problemStatement}`

    #data = {
        backgroundKnowledge: null,
        problemStatement: null,
        openAIKey: null,
        openAIModel: OpenAIWrapper.DEFAULT_MODEL,
        systemPrompt: OpenAIWrapper.DEFAULT_SYSTEM_PROPMT,
        assistantPrompt: OpenAIWrapper.DEFAULT_ASSISTANT_PROMPT,
        feedbackPrompt: OpenAIWrapper.DEFAULT_FEEDBACK_PROMPT,
        backgroundPrompt: OpenAIWrapper.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: OpenAIWrapper.DEFAULT_PROBLEM_STATEMENT_PROMPT
    };

    #openAIAPI;

    constructor(params) {
        Object.assign(this.#data, params);

        if (!this.#data.problemStatementPrompt.includes('{problemStatement')) {
            this.#data.problemStatementPrompt = this.#data.problemStatementPrompt.trim() + "\n\n{problemStatement}";
        }

        if (!this.#data.backgroundPrompt.includes('{backgroundKnowledge')) {
            this.#data.backgroundPrompt = this.#data.backgroundPrompt.trim() + "\n\n{backgroundKnowledge}";
        }

        if (!this.#data.openAIKey) {
            if (config.restrictKey) {
                if (Buffer.from(params.secret, 'hex').toString() === process.env.RESTRICT_KEY_PHRASE) {
                    this.#data.openAIKey = process.env.OPENAI_API_KEY;
                }

            } else {
                this.#data.openAIKey = process.env.OPENAI_API_KEY
            }
        }

        this.#openAIAPI = new OpenAI({
            apiKey: this.#data.openAIKey,
        });
    }

    #caseFold(variableName) {
        let xname = projectUtils.xmileName(variableName);
        return xname.toLowerCase();
    }

    #sameVars(a,b) {
        return this.#caseFold(a) === this.#caseFold(b);
    }

    #processResponse(originalResponse) {
        let origRelationships = originalResponse.relationships || [];
        console.log("Here are the responses....");
        console.log(origRelationships);

        let relationships = origRelationships.map(relationship => { 
            let ret = Object.assign({}, relationship);
            ret.from = relationship.from.trim();
            ret.to = relationship.to.trim();
            ret.valid = !this.#sameVars(ret.from, ret.to);
            return ret;
        });
            
        //mark for removal any relationships which are duplicates, keep the first one we encounter
        for (let i=1,len=relationships.length; i < len; ++i) {
            for (let j=0; j < i; ++j) {
                let relJ = relationships[j];
                let relI = relationships[i];
                
                //who cares if its an invalid link
                if (!relI.valid || !relJ.valid)
                    continue;

                if (this.#sameVars(relJ.from, relI.from) && this.#sameVars(relJ.to, relI.to)) {
                    relI.valid = false;
                }
            }
        }

        //remove the invalid ones, then remove the valid field
        relationships = relationships.filter((relationship) => { 
            return relationship.valid;
        });

        relationships.forEach((relationship) => { 
            delete relationship.valid;
        });
        
        originalResponse.relationships = relationships;
        return originalResponse;
    }

    #generateResponseSchema() {
        const PolarityEnum = z.enum(["+", "-"]).describe(OpenAIWrapper.SCHEMA_STRINGS.polarity);

        const Relationship = z.object({
            from: z.string().describe(OpenAIWrapper.SCHEMA_STRINGS.from),
            to: z.string().describe(OpenAIWrapper.SCHEMA_STRINGS.to),
            polarity: PolarityEnum,
            reasoning: z.string().describe(OpenAIWrapper.SCHEMA_STRINGS.reasoning),
            polarityReasoning: z.string().describe(OpenAIWrapper.SCHEMA_STRINGS.polarityReasoning)
        }).describe(OpenAIWrapper.SCHEMA_STRINGS.relationship);
            
        const Relationships = z.object({
            explanation: z.string().describe(OpenAIWrapper.SCHEMA_STRINGS.explanation),
            title: z.string().describe(OpenAIWrapper.SCHEMA_STRINGS.title),
            relationships: z.array(Relationship).describe(OpenAIWrapper.SCHEMA_STRINGS.relationships)
        });

        return zodResponseFormat(Relationships, "relationships_response");
    }

    async generateDiagram(userPrompt, lastModel) {        
        //start with the system prompt
        let systemRole = 'developer';
        let responseFormat = this.#generateResponseSchema();

        let messages = [{ 
            role: systemRole, 
            content: this.#data.systemPrompt 
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
                content: this.#data.problemStatementPrompt.replaceAll("{problemStatement}", this.#data.problemStatementt),
            });
        }

        if (lastModel && lastModel.relationships && lastModel.relationships.length > 0) {
            messages.push({ role: "assistant", content: JSON.stringify(lastModel.relationships, null, 2) });

            if (this.#data.assistantPrompt)
                messages.push({ role: "user", content: this.#data.assistantPrompt });
        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });
        messages.push({ role: "user", content: this.#data.feedbackPrompt }); //then have it try to close feedback

        console.log("Original Prompt...");
        console.log(messages);
        
        //get what it thinks the relationships are with this information
        const originalCompletion = await this.#openAIAPI.chat.completions.create({
            messages: messages,
            model: this.#data.openAIModel,
            response_format: responseFormat,
            temperature: 0
        });

        const originalResponse = originalCompletion.choices[0].message;
        if (originalResponse.refusal) {
            throw new ResponseFormatError(originalResponse.refusal);
        } else if (originalResponse.parsed) {
            return this.#processResponse(originalResponse.parsed);
        } else if (originalResponse.content) {
            let parsedObj = {relationships: []};
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                throw new ResponseFormatError("Bad JSON returned by OpenAI");
            }
            return this.#processResponse(parsedObj);
        }
    }
}

export default OpenAIWrapper;