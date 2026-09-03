/**
 * Behavioral Pattern Evaluation
 *
 * This evaluation tests the LLM's ability to build System Dynamics models that exhibit
 * specific behavioral patterns over time. The evaluation prompts the engine to create
 * models that produce five fundamental behavioral patterns:
 *
 * 1. Exponential Growth - rapid accelerating increase
 * 2. Exponential Decay - rapid decelerating decrease
 * 3. Logistic Growth (S-curve) - growth that levels off at carrying capacity
 * 4. Logistic Decay - decay that levels off at a floor value
 * 5. Standing Oscillation - sustained periodic fluctuation
 *
 * Each model must include a variable called "output" that demonstrates the target behavior.
 * The evaluation uses PySDSimulator to convert the LLM's sd-json response to XMILE format,
 * simulate it, and then uses the time-series-behavior-analysis tool to verify the behavior
 * of the "output" variable matches the expected pattern.
 *
 * @module categories/behavioralPattern
 */

import PySDSimulator from '../utilities/simulator/PySDSimulator.js';
import { validateEvaluationResult } from '../evaluationSchema.js';
import BehaviorClassifier from '../utilities/BehaviorClassifier.js';
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';
import fs from 'fs';
import path from 'path';

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The behavioral pattern evaluation assesses an LLM's ability to build System Dynamics models that
exhibit specific time-series behaviors including exponential growth, exponential decay, logistic growth,
logistic decay, and standing oscillation patterns in a designated output variable.`;
};


/**
 * Generate a behavioral pattern test
 * @param {string} name - Test name
 * @param {string} patternDescription - Description of the behavioral pattern
 * @param {string} expectedBehavior - Expected behavior label (e.g., 'exponential_growth')
 * @param {string} backgroundKnowledge - Background information about the pattern
 * @returns {Object} Test configuration object
 */
const generateBasicBehaviorModeTest = function(name, patternDescription, expectedBehavior, backgroundKnowledge) {
    return {
        name: name,
        prompt: `Please create a model that demonstrates ${patternDescription}. The model must include a variable named 'output' that shows this behavior over time.`,
        additionalParameters: {
            problemStatement: `I need a model that exhibits ${patternDescription} in the 'output' variable.`,
            backgroundKnowledge: backgroundKnowledge
        },
        expectations: {
            expectedBehavior: expectedBehavior
        }
    };
};


/**
 * Evaluates whether the generated model produces the expected behavioral pattern
 * @param {Object} generatedResponse The response from the engine containing the model
 * @param {Object} requirements The expected behavioral pattern
 * @returns {Array<Object>} A list of failures with type and details
 */
export const evaluate = async function(generatedResponse, requirements) {
    const fails = [];

    try {
        // Check if model exists
        if (!generatedResponse.model) {
            fails.push({
                type: "Missing model",
                details: "The response does not contain a model"
            });
            return validateEvaluationResult(fails);
        }

        const model = generatedResponse.model;

        // Check if "output" variable exists
        const outputVariable = model.variables?.find(v =>
            v.name.toLowerCase() === 'output'
        );

        if (!outputVariable) {
            fails.push({
                type: "Missing output variable",
                details: "The model does not contain a variable named 'output'"
            });
            return validateEvaluationResult(fails);
        }

        // Convert model to XMILE
        let xmileContent;
        try {
            xmileContent = SDJsonToXMILE(generatedResponse, {
                modelName: model.name || 'Behavioral Pattern Model',
                vendor: 'SD-AI Evaluation',
                product: 'sd-ai-evals',
                version: '1.0'
            });
        } catch (error) {
            fails.push({
                type: "XMILE conversion error",
                details: `Failed to convert model to XMILE: ${error.message}`
            });
            return validateEvaluationResult(fails);
        }

        // Simulate the model
        let simulationResults;
        try {
            const simulator = new PySDSimulator(xmileContent);
            simulationResults = await simulator.simulate(['output']);
        } catch (error) {
            fails.push({
                type: "Simulation error",
                details: `Failed to simulate the model: ${error.message}`
            });
            return validateEvaluationResult(fails);
        }

        // Get the output time series
        const outputTimeSeries = simulationResults.output;

        if (!outputTimeSeries || !Array.isArray(outputTimeSeries) || outputTimeSeries.length === 0) {
            fails.push({
                type: "Invalid simulation output",
                details: "Simulation did not produce valid time series data for 'output' variable"
            });
            return validateEvaluationResult(fails);
        }

        // Check if the behavior matches the expected pattern
        const expectedPattern = requirements.expectedBehavior;
        let patternCheck;
        try {
            patternCheck = await BehaviorClassifier.checkPattern(outputTimeSeries, expectedPattern, {
                minConfidence: 0.5
            });
        } catch (error) {
            fails.push({
                type: "Behavior classification error",
                details: `Failed to classify behavior: ${error.message}`
            });
            return validateEvaluationResult(fails);
        }

        if (!patternCheck.matches) {
            if (patternCheck.detected !== expectedPattern) {
                fails.push({
                    type: "Incorrect behavioral pattern",
                    details: `Expected '${expectedPattern}' but detected '${patternCheck.detected}' (confidence: ${(patternCheck.confidence * 100).toFixed(1)}%)`
                });
            } else {
                // Pattern matches but confidence is too low
                fails.push({
                    type: "Low confidence in pattern detection",
                    details: `Pattern '${patternCheck.detected}' detected with low confidence: ${(patternCheck.confidence * 100).toFixed(1)}%`
                });
            }
            /*
            if (false) {
                // Write CSV file with the mismatched behavior
                try {
                    const csvFileName = `${patternCheck.detected}_but_expected_${expectedPattern}.csv`;
                    const csvPath = path.join(process.cwd(), csvFileName);

                    // Create CSV content with time series data
                    let csvContent = 'time,value\n';
                    outputTimeSeries.forEach((value, index) => {
                        csvContent += `${index},${value}\n`;
                    });

                    fs.writeFileSync(csvPath, csvContent, 'utf8');
                } catch (csvError) {
                    // Log error but don't fail the evaluation because of CSV writing
                    console.error(`Failed to write CSV file: ${csvError.message}`);
                }
            }
            */
        }

    } catch (error) {
        fails.push({
            type: "Unexpected evaluation error",
            details: error.message
        });
    }

    return validateEvaluationResult(fails);
};

/**
 * Test cases for each behavioral pattern
 */
const behavioralPatterns = [
    generateBasicBehaviorModeTest(
        "Exponential Growth Pattern",
        "exponential growth behavior",
        "exponential_growth",
        "Exponential growth occurs when the rate of increase is proportional to the current value. This creates a reinforcing feedback loop where larger values grow faster. Examples include compound interest, viral spread, and unconstrained population growth. A classic example would be compound interest or unconstrained population growth where the rate of growth is proportional to the current value."
    ),
    generateBasicBehaviorModeTest(
        "Exponential Decay Pattern",
        "exponential decay behavior",
        "exponential_decline",
        "Exponential decay occurs when the rate of decrease is proportional to the current value. This creates a negative feedback loop where the value decreases rapidly at first, then more slowly as it approaches zero. Examples include radioactive decay, drug elimination from the body, and temperature cooling. The output should show rapid decrease that slows over time, asymptotically approaching zero."
    ),
    generateBasicBehaviorModeTest(
        "Logistic Growth Pattern",
        "logistic growth (S-curve) behavior",
        "s_curve_growth",
        "Logistic growth combines reinforcing and balancing feedback. Initially, growth is exponential due to reinforcing feedback. As the system approaches its carrying capacity, balancing feedback becomes dominant, slowing growth until the system stabilizes at the maximum sustainable level. Examples include population growth with limited resources, market adoption of new products, and epidemic spread with limited susceptible population. The output should start with exponential growth but gradually slow and level off as it approaches a carrying capacity or maximum limit."
    ),
    generateBasicBehaviorModeTest(
        "Logistic Decay Pattern",
        "logistic decay (inverse S-curve) behavior",
        "s_curve_decline",
        "Logistic decay follows an S-shaped (sigmoid) decline and is the mirror image of logistic growth. The output starts high and declines only slowly at first while it is near its initial level. The decline then accelerates, reaching its maximum rate around the midpoint between the starting value and the floor, before slowing again as balancing feedback becomes dominant near the floor, until the system stabilizes at a lower equilibrium. Because the decline is slow at both the top and the bottom and fastest in the middle, the curve has an inflection point (it is NOT exponential decay, which declines fastest at the very start). A natural structure is an outflow proportional to both the distance still remaining above the floor and the distance already fallen from the initial value (for example, rate proportional to (initial - output) * (output - floor)), which is near zero at both ends and largest in between. Examples include the decline phase of a product life cycle and the abandonment of a technology following an inverse S-curve. The output should start high and nearly flat, decline most steeply through the middle, and then level off as it approaches a minimum sustainable level or floor."
    ),
    generateBasicBehaviorModeTest(
        "Standing Oscillation Pattern",
        "sustained oscillation behavior",
        "oscillating",
        "Standing oscillations occur in systems with delays and feedback loops that create periodic behavior. The system oscillates around an equilibrium point with relatively constant amplitude. Examples include predator-prey models (Lotka-Volterra), inventory management with ordering delays, economic business cycles, and many engineering control systems. The oscillation is sustained rather than dampening out. The output should oscillate periodically with relatively constant amplitude over time."
    )
];

/**
 * Returns the methodology for this category: how its tests are built and run, what the evaluator
 * checks, and how those checks combine into a verdict. Each `criteria[].name` is the exact failure
 * `type` {@link evaluate} records when that criterion is not met. Rendered by the documentation
 * site on every test page.
 * @returns {{howItWorks: Array<string>, criteria: Array<{name: string, description: string}>, scoring: string}}
 */
export const methodology = () => ({
    howItWorks: [
        `Each test names one behavior over time — exponential growth, exponential decay, logistic (S-curve) growth, logistic decay, or sustained oscillation — and asks the engine to build a model that produces it. The prompt requires a variable named exactly "output", which is the one series the evaluation reads, and the background knowledge explains the mechanism behind the pattern (which feedback loops dominate, and what a natural structure looks like). The point is whether the engine can realize a named behavior, not whether it can guess what was meant.`,
        `Grading is behavioral rather than structural: no part of the model's shape is checked. The returned sd-json is converted to XMILE, simulated with PySD, and the resulting "output" trajectory is handed to the time-series-behavior-analysis classifier, which labels the series and reports how much probability it assigns to that shape. Any structure that genuinely produces the requested behavior is accepted.`,
        `The test passes when the classifier's label is the behavior the test asked for and its confidence in that shape is at least 0.5. The confidence floor is what keeps an ambiguous series — one that could be read as either of two patterns — from counting as a clean example of the one requested.`
    ],
    criteria: [
        { name: 'Missing model', description: 'The response carried no model, so there is nothing to simulate.' },
        { name: 'Missing output variable', description: 'No variable in the model is named "output" (matched case-insensitively, exactly). The evaluation reads only that series, so the target behavior cannot be located.' },
        { name: 'XMILE conversion error', description: 'The model could not be converted to XMILE for the simulator — usually a structural problem in the returned sd-json.' },
        { name: 'Simulation error', description: 'PySD could not load or run the model, so no behavior was produced to classify.' },
        { name: 'Invalid simulation output', description: 'The run produced no usable time series for "output".' },
        { name: 'Behavior classification error', description: 'The classifier itself failed on the series it was given.' },
        { name: 'Incorrect behavioral pattern', description: 'The simulated "output" was classified as a different behavior than the one requested. The detected label and its confidence are recorded with the failure.' },
        { name: 'Low confidence in pattern detection', description: 'The classifier did pick the requested behavior, but with confidence below 0.5 — the series is not a convincing instance of the pattern.' },
        { name: 'Unexpected evaluation error', description: 'Anything else thrown while evaluating, surfaced rather than swallowed so the test cannot pass by accident.' }
    ],
    scoring: `Five behaviors, one test each, in a single group. The checks run in order and each early one is fatal: a missing model, a missing "output", a failed conversion or a failed simulation ends the evaluation there, so a failing test normally records one failure rather than a list.`
});

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    basicBehaviorPatterns: behavioralPatterns
};
