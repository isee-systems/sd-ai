/**
 * This is the feedback explanation test
 *
 * The feedback explanation evaluation category tests whether engines can identify and extract
 * specific facts from the output of a discussion engine. This evaluation uses structured
 * output to verify that the model can accurately parse explanatory text and identify
 * discrete factual statements.
 *
 * @module categories/feedbackExplanation
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load the JSON data files
const armsRaceModel = JSON.parse(
    readFileSync(join(__dirname, 'feedbackExplanationData', 'armsRace.json'), 'utf-8')
);
const bassDiffusionModel = JSON.parse(
    readFileSync(join(__dirname, 'feedbackExplanationData', 'bassDiffusion.json'), 'utf-8')
);

const inventoryWorforceModel = JSON.parse(
    readFileSync(join(__dirname, 'feedbackExplanationData', 'inventoryWorkforce.json'), 'utf-8')
);

const predatorPreyModel = JSON.parse(
    readFileSync(join(__dirname, 'feedbackExplanationData', 'predatorPrey.json'), 'utf-8')
);

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The feedback explanation test evaluates whether engines can accurately explain the origins of behavior of models.  It does so by checking for the prescence of known facts in the text returned by an engine.`;
};

/**
 * Generates the test case for feedback explanation extraction
 * @param {string} name The name of the test
 * @param {Object} modelData The model and feedback data
 * @param {Array<string>} facts The expected facts to be extracted
 * @returns {Object} Test case with prompt, parameters, and expectations
 */
const generateTest = function(name, modelData, facts) {
    return {
        name: name,
        prompt: "Please explain the behavior of this model over time based on the feedback loop domaince analysis provided.",
        currentModel: modelData.model,
        additionalParameters: {
            feedbackContent: modelData.feedback
        },
        expectations: facts
    };
};

/**
 * This method compares the generated response to the expected facts and returns a list of failure objects
 * @param {Object} generatedResponse The response from the engine containing extracted facts
 * @param {Object} expectations The expected facts
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const expectedFacts = expectations;

    // Create LLMWrapper instance configured for gemini-2.5-flash-preview-09-2025
    const llm = new LLMWrapper({
        underlyingModel: 'gemini-2.5-flash-preview-09-2025'
    });

    // Iterate through each expected fact
    for (const expectedFact of expectedFacts) {
        try {
            // Create messages for the LLM
            const messages = [
                {
                    role: 'system',
                    content: 'Your job is to determine if a given statement is true based only on the information provided. You will be given some text, and then asked to verify if a specific statement is supported by that text. Answer only "true" if the statement is clearly supported by the text, or "false" if it is not supported or contradicted by the text.'
                },
                {
                    role: 'user',
                    content: `Here is the text to analyze:\n\n${generatedResponse.textContent || JSON.stringify(generatedResponse)}`
                },
                {
                    role: 'user',
                    content: `Based only on the information provided above, is the following statement true?\n\nStatement: "${expectedFact}"\n\nAnswer with only "true" or "false".`
                }
            ];

            // Get LLM parameters
            const { underlyingModel, temperature } = llm.getLLMParameters(0);

            // Call the LLM
            const response = await llm.createChatCompletion(
                messages,
                underlyingModel,
                null,
                temperature
            );

            // Check if the response indicates the fact is not present
            const isTrue = response.content.toLowerCase().trim().includes('true');

            if (!isTrue) {
                failures.push({
                    type: 'Missing expected fact',
                    details: `The following expected fact was not found in the generated explanation: "${expectedFact}"`
                });
            }
        } catch (error) {
            failures.push({
                type: 'Evaluation error',
                details: `Error checking fact "${expectedFact}": ${error.message}`
            });
        }
    }

    return failures;
};


/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    "feedbackExplanation": [
        generateTest(
            "Arms race dynamics explanation",
            armsRaceModel,
            [
                "There are three feedback loops in this model.  Two balancing (negative) feedback loops, and a single reinforcing (positive) feedback loop.",
                "Before time 7.625 the system's behavior is dominated by balancing (negative) feedback loops.",
                "After time 7.625, the system's behavior is dominated by the reinforcing (positive) feedback loop.",
            ]
        ),
        generateTest(
            "Bass diffusion dynamics explanation",
            bassDiffusionModel,
            [
                "There are two feedback loops in this model. A balancing (negative) feedback loop and a reinforcing (positive) feedback loop.",
                "Before time 9.625 the system's behavior is dominated by the reinforcing (positive) feedback loop.",
                "After time 9.625, the system's behavior is dominated by the balancing (negative) feedback loop.",
            ]
        ),
        generateTest(
            "Inventory workforce dynamics explanation",
            inventoryWorforceModel,
            [
                "There are three balancing feedback loops in this model, all are balancing.  One involves both inventory and workforce, one just workforce",
                "The balancing feedback process involving both inventory and workforce is primarily responsible for the oscillation in behavior",
                "The balancing feedback process involving just workforce represents the worker adjustment process and is also involved with the oscillation in behavior",
            ]
        ),
        generateTest(
            "Predator prey dynamics explanation",
            predatorPreyModel,
            [
                "The model produces oscillations",
                "The growth part of the oscillations are driven by reinforcing loops involving hare births and lynx births",
                "The decline part of the oscillaitons are driven by balancing feedback loops relating to deaths, especially the predation/starvation process"
            ]
        )
    ]
};