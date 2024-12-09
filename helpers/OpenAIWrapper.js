
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
        let systemRole = 'system';
        let responseFormat = { "type": "json_object" };

        if (this.#openAIModel.startsWith("o1")) {
            systemRole = "user";
            responseFormat = undefined;
        }
        let messages = [{ role: systemRole, content: promptObj.systemPrompt }];

        //replay the full conversation from the beginning (maybe we can skip this because of the next step!)
        messages = messages.concat(this.#userPrompts.map((promptStr) => {
            return { role: "user", content: promptStr };
        }));

        //include as the second to last (two) messages, what it has given us to date, asking it to close feedback loops and consider all of this previous information
        if (this.#lastRelationshipList) {
            let relationshipStr = this.#lastRelationshipList.filter((relationship) => {
                //if there isn't a valid key, then assume it is valid
                if (!relationship.hasOwnProperty("valid"))
                    return true;
                
                //if there isn't a relationship there skip it
                if (!relationship.hasOwnProperty("causal relationship"))
                    return true;

                return relationship.valid;
            }).map((relationship) => {
                return relationship["causal relationship"] + " which is because " + relationship.reasoning; 
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

        let origObj = {};
        try {
           origObj = JSON.parse(originalCompletion.choices[0].message.content);
        } catch (err) {
            throw err;
            return;
        }

        const originalResponseArr = utils.arrayify(origObj);
        console.log("here are the responses....");
        console.log(originalResponseArr);

        //the actual relationship list 
        let relationships = originalResponseArr.map(relationship => { //split each relationship into start, end, polarity, valid
                let ret = Object.assign({}, relationship); 
                let str = relationship["causal relationship"];
                
                if (!str || str.length == 0) {
                    ret.valid = false;
                    return ret;
                }
                
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

                let origRelationship = this.#lastRelationshipList.find((oldRelationship) => {
                    return oldRelationship.start === relationship.start && oldRelationship.end === relationship.end;
                })

                if (origRelationship && (relationship.polarity === "+" || relationship.polarity === "-")) {
                    relationship.polarity = origRelationship.polarity;
                    relationship["polarity reasoning"] = origRelationship["polarity reasoning"]; 
                    continue;
                }


                let checkPrompt = promptObj.checkRelationshipPolarityPrompt;
                checkPrompt = checkPrompt.replaceAll("{relationship}", relationship["causal relationship"]);
                checkPrompt = checkPrompt.replaceAll("{relevant_text}", relationship["relevant text"]);
                checkPrompt = checkPrompt.replaceAll("{reasoning}", relationship.reasoning);
                checkPrompt = checkPrompt.replaceAll("{var1}", relationship.start);
                checkPrompt = checkPrompt.replaceAll("{var2}", relationship.end);
                
                console.log("Polarity Prompting...")
                console.log(relationship["causal relationship"]);

                const completion = await this.#openAIAPI.chat.completions.create({
                    messages: [
                        { role: "user", content: checkPrompt }
                    ],
                    response_format: responseFormat,
                    model: this.#openAIModel,
                });
                
                let response = {};
                
                try {
                    response = JSON.parse(completion.choices[0].message.content);
                } catch (err) {
                    continue;
                }

                console.log("Response");
                console.log(response);

                if (response.answers) {
                    try {
                        response.answers = JSON.parse(response.answers) || [];
                    } catch (err) {
                        continue;
                    }

                    const isArray = Array.isArray(response.answers);

                    const reinforcing = isArray && (response.answers.includes(1) || response.answers.includes(2));
                    const balancing = isArray && (response.answers.includes(3) || response.answers.includes(4));
        
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