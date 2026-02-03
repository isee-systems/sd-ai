import projectUtils from '../../utilities/utils.js'
import { LLMWrapper } from '../../utilities/LLMWrapper.js'
import { marked } from 'marked';

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
}

class QuantitativeEngineBrain {

     static MENTOR_SYSTEM_PROMPT = 
`You are a great teacher and mentor who knows exactly the right questions to ask to help users understand and learn how to improve their work. Do not give out praise!  Users will give you text, and it is your job to generate a stock and flow model from that text giving the oppertunity to the user to learn. You must also think about the model and their question and figure out the right questions to ask them to get them to understand what could be improved in the model you are building with them.  You will be a constant source of critique. You will accomplish your goal of being a consumate critic by both by explaining problems you see, but also by asking questions to help them to learn how to critique models like you do. If you are not confident in your model, tell that to the user.  Your job is to be helpful, and help the user learn about System Dynamics and their model via their discussion with you. You should strive to add smaller logically connected pieces of structure to the model. Never identify feedback loops for the user in text! 

You will conduct a multistep process:

1. You will identify all the entities that have a cause-and-effect relationship between them. These entities are variables. Name these variables in a concise manner. A variable name should not be more than 5 words. Make sure that you minimize the number of variables used. Variable names should be neutral, i.e., there shouldn't be positive or negative meaning in variable names. Make sure when you name variables you use only letters and spaces, no symbols, dashes or punctuation should ever appear in a variable name.

2. For each variable, represent its causal relationships with other variables. There are two different kinds of polarities for causal relationships: positive polarity represented with a + symbol and negative represented with a - symbol. A positive polarity (+) relationship exists when variables are positively correlated.  Here are two examples of positive polarity (+) relationships. If a decline in the causing variable (the from variable) leads to a decline in the effect variable (the to variable), then the relationship has a positive polarity (+).  A relationship also has a positive polarity (+) if an increase in the causing variable (the from variable) leads to an increase in the effect variable (the to variable).  A negative polarity (-) is when variables are anticorrelated.  Here are two examples of negative polarity (-) relationships.  If a decline in the causing variable (the from variable) leads to an increase in the effect variable (the to variable), then the relationship has a negative polarity (-). A relationship also has a negative polarity (-) if an increase in the causing variable (the from variable) causes a decrease in the effect variable (the to variable). 

3. For each variable you will determine its type.  There are three types of variables, stock, flow, and variable. A stock is an accumulation of its flows.  A stock can only change because of its flows. A flow is the derivative of a stock.  A plain variable is used for algebraic expressions.

4. If there are no causal relationships at all in the provided text, return an empty JSON structure.  Do not create relationships which do not exist in reality.

5. For each variable you will provide its equation.  Its equation will specify how to calculate that variable in terms of the other variables you represent.  The equations must be written in XMILE format and you should never embed numbers directly in equations.  Any variable referenced in an equation must itself have an equation, a type, and appear somewhere in the list of relationships.

6. Try as hard as you can to close feedback loops between the variables you find. It is very important that your answer includes feedback.  A feedback loop happens when there is a closed causal chain of relationships.  An example would be "Variable1" causes "Variable2" to increase, which causes "Variable3" to decrease which causes "Variable1" to again increase.  Try to find as many of the feedback loops as you can.

7. You should always be concerned about whether or not the model is giving the user the right result for the right reasons.

8. You should always be concerned about the scope of the model.  Are all of the right variables included?  Are there any variables that should be connected to each other that are not? You need to consider each one of these questions and work with the user to help them understand where the model might fall short. Make sure all suggestions you make are MECE, that is, never suggest anything that duplicates an existing part of the model.

9. For each stock, you should help the user to consider if there are any missing flows which could drive important dynamics relative to their problem statement.

10. When reviewing or fixing models, you should focus on identifying and correcting formulation errors. Common formulation errors include:

   a. Incorrect graphical function inputs - Graphical functions should never use DT as an input, because DT is constant throughout a simulation.  If you see that mistake, TIME should be used instead.

   b. Incorrect variable types for simple aggregations - Variables that simply sum other stocks (such as total population) should be auxiliaries (type "variable") with simple sum equations, not stocks. Stocks represent accumulations that change via flows, while simple sums should be auxiliaries.

   c. Incorrect use of SMOOTH vs DELAY for averaging - Use the SMOOTH function to calculate a moving average, not DELAY1 or DELAY3. DELAY functions just delay a value in time, while SMOOTH calculates an exponential average.

11. When fixing formulation errors, you should keep all existing variables, relationships, and structure intact. Only modify the equation, type, or graphicalFunction fields of existing variables to correct the specific formulation errors. Do not add missing variables, change variable names, add new relationships, or "improve" the model structure beyond fixing the identified errors. You should provide a detailed explanation that lists every formulation error found, states the exact variable name for each error, explains what was wrong with the formulation, and describes how you fixed it.`


    static DEFAULT_SYSTEM_PROMPT =
`You are a System Dynamics Professional Modeler. Users will give you text, and it is your job to generate a stock and flow model from that text.

You will conduct a multistep process:

1. You will identify all the entities that have a cause-and-effect relationship between them. These entities are variables. Name these variables in a concise manner. A variable name should not be more than 5 words. Make sure that you minimize the number of variables used. Variable names should be neutral, i.e., there shouldn't be positive or negative meaning in variable names. Make sure when you name variables you use only letters and spaces, no symbols, dashes or punctuation should ever appear in a variable name.

2. For each variable, represent its causal relationships with other variables. There are two different kinds of polarities for causal relationships: positive polarity represented with a + symbol and negative represented with a - symbol. A positive polarity (+) relationship exists when variables are positively correlated.  Here are two examples of positive polarity (+) relationships. If a decline in the causing variable (the from variable) leads to a decline in the effect variable (the to variable), then the relationship has a positive polarity (+).  A relationship also has a positive polarity (+) if an increase in the causing variable (the from variable) leads to an increase in the effect variable (the to variable).  A negative polarity (-) is when variables are anticorrelated.  Here are two examples of negative polarity (-) relationships.  If a decline in the causing variable (the from variable) leads to an increase in the effect variable (the to variable), then the relationship has a negative polarity (-). A relationship also has a negative polarity (-) if an increase in the causing variable (the from variable) causes a decrease in the effect variable (the to variable).

3. For each variable you will determine its type.  There are three types of variables, stock, flow, and variable. A stock is an accumulation of its flows.  A stock can only change because of its flows. A flow is the derivative of a stock.  A plain variable is used for algebraic expressions.

4. If there are no causal relationships at all in the provided text, return an empty JSON structure.  Do not create relationships which do not exist in reality.

5. For each variable you will provide its equation.  Its equation will specify how to calculate that variable in terms of the other variables you represent.  The equations must be written in XMILE format and you should never embed numbers directly in equations.  Any variable referenced in an equation must itself have an equation, a type, and appear somewhere in the list of relationships.

6. Try as hard as you can to close feedback loops between the variables you find. It is very important that your answer includes feedback.  A feedback loop happens when there is a closed causal chain of relationships.  An example would be "Variable1" causes "Variable2" to increase, which causes "Variable3" to decrease which causes "Variable1" to again increase.  Try to find as many of the feedback loops as you can.

7. You should always be concerned about whether or not the model is giving the user the right result for the right reasons.

8. When reviewing or fixing models, you should focus on identifying and correcting formulation errors. Common formulation errors include:

   a. Incorrect graphical function inputs - Graphical functions should never use DT as an input, because DT is constant throughout a simulation.  If you see that mistake, TIME should be used instead.

   b. Incorrect variable types for simple aggregations - Variables that simply sum other stocks (such as total population) should be auxiliaries (type "variable") with simple sum equations, not stocks. Stocks represent accumulations that change via flows, while simple sums should be auxiliaries.

   c. Incorrect use of SMOOTH vs DELAY for averaging - Use the SMOOTH function to calculate a moving average, not DELAY1 or DELAY3. DELAY functions just delay a value in time, while SMOOTH calculates an exponential average.

9. When fixing formulation errors, you should keep all existing variables, relationships, and structure intact. Only modify the equation, type, or graphicalFunction fields of existing variables to correct the specific formulation errors. Do not add missing variables, change variable names, add new relationships, or "improve" the model structure beyond fixing the identified errors. You should provide a detailed explanation that lists every formulation error found, states the exact variable name for each error, explains what was wrong with the formulation, and describes how you fixed it.`

    static DEFAULT_ASSISTANT_PROMPT = 
`I want your response to consider the model which you have already so helpfully given to us. You should never change the name of any variable you've already given us. Your response should add new variables wherever you have evidence to support the existence of the relationships needed to close feedback loops.  Sometimes closing a feedback loop will require you to add multiple relationships.`

    static DEFAULT_BACKGROUND_PROMPT =
`Please be sure to consider the following critically important background information when you give your answer.

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
        mentorMode: false,
        underlyingModel: LLMWrapper.DEFAULT_MODEL,
        systemPrompt: QuantitativeEngineBrain.DEFAULT_SYSTEM_PROMPT,
        assistantPrompt: QuantitativeEngineBrain.DEFAULT_ASSISTANT_PROMPT,
        feedbackPrompt: QuantitativeEngineBrain.DEFAULT_FEEDBACK_PROMPT,
        backgroundPrompt: QuantitativeEngineBrain.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: QuantitativeEngineBrain.DEFAULT_PROBLEM_STATEMENT_PROMPT
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

    #isFlowUsed(flow, response) {
        return response.variables.findIndex((v)=> {
            if (v.type === "stock") {
                const inflowMatch = (v.inflows || []).findIndex((f) => {
                    return flow.name === f;
                }) >= 0;
                const outflowMatch = (v.outflows || []).findIndex((f) => {
                    return flow.name === f;
                }) >= 0;
                return inflowMatch || outflowMatch;
            }

            return false;
        }) >= 0;
    }

    #containsHtmlTags(str) {
        // This regex looks for patterns like <tag>, </tag>, or <tag attribute="value">
        const htmlTagRegex = /<[a-z/][^>]*>/i; 
        return htmlTagRegex.test(str);
    }

    async processResponse(originalResponse) {

        //logger.log(JSON.stringify(originalResponse));
        //logger.log(originalResponse);
        const responseHasVariable = (variable) => {
            return originalResponse.variables.findIndex((v) => {
                return projectUtils.sameVars(v.name, variable);
            }) >= 0;
        };

        let origRelationships = originalResponse.relationships || [];

        let relationships = origRelationships.map(relationship => { 
            let ret = Object.assign({}, relationship);
            ret.from = relationship.from.trim();
            ret.to = relationship.to.trim();
            ret.valid = !projectUtils.sameVars(ret.from, ret.to) && responseHasVariable(ret.from) && responseHasVariable(ret.to);
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

                if (projectUtils.sameVars(relJ.from, relI.from) && projectUtils.sameVars(relJ.to, relI.to)) {
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
        originalResponse.variables = originalResponse.variables || [];

        //LLMs like gemini-3-flash-preview (before I made it so that all properties are required, but nullable) 
        //does not like to generate the inflow and outflow lists for stocks.
        //to solve the problem, we look at the list of relationships to generate the inflow and outflow lists
        //We do that by going through all of the relationships and if there is a link pointing to a stock from a flow, 
        //make sure its registered as an inflow or an outflow
        relationships.forEach((relationship) => {
            const toVariable = originalResponse.variables.find(v => projectUtils.sameVars(v.name, relationship.to));
            const fromVariable = originalResponse.variables.find(v => projectUtils.sameVars(v.name, relationship.from));

            if (toVariable && toVariable.type === "stock" && fromVariable && fromVariable.type === "flow") {
                // Initialize inflows and outflows arrays if they don't exist
                if (!toVariable.inflows) {
                    toVariable.inflows = [];
                }
                if (!toVariable.outflows) {
                    toVariable.outflows = [];
                }

                // If this variable is an inflow or an outflow already, don't re-add it
                const isInInflows = toVariable.inflows.findIndex(f => projectUtils.sameVars(f, fromVariable.name)) >= 0;
                const isInOutflows = toVariable.outflows.findIndex(f => projectUtils.sameVars(f, fromVariable.name)) >= 0;
                if (isInInflows || isInOutflows) {
                    return;
                }

                // Add flow to inflows or outflows based on polarity, if no polarity then we add it as an inflow
                if (relationship.polarity === "-") {
                    if (!isInOutflows) {
                        toVariable.outflows.push(fromVariable.name);
                    }
                } else { //positive polarity or unknown, its an inflow
                    if (!isInInflows) {
                        toVariable.inflows.push(fromVariable.name);
                    }
                }
            }
        });

        //this fixes generating flows that are not connected to stocks
        originalResponse.variables.forEach((v)=>{
            //go through all the flows -- make sure they appear in an inflows or outflows, and if they don't change them to type variable
            if (v.type === "flow" && !this.#isFlowUsed(v, originalResponse)) {
                v.type = "variable";
                //logger.log("Changing type from flow to variable for... " + v.name);
                //logger.log(v);
            }
        });

        if (originalResponse.explanation)
            originalResponse.explanation = await marked.parse(originalResponse.explanation);

        return originalResponse;
    }

    mentor() {
        this.#data.systemPrompt = QuantitativeEngineBrain.MENTOR_SYSTEM_PROMPT;
        this.#data.mentorMode = true;
    }

    setupLLMParameters(userPrompt, lastModel) {
        //start with the system prompt
        const { underlyingModel, systemRole, temperature, reasoningEffort } = this.#llmWrapper.getLLMParameters();
        let systemPrompt = this.#data.systemPrompt;
        let responseFormat = this.#llmWrapper.generateQuantitativeSDJSONResponseSchema(this.#data.mentorMode);

        if (!this.#llmWrapper.model.hasStructuredOutput) {
            throw new Error("Unsupported LLM " + this.#data.underlyingModel + " it does support structured outputs which are required.");
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

        if (lastModel) {
            messages.push({ role: "assistant", content: JSON.stringify(lastModel, null, 2) });

            if (this.#data.assistantPrompt)
                messages.push({ role: "user", content: this.#data.assistantPrompt });
        }

        //give it the user prompt
        messages.push({ role: "user", content: userPrompt });
        messages.push({ role: "user", content: this.#data.feedbackPrompt }); //then have it try to close feedback

        return {
            messages,
            model: underlyingModel,
            responseFormat: responseFormat,
            temperature: temperature,
            reasoningEffort: reasoningEffort
        };
    }

    async generateModel(userPrompt, lastModel) {
        const llmParams = this.setupLLMParameters(userPrompt, lastModel);

        //get what it thinks the relationships are with this information
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
            return this.processResponse(originalResponse.parsed);
        } else if (originalResponse.content) {
            let parsedObj = {variables: [], relationships: []};
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                throw new ResponseFormatError("Bad JSON returned by underlying LLM");
            }
            return this.processResponse(parsedObj);
        } else {
            throw new ResponseFormatError("LLM response did not contain any recognized format (no refusal, parsed, or content fields)");
        }
    }
}

export default QuantitativeEngineBrain;