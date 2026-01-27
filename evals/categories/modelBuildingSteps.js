/**
 * This is the model building steps test
 *
 * The model building steps evaluation category tests whether model discussion engines can generate
 * appropriate steps to build a model given a problem statement and background knowledge.
 * This evaluation uses an LLM to verify that the generated steps match the expected
 * ground truth steps for building the model.
 *
 * @module categories/modelBuildingSteps
 */

import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import { z } from 'zod';

// Test data: Each contains a problem statement, background knowledge, and ground truth steps
const armsRaceProblem = {
    problemStatement: "Two countries are engaged in an arms race. Each country builds weapons based on the perceived threat from the other country's arsenal. Model this dynamic interaction.",
    backgroundKnowledge: "Arms races involve reciprocal threat perceptions where each side responds to the other's military buildup. The rate of weapons acquisition is typically proportional to the gap between one's own arsenal and the perceived threat from the opponent.",
    groundTruthSteps: [
        "Create two stocks representing the arsenals of Country A and Country B",
        "Add a flow to increase Country A's arsenal based on Country B's arsenal size",
        "Add a flow to increase Country B's arsenal based on Country A's arsenal size",
        "Include parameters for the rate at which each country responds to the other's arsenal",
        "Consider adding depreciation or retirement flows for aging weapons"
    ]
};

const bassDiffusionProblem = {
    problemStatement: "A new product is being introduced to a market. Sales occur through two channels: advertising (innovation) and word-of-mouth from existing adopters (imitation). Model how the product diffuses through the population over time.",
    backgroundKnowledge: "The Bass Diffusion model describes how new products spread through a population. Initial adoption happens through external influences like advertising, while later adoption is driven by social influence from existing users. There is a finite potential market of adopters.",
    groundTruthSteps: [
        "Create a stock representing potential adopters (people who haven't adopted yet)",
        "Create a stock representing adopters (people who have adopted the product)",
        "Add a flow from potential adopters to adopters representing the adoption rate",
        "Calculate adoption rate as the sum of innovation (advertising effect) and imitation (word-of-mouth effect)",
        "Innovation effect should be proportional to the number of potential adopters",
        "Imitation effect should be proportional to both potential adopters and current adopters (contact between groups)"
    ]
};

const inventoryManagementProblem = {
    problemStatement: "A company needs to manage its inventory and workforce levels in response to customer orders. There are delays in adjusting workforce levels and in production. Model how the company manages these resources.",
    backgroundKnowledge: "Inventory management involves balancing production with demand. Workforce can be adjusted but with delays. Production depends on the workforce level. Companies typically adjust both inventory and workforce based on gaps between desired and actual levels.",
    groundTruthSteps: [
        "Create a stock for inventory level",
        "Create a stock for workforce level",
        "Add a production flow that increases inventory, with production rate determined by workforce",
        "Add a shipment/sales flow that decreases inventory based on customer orders",
        "Add a hiring flow that increases workforce",
        "Add an attrition/firing flow that decreases workforce",
        "Calculate desired inventory based on expected orders and safety stock",
        "Calculate desired workforce based on desired production level",
        "Adjust workforce based on the gap between desired and actual workforce",
        "Include delays in workforce adjustment and production"
    ]
};

const predatorPreyProblem = {
    problemStatement: "Model the population dynamics of a predator species (lynx) and its prey (hares) in an ecosystem. The prey population grows naturally but is reduced by predation. The predator population grows when food is abundant but declines when prey is scarce.",
    backgroundKnowledge: "Predator-prey systems exhibit cyclical dynamics. Prey populations grow through births but are limited by predation. Predator populations grow when prey is abundant (successful hunting leads to reproduction) but decline through starvation when prey is scarce. These dynamics create oscillating populations.",
    groundTruthSteps: [
        "Create a stock for the hare (prey) population",
        "Create a stock for the lynx (predator) population",
        "Add a birth flow for hares based on the hare population and a birth rate",
        "Add a death flow for hares due to predation, proportional to both hare and lynx populations (encounter rate)",
        "Add a birth flow for lynx based on successful predation (food availability) and lynx population",
        "Add a death flow for lynx based on starvation, proportional to the lynx population"
    ]
};

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The model building steps test evaluates whether a model discussion engine can generate appropriate steps to build a system dynamics model given a problem statement and background knowledge. It uses an LLM to verify that the generated steps match the expected ground truth steps.`;
};

/**
 * Generates the test case for model building steps
 * @param {string} name The name of the test
 * @param {Object} problemData The problem statement, background knowledge, and ground truth steps
 * @returns {Object} Test case with prompt, parameters, and expectations
 */
const generateTest = function(name, problemData) {
    return {
        name: name,
        prompt: "Given the following problem statement and background knowledge, provide a set of steps to build a system dynamics model that addresses this problem.",
        currentModel: null, // No model is provided as input
        additionalParameters: {
            problemStatement: problemData.problemStatement,
            backgroundKnowledge: problemData.backgroundKnowledge
        },
        expectations: problemData.groundTruthSteps
    };
};

/**
 * This method compares the generated steps to the expected ground truth steps using an LLM
 * @param {Object} generatedResponse The response from Seldon containing the generated steps
 * @param {Array<string>} expectations The expected ground truth steps
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const groundTruthSteps = expectations;

    // Create LLMWrapper instance configured for gemini-2.5-flash-preview-09-2025
    const llm = new LLMWrapper({
        underlyingModel: 'gemini-2.5-flash-preview-09-2025'
    });

    // Extract the text content from the generated response
    const generatedText = generatedResponse.textContent || JSON.stringify(generatedResponse);

    // Define the structured output schema using Zod
    const stepEvaluationSchema = z.object({
        evaluations: z.array(z.object({
            stepNumber: z.number().int().positive().describe('The number of the ground truth step (1-indexed)'),
            covered: z.boolean().describe('True if the concept is adequately covered in the generated steps, false otherwise'),
            explanation: z.string().describe('A brief explanation of the assessment')
        }))
    });

    // Create evaluation prompt
    const messages = [
        {
            role: 'system',
            content: 'You are an expert in system dynamics modeling. Your job is to evaluate whether a set of generated model-building steps adequately covers the key concepts from a set of ground truth steps. The generated steps do not need to be identical or in the same order, but they should capture the essential modeling elements.'
        },
        {
            role: 'user',
            content: `Here are the model-building steps that were generated:\n\n${generatedText}\n\nHere are the ground truth steps that should be covered:\n\n${groundTruthSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\nFor each ground truth step (in order), determine if the generated steps adequately cover that concept.`
        }
    ];

    try {
        // Get LLM parameters
        const { underlyingModel, temperature } = llm.getLLMParameters(0);

        // Call the LLM with structured output
        const response = await llm.createChatCompletion(
            messages,
            underlyingModel,
            stepEvaluationSchema,
            temperature
        );

        // Parse the structured response
        const evaluationResults = JSON.parse(response.content);

        // Check each ground truth step
        for (const result of evaluationResults.evaluations) {
            if (!result.covered) {
                const stepIndex = result.stepNumber - 1;
                failures.push({
                    type: 'Missing or inadequate step',
                    details: `Ground truth step ${result.stepNumber} not adequately covered: "${groundTruthSteps[stepIndex]}". Explanation: ${result.explanation}`
                });
            }
        }
    } catch (error) {
        failures.push({
            type: 'Evaluation error',
            details: `Error during LLM evaluation: ${error.message}`
        });
    }

    return failures;
};

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    "simpleModelBuildingSteps": [
        generateTest(
            "Arms race model building steps",
            armsRaceProblem
        ),
        generateTest(
            "Bass diffusion model building steps",
            bassDiffusionProblem
        )
    ],
    "mediumModelBuildingSteps": [
        generateTest(
            "Inventory management model building steps",
            inventoryManagementProblem
        ),
        generateTest(
            "Predator prey model building steps",
            predatorPreyProblem
        )
    ]
};
