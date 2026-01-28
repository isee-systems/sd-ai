/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The quantitative error fixing test evaluates an engine's ability to identify and fix formulation errors
in system dynamics models. The engine is given a model with known errors and must generate a corrected model
along with an explanation of the errors, why they were errors, and how they were fixed.`;
}

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import utils from '../../utilities/utils.js';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prompt = `Please analyze the given model for formulation errors. Please take into account the style of existing formulations i.e. pipeline delays vs. exponential delays etc. If the given model contains formulation errors please fix each formulation error you identify and generate an explanation that contains a listing of all errors, why they were an error, and how you fixed them.  Do not add any new variables, or change the name of any existing variables.  Under no circumstances are you to add new relationships or feedback loops to this model.`;

/**
 * Generate a test case for a COVID-19 model with errors
 * @param {string} name - The name of the test case
 * @param {string} errorFileName - The filename of the error model (without path)
 * @returns {object} Test case object
 */
const generateCovidTest = function(name, errorFileName, errorExplanations) {
    // Load the correct model
    const correctModelPath = path.join(__dirname, 'quantitativeErrorFixingData', 'covid_correct.json');
    const correctModel = JSON.parse(fs.readFileSync(correctModelPath, 'utf8'));

    // Load the error model
    const errorModelPath = path.join(__dirname, 'quantitativeErrorFixingData', errorFileName);
    const errorModel = JSON.parse(fs.readFileSync(errorModelPath, 'utf8'));

    // Define problem statement
    const problemStatement = "I'm building a COVID-19 epidemiological model and I need to ensure the formulations I have given you are correct.";

    return {
        name: name,
        prompt: prompt,
        currentModel: errorModel.model,
        additionalParameters: {
            problemStatement: problemStatement
        },
        expectations: {
            correctModel: correctModel.model,
            errorExplanations: errorExplanations        
        }
    };
};

/**
 * Compare two variable names (case-insensitive and flexible matching)
 */
const compareNames = function(name1, name2) {
    return utils.sameVars(name1, name2);
};

/**
 * Find a variable by name in an array of variables
 */
const findVariable = function(variables, name) {
    return variables.find(v => compareNames(v.name, name));
};

/**
 * Compare two equations (allowing for minor formatting differences)
 */
const compareEquations = function(eq1, eq2) {
    const normalize = (eq) => {
        if (eq === undefined || eq === null) return '';
        return eq.toString().replace(/\s+/g, '').toLowerCase();
    };
    return normalize(eq1) === normalize(eq2);
};

/**
 * Check if error explanations are present in the generated explanation using LLM
 * @param {string} explanation - The generated explanation text
 * @param {Array} errorExplanations - Array of expected error explanations
 * @returns {Array} Array of failures for errors not explained
 */
const checkErrorExplanations = async function(explanation, errorExplanations) {
    const failures = [];

    if (!explanation) {
        failures.push({
            type: "Missing explanation",
            details: "The response should include an explanation of the errors found and how they were fixed"
        });
        return failures;
    }

    // Create LLMWrapper instance configured for gemini-2.5-flash-preview-09-2025
    const llm = new LLMWrapper({
        underlyingModel: 'gemini-2.5-flash-preview-09-2025'
    });

    try {
        // Build a list of all expected errors
        const errorList = errorExplanations.map((expectedError, index) => {
            const errorName = expectedError.name.replace(/_/g, ' ');
            return `${index + 1}. The model had an error in the variable "${errorName}". The error was: ${expectedError.problem}`;
        }).join('\n');

        const messages = [
            {
                role: 'system',
                content: 'Your job is to determine which errors from a given list are explained in the provided text. You will be given an explanation text from a model debugging session, and a numbered list of expected errors. For each error in the list, determine if it is clearly identified and explained in the text.'
            },
            {
                role: 'user',
                content: `Here is the explanation to analyze:\n\n${explanation}\n\nBased on the explanation above, which of the following errors are identified and explained?\n\n${errorList}`
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
        errorExplanations.forEach((expectedError, index) => {
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

/**
 * Evaluate the generated model against the correct model
 */
export const evaluate = async function(generatedResponse, groundTruth) {
    const generatedModel = generatedResponse?.model || {};
    const correctModel = groundTruth.correctModel;

    const failures = [];

    // Check if the model exists
    if (!generatedModel || !generatedModel.variables) {
        failures.push({
            type: "Model structure missing",
            details: "The generated response does not contain a valid model structure with variables"
        });
        return failures;
    }

    const generatedVars = generatedModel.variables || [];
    const correctVars = correctModel.variables || [];

    // Check that all correct variables are present
    for (const correctVar of correctVars) {
        const generatedVar = findVariable(generatedVars, correctVar.name);

        if (!generatedVar) {
            failures.push({
                type: "Missing variable",
                details: `Variable "${correctVar.name}" is missing from the generated model`
            });
            continue;
        }

        // Check type consistency
        if (generatedVar.type !== correctVar.type) {
            failures.push({
                type: "Incorrect variable type",
                details: `Variable "${correctVar.name}" should be type "${correctVar.type}" but is "${generatedVar.type}"`
            });
            continue;
        }


        // Check equation correctness for variables with equations
        if (correctVar.equation) {
            if (!compareEquations(generatedVar.equation, correctVar.equation)) {
                failures.push({
                    type: "Incorrect equation",
                    details: `Variable "${correctVar.name}" has incorrect equation.\nExpected: ${correctVar.equation}\nGot: ${generatedVar.equation}`
                });
                continue;
            }
        }

        // For stocks, check inflows and outflows
        if (correctVar.type === 'stock') {
            const correctInflows = correctVar.inflows || [];
            const generatedInflows = generatedVar.inflows || [];

            for (const inflow of correctInflows) {
                if (!generatedInflows.some(i => compareNames(i, inflow))) {
                    failures.push({
                        type: "Missing inflow",
                        details: `Stock "${correctVar.name}" is missing inflow "${inflow}"`
                    });
                }
            }

            const correctOutflows = correctVar.outflows || [];
            const generatedOutflows = generatedVar.outflows || [];

            for (const outflow of correctOutflows) {
                if (!generatedOutflows.some(o => compareNames(o, outflow))) {
                    failures.push({
                        type: "Missing outflow",
                        details: `Stock "${correctVar.name}" is missing outflow "${outflow}"`
                    });
                }
            }
        }

        // Check units consistency
        if (correctVar.units && generatedVar.units !== correctVar.units) {
            failures.push({
                type: "Incorrect units",
                details: `Variable "${correctVar.name}" should have units "${correctVar.units}" but has "${generatedVar.units}"`
            });
            continue;
        }
    }

    // Check if explanation mentions the expected errors using LLM
    const errorExplanations = groundTruth.errorExplanations || [];
    if (errorExplanations.length > 0 && failures.length === 0) {
        const explanation = generatedResponse?.supportingInfo.explanation || '';
        const explanationFailures = await checkErrorExplanations(explanation, errorExplanations);
        failures.push(...explanationFailures);
    }

    return failures;
};

export const groups = {
    "covidModelErrors": [
        generateCovidTest("COVID-19 model with errors 1", "covid_err1.json",
            [
                { name: "total_incubation", problem: "Should use DELAY3 with the 'Infection' flow as input, not the 'Exposed population' stock divided by a time constant."},
                { name: "influx_of_presymptomatic_infectious_people_from_abroad", problem: "The graphical function should use TIME as an input, not DT (DT)."},
                { name: "total_population", problem: "Total population should be an auxiliary/converter variable that sums the population stocks, not a stock."}
            ]
        ),
        generateCovidTest("COVID-19 model with errors 2", "covid_err2.json",
            [
                { name: "developing_symptoms", problem: "Should use the flows 'Incubation + Influx of presymptomatic infectious people from abroad' as input to DELAY3, not the stock 'Presymptomatic infectious' divided by a time constant."},
                { name: "influx_of_presymptomatic_infectious_people_from_abroad", problem: "The graphical function should use TIME as an input, not DT (DT)."},
                { name: "infectious_population", problem: "Infectious population should be an auxiliary/converter variable that sums the three infectious stocks, not a stock."}
            ]
        ),
        generateCovidTest("COVID-19 model with errors 3", "covid_err3.json",
            [
                { name: "additional_case_estimates", problem: "Should use SMOOTH function to calculate the average over the estimation period, not DELAY1 which only delays the value."},
                { name: "social_distancing_measures", problem: "The graphical function should use TIME as an input, not DT (DT)."},
                { name: "total_population", problem: "Total population should be an auxiliary/converter variable that sums the population stocks, not a stock with an integral (INTEG) function."}
            ]
        ),
        generateCovidTest("COVID-19 model with errors 4", "covid_err4.json",
            [
                { name: "recovery_without_symptoms", problem: "Should use DELAY3 with the 'Asymptomatic incubation' flow as input, not the 'Asymptomatic infectious' stock divided by a time constant."},
                { name: "social_distancing_measures", problem: "The graphical function should use TIME as an input, not DT (DT)."},
                { name: "infectious_population", problem: "Infectious population should be an auxiliary/converter variable that sums the three infectious stocks, not a stock."}
            ]
        )
    ]
};
