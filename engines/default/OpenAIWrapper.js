import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";

import config from './config.js'
import utils from './utils.js'

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
};

class OpenAIWrapper{
    #promptSchemeId;
    #openAIModel;
    #openAIAPI;
    #backgroundKnowledge;

    constructor(openAIModel, promptSchemeId, backgroundKnowledge, openAIKey) {
        this.#openAIModel = openAIModel || config.defaultModel;
        this.#promptSchemeId = promptSchemeId || config.defaultPromptSchemeId || "default";
        this.#backgroundKnowledge = backgroundKnowledge || null;

        this.#openAIAPI = new OpenAI({
            apiKey: openAIKey || process.env.OPENAI_API_KEY,
        });
    }

    #sameVars(a,b) {
        return utils.caseFold(a) === utils.caseFold(b);
    }

    #processResponse(originalResponseArr) {
        console.log("here are the responses....");
        console.log(originalResponseArr);

        //split each relationship into start, end, polarity, valid
        let relationships = originalResponseArr.map(relationship => { 
            let ret = Object.assign({}, relationship); 
            ret.start = relationship.cause.trim();
            ret.end = relationship.effect.trim();
            ret.valid = !this.#sameVars(ret.start, ret.end);

            switch (relationship.polarity) {
                case "positive":
                    ret.polarity = "+";
                    break;
                case "negative":
                    ret.polarity = "-";
                    break;
                default:
                    ret.polarity = "?";
                    if (relationship.polarity != "unknown") {
                        debugger; //this shouldn't happen!
                    }
                    break;
            }
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

                if (this.#sameVars(relJ.start, relI.start) && this.#sameVars(relJ.end, relI.end)) {
                    relI.valid = false;
                }
            }
        }

        //remove the invalid ones
        relationships = relationships.filter((relationship) => { 
            return relationship.valid;
        });
            
        return relationships;
    }

    #generateResponseSchema(promptObj) {
        const PolarityEnum = z.enum(["positive", "negative"]).describe(promptObj.schemaStrings.polarity);
        const Relationship = z.object({
            cause: z.string().describe(promptObj.schemaStrings.cause),
            effect: z.string().describe(promptObj.schemaStrings.effect),
            polarity: PolarityEnum,
            reasoning: z.string().describe(promptObj.schemaStrings.reasoning),
            relevantText: z.string().describe(promptObj.schemaStrings.relevantText),
            polarityReasoning: z.string().describe(promptObj.schemaStrings.polarityReasoning)
        }).describe(promptObj.schemaStrings.relationship);
            
        const Relationships = z.object({
            relationships: z.array(Relationship).describe(promptObj.schemaStrings.relationships)
        });

        return zodResponseFormat(Relationships, "relationships_response");
    }

    async generateDiagram(userPrompt, lastModel) {
        const promptObj = utils.promptingSchemes[this.#promptSchemeId];
        const lastRelationships = lastModel.relationships || [];
        
        //start with the system prompt
        let systemRole = 'developer';
        let responseFormat = this.#generateResponseSchema(promptObj);

        let messages = [{ role: systemRole, content: promptObj.systemPrompt }];
        if (this.#backgroundKnowledge) {
            messages.push({
                role: "user",
                content: promptObj.backgroundPrompt.replaceAll("{backgroundKnowledge}", this.#backgroundKnowledge),
            });
        }

        //include as the second to last (two) messages, what it has given us to date, asking it to close feedback loops and consider all of this previous information
        if (lastRelationships && lastRelationships.length > 0) {
            let relationshipStr = lastRelationships.filter((relationship) => {
                //if there isn't a valid key, then assume it is valid
                if (!relationship.hasOwnProperty("valid"))
                    return true;
                
                //if there isn't a relationship there skip it
                if (!relationship.hasOwnProperty("causalRelationship"))
                    return true;

                return relationship.valid;
            }).map((relationship) => {
                return relationship["causalRelationship"] + " which is because " + relationship.reasoning; 
            }).join("\n");

            messages.push({ role: "assistant", content: relationshipStr });
            messages.push({ role: "user", content: promptObj.assistantPrompt });
        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });
        messages.push({ role: "user", content: promptObj.feedbackPrompt }); //then have it try to close feedback

        console.log("Original Prompt...");
        console.log(messages.slice(1)); //pop off the system prompt for logging purposes
        
        //get what it thinks the relationships are with this information
        const originalCompletion = await this.#openAIAPI.chat.completions.create({
            messages: messages,
            model: this.#openAIModel,
            response_format: responseFormat
        });

        const originalResponse = originalCompletion.choices[0].message;
        if (originalResponse.refusal) {
            return new ResponseFormatError(originalResponse.refusal);
        } else if (originalResponse.parsed) {
            return this.#processResponse(originalResponse.parsed.relationships);
        } else if (originalResponse.content) {
            let parsedObj = {relationships: []};
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                return new ResponseFormatError("Bad JSON returned by OpenAI");
            }

            return this.#processResponse(parsedObj.relationships || []);
        }
    }
}

export default OpenAIWrapper;