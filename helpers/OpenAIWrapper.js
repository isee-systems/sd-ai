
import OpenAI from "openai";

import config from './../config.js'
import utils from './utils.js'

class OpenAIWrapper{
    #promptSchemeId;
    #openAIModel;
    #userPrompts; //[] of string
    #openAIAPI;
    #lastRelationshipList; //[] of relationships we last got from open AI

    constructor(session) {
        this.#openAIModel = session.openAIModel || config.defaultModel;
        this.#promptSchemeId = session.promptSchemeId || config.defaultPromptSchemeId || "default";

        if (session.lastRelationshipList)
            this.#lastRelationshipList = JSON.parse(session.lastRelationshipList);
        else
            this.#lastRelationshipList = null;

        if (session.userPrompts)
            this.#userPrompts = JSON.parse(session.userPrompts);
        else
            this.#userPrompts = [];

        this.#openAIAPI = new OpenAI({
            apiKey: session.openAIKey || process.env.OPENAI_API_KEY,
        });
    }

    get openAIAPI() {
        return this.#openAIAPI;
    }

    set openAIAPI(value) {
        this.#openAIAPI = value;
    }

    get promptSchemeId() {
        return this.#promptSchemeId;
    }

    set promptSchemeId(value) {
        this.#promptSchemeId = value;
    }

    getUserPromptSessionStr() {
        return JSON.stringify(this.#userPrompts);
    }

    getLastRelationshipListStr() {
        return JSON.stringify(this.#lastRelationshipList);
    }

    #sameVars(a,b) {
        return utils.caseFold(a) === utils.caseFold(b);
    }
    async generateDiagram(userPrompt, lastRelationshipList) {
        if (lastRelationshipList)
            this.#lastRelationshipList = lastRelationshipList;
        
        const promptObj = utils.promptingSchemes[this.#promptSchemeId];

        //start with the system prompt
        let messages = [{ role: "system", content: promptObj.systemPrompt }];

        //replay the full conversation from the beginning (maybe we can skip this because of the next step!)
        messages = messages.concat(this.#userPrompts.map((promptStr) => {
            return { role: "user", content: promptStr };
        }));

        //include as the second to last (two) messages, what it has given us to date, asking it to close feedback loops and consider all of this previous information
        if (this.#lastRelationshipList) {
            let relationshipStr = this.#lastRelationshipList.filter((relationship) => {
                return relationship.valid;
            }).map((relationship) => {
                return relationship["causal relationship"] + " which is because " + relationship.reasoning; 
            }).join("\n");

            messages.push({ role: "assistant", content: relationshipStr });
            messages.push({ role: "user", content: promptObj.assistantPrompt });
        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });

        //get what it thinks the relationships are with this information
        const originalCompletion = await this.#openAIAPI.chat.completions.create({
            messages: messages,
            model: this.#openAIModel,
            response_format: { "type": "json_object" }
        });

        //give it what it thought of already and ask it to close feedback loops
        const assistantPrompt =  "Here is your original list of relationships in JSON format.\n" + originalCompletion.choices[0].message.content;

        const feedbackCompletion = await this.#openAIAPI.chat.completions.create({
            messages: [
                { role: "assistant", content: assistantPrompt },
                { role: "user", content: promptObj.feedbackPrompt }
            ],
            response_format: { "type": "json_object" },
            model: this.#openAIModel,
        });

        let origObj = {};
        let feedObj = {};

        try {
           origObj = JSON.parse(originalCompletion.choices[0].message.content);
           feedObj = JSON.parse(feedbackCompletion.choices[0].message.content);
        } catch (err) {
            throw err;
            return;
        }

        const originalResponseArr = utils.arrayify(origObj);
        const feedbackResponseArr = utils.arrayify(feedObj);

        //the actual relationship list 
        let relationships = originalResponseArr.concat(feedbackResponseArr)
            .map(relationship => { //split each relationship into start, end, polarity, valid
                let ret = Object.assign({}, relationship); 
                let str = relationship["causal relationship"];
                const splits = str.split("-->");
                
                if (splits.length != 2) {
                    ret.valid = false;
                    return ret;
                }

                ret.start = splits[0].trim();
                ret.end = splits[1].trim();
                ret.valid = !this.#sameVars(ret.start, ret.end);
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

            relationships = relationships.filter((relationship) => { //remove the invalid ones
                return relationship.valid;
            });
            
            //go through and check the polarity of each relationship
            for (let relationship of relationships) {
                let checkPrompt = promptObj.checkRelationshipPolarityPrompt;
                checkPrompt = checkPrompt.replaceAll("{relationship}", relationship["causal relationship"]);
                checkPrompt = checkPrompt.replaceAll("{relevant_text}", relationship["relevant text"]);
                checkPrompt = checkPrompt.replaceAll("{reasoning}", relationship.reasoning);
                checkPrompt = checkPrompt.replaceAll("{var1}", relationship.start);
                checkPrompt = checkPrompt.replaceAll("{var2}", relationship.end);
                
                const completion = await this.#openAIAPI.chat.completions.create({
                    messages: [
                        { role: "user", content: checkPrompt }
                    ],
                    response_format: { "type": "json_object" },
                    model: this.#openAIModel,
                });
                
                let response = {};
                
                try {
                    response = JSON.parse(completion.choices[0].message.content);
                } catch (err) {
                    continue;
                }

                if (response.answers) {
                    try {
                        response.answers = JSON.parse(response.answers) || [];
                    } catch (err) {
                        continue;
                    }
                    const reinforcing = response.answers.includes(1) || response.answers.includes(2);
                    const balancing = response.answers.includes(3) || response.answers.includes(4);
        
                    if (reinforcing && balancing) {
                        relationship.polarity = "?";
                    } else if (reinforcing) {
                        relationship.polarity = "+";
                    } else if (balancing) {
                        relationship.polarity = "-";
                    } else {
                        relationship.polarity = "?";
                    }
                }

                relationship["polarity reasoning"] = response.reasoning; 
                delete relationship.valid;
            }


        this.#userPrompts.push(userPrompt);
        this.#lastRelationshipList = relationships;
        return relationships;
    }
}

export default OpenAIWrapper;