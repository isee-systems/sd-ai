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
    
    static NON_STRUCTURED_OUTPUT_SYSTEM_PROMPT_ADDITION =
`
You must respond in a very specific JSON format without any deviations.  Below are 6 examples of this JSON format.  Please use this format without making any changes whatsoever to it.

Example 1 of a user input:
"when death rate goes up, population decreases"

Corresponding JSON response:
{ explanation: "<Concisely explain your reasoning for each change you made to the old CLD to create the new CLD. Speak in plain English, don't reference json specifically. Don't reiterate the request or any of these instructions.>", title:"<A highly descriptive 7 word max title describing your explanation.>", "relationships": [{"reasoning": "<This is an explanation for why this relationship exists>", "from": "Death rate", "to": "population", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"}]}

Example 2 of a user input:
"increased death rate reduces population"

Corresponding JSON response:
{ explanation: "<Concisely explain your reasoning for each change you made to the old CLD to create the new CLD. Speak in plain English, don't reference json specifically. Don't reiterate the request or any of these instructions.>", title:"<A highly descriptive 7 word max title describing your explanation.>", "relationships": [{"reasoning": "<your reasoning for this causal relationship>", "from": "Death rate", "to": "population",  polarity:"+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"}]}

Example 3 of a user input:
"lower death rate increases population"

Corresponding JSON response:
{ explanation: "<Concisely explain your reasoning for each change you made to the old CLD to create the new CLD. Speak in plain English, don't reference json specifically. Don't reiterate the request or any of these instructions.>", title:"<A highly descriptive 7 word max title describing your explanation.>", "relationships": [{"reasoning": "<your reasoning for this causal relationship>", "from": "Death rate", "to": "population",  polarity:"+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"}]}

Example 4 of a user input:
"The engineers compare the work remaining to be done against the time remaining before the deadline. The larger the gap, the more Schedule Pressure they feel.

When schedule pressure builds up, engineers have several choices. First, they can work overtime. Instead of the normal 50 hours per week, they can come to work early, skip lunch, stay late, and work through the weekend. By burning the Midnight Oil, the increase the rate at which they complete their tasks, cut the backlog of work, and relieve the schedule pressure. However, if the workweek stays too high too long, fatigue sets in and productivity suffers. As productivity falls, the task completion rate drops, which increase schedule pressure and leads to still longer hours. Another way to complete the work faster is to reduce the time spent on each task. Spending less time on each task boosts the number of tasks done per hour (productivity) and relieve schedule pressure. Lower time per task increases error rate, which leads to rework and lower productivity in the long run."

Corresponding JSON response:
{
  explanation: "<Concisely explain your reasoning for each change you made to the old CLD to create the new CLD. Speak in plain English, don't reference json specifically. Don't reiterate the request or any of these instructions.>", title:"<A highly descriptive 7 word max title describing your explanation.>", 
  "relationships": [
  {"reasoning": "<your reasoning for this causal relationship>", "from": "work remaining", "to": "Schedule Pressure", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "time remaining", "to": "Schedule Pressure", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "Schedule Pressure", "to": "overtime", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "overtime", "to": "completion rate", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "completion rate", "to": "work remaining", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "overtime", "to": "fatigue", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "fatigue", "to": "productivity", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "productivity", "to": "completion rate", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "Schedule Pressure", "to": "Time per task", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "Time per task", "to": "error rate", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "error rate", "to": "productivity", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"}
  ]
}

Example 5 of a user input:
"Congestion (i.e., travel time) creates pressure for new roads; after the new capacity is added, travel time falls, relieving the pressure. New roads are built to relieve congestion. In the short run, travel time falls and atractiveness of driving goes up—the number of cars in the region hasn’t changed and people’s habits haven’t adjusted to the new, shorter travel times. As people notice that they can now get around much faster than before, they will take more Discretionary trips (i.e., more trips per day). They will also travel extra miles, leading to higher trip length. Over time, seeing that driving is now much more attractive than other modes of transport such as the public transit system, some people will give up the bus or subway and buy a car. The number of cars per person rises as people ask why they should take the bus.

Corresponding JSON response:
{
   explanation: "<Concisely explain your reasoning for each change you made to the old CLD to create the new CLD. Speak in plain English, don't reference json specifically. Don't reiterate the request or any of these instructions.>", title:"<A highly descriptive 7 word max title describing your explanation.>", 
  "relationships": [
  {"reasoning": "<your reasoning for this causal relationship>", "from": "travel time", "to": "pressure for new roads", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "pressure for new roads", "to": "road construction", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "road construction", "to": "Highway capacity", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "Highway capacity", "to": "travel time", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "travel time", "to": "attractiveness of driving", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "attractiveness of driving", "to": "trips per day", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "trips per day", "to": "traffic volume", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "traffic volume", "to": "travel time", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "attractiveness of driving", "to": "trip length", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "trip length", "to": "traffic volume", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "attractiveness of driving", "to": "public transit", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "public transit", "to": "cars per person", "polarity": "-", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"},
  {"reasoning": "<your reasoning for this causal relationship>", "from": "cars per person", "to": "traffic volume", "polarity": "+", "polarityReasoning": "<This is the reason for why the polarity for this relationship was choosen>"}
  ]
}

Example 6 of a user input:
"<Text with no causal relationships>"

Corresponding JSON response:
{}`
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
        googleKey: null,
        underlyingModel: OpenAIWrapper.DEFAULT_MODEL,
        systemPrompt: OpenAIWrapper.DEFAULT_SYSTEM_PROPMT,
        assistantPrompt: OpenAIWrapper.DEFAULT_ASSISTANT_PROMPT,
        feedbackPrompt: OpenAIWrapper.DEFAULT_FEEDBACK_PROMPT,
        backgroundPrompt: OpenAIWrapper.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: OpenAIWrapper.DEFAULT_PROBLEM_STATEMENT_PROMPT
    };

    #noStructuredOutputMode = false;
    #noSystemMode = false;
    #geminiMode = false;

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
            this.#data.openAIKey = process.env.OPENAI_API_KEY
        }

        if (!this.#data.googleKey) {
            this.#data.googleKey = process.env.GOOGLE_API_KEY
        }
        
        this.#noStructuredOutputMode = this.#data.underlyingModel === 'o1-mini';
        this.#noSystemMode = this.#data.underlyingModel === 'o1-mini';
        this.#geminiMode = this.#data.underlyingModel.includes('gemini');

        if (this.#geminiMode) {
            this.#openAIAPI = new OpenAI({
                apiKey: this.#data.googleKey,
                baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
            });
        } else {
            this.#openAIAPI = new OpenAI({
                apiKey: this.#data.openAIKey,
            });
        }
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
        let systemPrompt = this.#data.systemPrompt;
        let responseFormat = this.#generateResponseSchema();
        let temperature = 0;

        if (this.#geminiMode) {
            systemRole = "system";
        }

        if (this.#noStructuredOutputMode) {
            systemPrompt += "\n" + OpenAIWrapper.NON_STRUCTURED_OUTPUT_SYSTEM_PROMPT_ADDITION;
            responseFormat = undefined;
        }

        if (this.#noSystemMode) {
            systemRole = "user";
            temperature = 1;
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

        if (lastModel && lastModel.relationships && lastModel.relationships.length > 0) {
            messages.push({ role: "assistant", content: JSON.stringify(lastModel.relationships, null, 2) });

            if (this.#data.assistantPrompt)
                messages.push({ role: "user", content: this.#data.assistantPrompt });
        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });
        messages.push({ role: "user", content: this.#data.feedbackPrompt }); //then have it try to close feedback
        
        //get what it thinks the relationships are with this information
        const originalCompletion = await this.#openAIAPI.chat.completions.create({
            messages: messages,
            model: this.#data.underlyingModel,
            response_format: responseFormat,
            temperature: temperature
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
                throw new ResponseFormatError("Bad JSON returned by underlying LLM");
            }
            return this.#processResponse(parsedObj);
        }
    }
}

export default OpenAIWrapper;