import {LLMWrapper} from "../../utilities/LLMWrapper.js";
import { marked } from 'marked';

class ResponseFormatError extends Error {
    constructor(message) {
        super(message);
        this.name = "ResponseFormatError";
    }
}

class GenerateDocumentationBrain {

    static DEFAULT_SYSTEM_PROMPT =
`You are an expert System Dynamics modeler and technical documentation writer. Your task is to generate clear, comprehensive documentation for variables in a System Dynamics model.

For each variable you document, you should:
1. Provide a clear, concise description of what the variable represents
2. Explain the variable's role and purpose within the model
3. Describe how the variable relates to other elements in the model
4. Document any constants or parameters used in equations.
5. Keep documentation professional and informative

Your documentation should be accessible to both technical and non-technical audiences. Use clear language and avoid unnecessary jargon. Each variable's documentation should be 2-4 sentences that provide meaningful context without being overly verbose.`;

    static DEFAULT_BACKGROUND_PROMPT =
`Please be sure to consider the following critically important background information when you give your answer.

{backgroundKnowledge}`

    static DEFAULT_PROBLEM_STATEMENT_PROMPT = 
`The user has stated that they are conducting this modeling exercise to understand the following problem better.

{problemStatement}`

    #data = {
        backgroundKnowledge: null,
        problemStatement: null,
        modelContext: null,
        openAIKey: null,
        googleKey: null,
        generatePolarity: false,
        documentConnectors: false,
        underlyingModel: LLMWrapper.NON_BUILD_DEFAULT_MODEL,
        systemPrompt: GenerateDocumentationBrain.DEFAULT_SYSTEM_PROMPT,
        backgroundPrompt: GenerateDocumentationBrain.DEFAULT_BACKGROUND_PROMPT,
        problemStatementPrompt: GenerateDocumentationBrain.DEFAULT_PROBLEM_STATEMENT_PROMPT
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

    #extractVariablesFromModel(model) {
        // Extract variables from the model structure
        // This assumes the model has a variables array or similar structure
        if (!model || !model.variables) {
            return [];
        }

        return model.variables.map(variable => ({
            name: variable.name || 'Unknown',
            type: variable.type || 'variable',
            equation: variable.equation || '',
            units: variable.units || '',
            currentDocumentation: variable.documentation || ''
        }));
    }

    async #processResponse(originalResponse, originalModel) {
        if (!originalResponse.variables) {
            throw new ResponseFormatError("Response missing variables array");
        }

        // Create a map of variable names to documentation for quick lookup
        const docMap = new Map();
        originalResponse.variables.forEach(variable => {
            docMap.set(variable.name, variable.documentation);
        });

        // Update the original model with the new documentation
        const updatedModel = JSON.parse(JSON.stringify(originalModel)); // Deep clone

        if (updatedModel.variables) {
            updatedModel.variables.forEach(variable => {
                if (docMap.has(variable.name)) {
                    variable.documentation = docMap.get(variable.name);
                }
            });
        }

        // Process relationship documentation if present
        if (originalResponse.relationships && updatedModel.relationships) {
            // Create a map for relationships using from-to pair as key
            const relationshipMap = new Map();
            originalResponse.relationships.forEach(relationship => {
                const key = `${relationship.from}:${relationship.to}`;
                relationshipMap.set(key, relationship);
            });

            updatedModel.relationships.forEach(relationship => {
                const key = `${relationship.from}:${relationship.to}`;
                if (relationshipMap.has(key)) {
                    const docRelationship = relationshipMap.get(key);
                    relationship.reasoning = docRelationship.reasoning;

                    // Update polarity if it was generated
                    if (docRelationship.polarity) {
                        relationship.polarity = docRelationship.polarity;
                    }
                    if (docRelationship.polarityReasoning) {
                        relationship.polarityReasoning = docRelationship.polarityReasoning;
                    }
                }
            });
        }

        // Convert summary markdown to HTML if needed
        let introMessage = "I have documented all model variables.";
        if (originalResponse.relationships && updatedModel.relationships) {
            introMessage = "I have documented all model variables and relationships.";
        }
        let summaryHtml = introMessage + "<br/><br/>" + originalResponse.summary;
        if (summaryHtml && !this.#containsHtmlTags(summaryHtml)) {
            summaryHtml = await marked.parse(summaryHtml);
        }

        return {
            model: updatedModel,
            explanation: summaryHtml,
            title: "Documentation Summary"
        };
    }

    setupLLMParameters(userPrompt, currentModel) {
        if (!currentModel) {
            throw new Error("A model must be provided to generate documentation.");
        }

        // Extract variables from the model
        const variables = this.#extractVariablesFromModel(currentModel);

        if (variables.length === 0) {
            throw new Error("No variables found in the model to document.");
        }

        // Start with the system prompt
        const { underlyingModel, systemRole, temperature, reasoningEffort } = this.#llmWrapper.getLLMParameters();
        let responseFormat = this.#llmWrapper.generateDocumentationResponseSchema(
            this.#data.documentConnectors,
            this.#data.generatePolarity
        );
        let systemPrompt = this.#data.systemPrompt;

        // If documenting connectors, update the system prompt to include relationship documentation
        if (this.#data.documentConnectors) {
            systemPrompt += "\n\nIn addition to documenting variables, you should also document the relationships (connectors) between variables. For each relationship, provide a clear reasoning explaining why this connection exists and how the variables influence each other.";

            // Add polarity generation instructions if requested
            if (this.#data.generatePolarity) {
                systemPrompt += " For each relationship, also determine the polarity (+ or -) and provide reasoning for why that polarity was chosen.";
            }
        }

        let messages = [{
            role: systemRole,
            content: systemPrompt
        }];

        if (this.#data.backgroundKnowledge) {
            messages.push({
                role: "user",
                content: this.#data.backgroundPrompt.replaceAll("{backgroundKnowledge}", this.#data.backgroundKnowledge),
            });
        }

        if (this.#data.problemStatement) {
            messages.push({
                role: systemRole,
                content: this.#data.problemStatementPrompt.replaceAll("{problemStatement}", this.#data.problemStatement),
            });
        }

        // Provide the current model structure with variables
        messages.push({
            role: "user",
            content: `Here is the current model:\n\n${JSON.stringify(currentModel, null, 2)}`
        });

        // Give it the user prompt
        if (userPrompt) {
            messages.push({ role: "user", content: userPrompt });
        }

        return {
            messages,
            model: underlyingModel,
            temperature: temperature,
            reasoningEffort: reasoningEffort,
            responseFormat: responseFormat
        };
    }

    async generate(userPrompt, currentModel) {
        const llmParams = this.setupLLMParameters(userPrompt, currentModel);

        // Get its response
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
            return await this.#processResponse(originalResponse.parsed, currentModel);
        } else if (originalResponse.content) {
            let parsedObj = { variables: [], summary: "" };
            try {
                parsedObj = JSON.parse(originalResponse.content);
            } catch (err) {
                throw new ResponseFormatError("Bad JSON returned by underlying LLM");
            }
            return await this.#processResponse(parsedObj, currentModel);
        } else {
            throw new ResponseFormatError("LLM response did not contain any recognized format (no refusal, parsed, or content fields)");
        }
    }
}

export default GenerateDocumentationBrain;
