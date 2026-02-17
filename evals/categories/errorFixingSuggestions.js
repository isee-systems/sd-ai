/**
 * This is the error fixing suggestions test
 *
 * The error fixing suggestions evaluation category tests whether model discussion engines (like Seldon)
 * can identify and explain formulation errors in system dynamics models. Unlike quantitativeErrorFixing
 * which tests engines that directly fix models, this tests engines that provide explanations and
 * suggestions for fixing errors.
 *
 * @module categories/errorFixingSuggestions
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prompt = `Please analyze the given model for formulation errors. Please take into account the style of existing formulations i.e. pipeline delays vs. exponential delays etc. Identify any errors you find, explain why they are errors, and suggest how to fix them.`;

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The error fixing suggestions test evaluates whether a model discussion engine can identify and explain formulation errors in system dynamics models. It tests the engine's ability to detect errors and provide clear explanations and suggestions for fixes.`;
};

/**
 * Generate a test case for a COVID model with errors
 * @param {string} name - The name of the test case
 * @param {string} errorFileName - The filename of the error model (without path)
 * @param {Array} errorExplanations - Array of expected error explanations
 * @returns {object} Test case object
 */
const generateCovidTest = function(name, errorFileName, errorExplanations) {
    // Load the error model
    const errorModelPath = path.join(__dirname, 'quantitativeErrorFixingData', errorFileName);
    const errorModel = JSON.parse(fs.readFileSync(errorModelPath, 'utf8'));

    // Define problem statement
    const problemStatement = "I'm building a COVID epidemiological model and I want to verify that my formulations are correct.";

    return {
        name: name,
        prompt: prompt,
        currentModel: errorModel.model,
        additionalParameters: {
            problemStatement: problemStatement,
            feedbackContent: errorModel.feedback
        },
        expectations: errorExplanations
    };
};

/**
 * This method compares the generated explanation to the expected error fixes using an LLM
 * @param {Object} generatedResponse The response from the discussion engine containing error explanations
 * @param {Array<Object>} expectations The expected error explanations
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const expectedErrors = expectations;

    // Create LLMWrapper instance configured for gemini-2.5-flash
    const llm = new LLMWrapper({
        underlyingModel: 'gemini-2.5-flash'
    });

    // Extract the text content from the generated response
    const generatedText = generatedResponse.output.textContent || JSON.stringify(generatedResponse);

    if (!generatedText) {
        failures.push({
            type: "Missing explanation",
            details: "The response does not contain any text explaining the errors"
        });
        return failures;
    }

    try {
        // Build a list of all expected errors
        const errorList = expectedErrors.map((expectedError, index) => {
            const errorName = expectedError.name.replace(/_/g, ' ');
            return `${index + 1}. The model has an error in the variable "${errorName}". The error is: ${expectedError.problem}`;
        }).join('\n');

        const messages = [
            {
                role: 'system',
                content: 'Your job is to determine which errors from a given list are explained in the provided text. The text may not use the exact wording, but should identify the variable and explain the nature of the error. For each error in the list, determine if it is clearly identified and explained in the text.'
            },
            {
                role: 'user',
                content: `Here is the explanation to analyze:\n\n${generatedText}\n\nBased on the explanation above, which of the following errors are identified and explained?\n\n${errorList}`
            }
        ];

        // Define structured output schema using Zod
        const structuredOutputSchema = z.object({
            explainedErrorNumbers: z.array(z.number()).describe('Array of error numbers (1-indexed) that are clearly identified and explained in the text')
        });

        // Get LLM parameters
        const { underlyingModel, temperature } = llm.getLLMParameters(0);

        // Call the LLM with structured output
        const response = await llm.createChatCompletion(
            messages,
            underlyingModel,
            structuredOutputSchema,
            temperature
        );

        // Parse the structured response
        let explainedErrors = [];
        try {
            const parsedContent = JSON.parse(response.content);
            explainedErrors = parsedContent.explainedErrorNumbers || [];
        } catch (parseError) {
            failures.push({
                type: "Evaluation error",
                details: `Error parsing LLM structured output: ${parseError.message}. Response was: ${response.content}`
            });
        }

        // Check which errors were not explained
        expectedErrors.forEach((expectedError, index) => {
            const errorNumber = index + 1;
            if (!explainedErrors.includes(errorNumber)) {
                const errorName = expectedError.name.replace(/_/g, ' ');
                failures.push({
                    type: "Error not explained",
                    details: `The explanation should identify and explain the error in "${errorName}": ${expectedError.problem}`
                });
            }
        });
    } catch (error) {
        failures.push({
            type: "Evaluation error",
            details: `Error checking error explanations: ${error.message}`
        });
    }

    return failures;
};

export const groups = {
    "covidDelayErrors": [
        generateCovidTest("COVID delay error 1", "COVID_delay_err1.json",
            [
                { name: "total_incubation", problem: "Should use DELAY3 with the 'Infection' flow as input, not the 'Exposed population' stock divided by a time constant."}
            ]
        ),
        generateCovidTest("COVID delay error 2", "COVID_delay_err2.json",
            [
                { name: "developing_symptoms", problem: "Should use the flows 'Incubation + Influx of presymptomatic infectious people from abroad' as input to DELAY3, not the stock 'Presymptomatic infectious' divided by a time constant."}
            ]
        ),
        generateCovidTest("COVID delay error 4", "COVID_delay_err4.json",
            [
                { name: "recovery_without_symptoms", problem: "Should use DELAY3 with the 'Asymptomatic incubation' flow as input, not the 'Asymptomatic infectious' stock divided by a time constant."}
            ]
        )
    ],
    "covidLookupErrors": [
        generateCovidTest("COVID lookup error 1", "COVID_lookup_err1.json",
            [
                { name: "influx_of_presymptomatic_infectious_people_from_abroad", problem: "The graphical function should use TIME as an input, not DT."}
            ]
        ),
        generateCovidTest("COVID lookup error 2", "COVID_lookup_err2.json",
            [
                { name: "social_distancing_measures", problem: "The graphical function should use TIME as an input, not DT."}
            ]
        )
    ],
    "covidSumErrors": [
        generateCovidTest("COVID sum error 1", "COVID_sum_err1.json",
            [
                { name: "total_population", problem: "Total population should be an auxiliary/converter variable that sums the population stocks, not a stock."}
            ]
        ),
        generateCovidTest("COVID sum error 2", "COVID_sum_err2.json",
            [
                { name: "infectious_population", problem: "Infectious population should be an auxiliary/converter variable that sums the three infectious stocks, not a stock."}
            ]
        )
    ]
};
