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
import { validateEvaluationResult } from '../evaluationSchema.js';

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

const marketGrowthModel = JSON.parse(
    readFileSync(join(__dirname, 'feedbackExplanationData', 'marketGrowth.json'), 'utf-8')
);

const maibabModel = JSON.parse(
    readFileSync(join(__dirname, 'feedbackExplanationData', 'maibab.json'), 'utf-8')
);

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The feedback explanation test evaluates whether engines can accurately explain the origins of a model's behavior from its feedback-loop dominance analysis. It does so by using an LLM to check for the presence of known facts in the text returned by an engine.`;
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
        prompt: "Please explain the behavior of this model over time based on the feedback loop dominance analysis provided.",
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

    // Create LLMWrapper instance configured for evaluation purposes
    const llm = new LLMWrapper({
        underlyingModel: LLMWrapper.EVAL_MODEL
    });

    // Iterate through each expected fact
    for (const expectedFact of expectedFacts) {
        try {
            const messages = [
                {
                    role: 'system',
                    content: 'Your job is to determine if a given statement is true based only on the information provided. You will be given some text, and then asked to verify if a specific statement is supported by that text. Answer only "true" if the statement is clearly supported by the text, or "false" if it is not supported or contradicted by the text.'
                },
                {
                    role: 'user',
                    content: `Here is the text to analyze:\n\n${generatedResponse.output?.textContent || JSON.stringify(generatedResponse)}`
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

    return validateEvaluationResult(failures);
};


/**
 * Returns the methodology for this category: how its tests are built and run, what the evaluator
 * checks, and how those checks combine into a verdict. Each `criteria[].name` is the exact failure
 * `type` {@link evaluate} records when that criterion is not met. Rendered by the documentation
 * site on every test page.
 * @returns {{howItWorks: Array<string>, criteria: Array<{name: string, description: string}>, scoring: string}}
 */
export const methodology = () => ({
    howItWorks: [
        `Each test hands the engine a complete, classic model — an arms race, Bass diffusion, an inventory–workforce system, predator–prey, Forrester's market growth model, or the Mai-Bab predator–prey-and-food model — together with that model's precomputed feedback-loop dominance analysis, and asks it to explain the model's behavior over time from that analysis. Supplying the dominance analysis is what makes the task an explanation task: the engine is not asked to derive which loops dominate when, it is asked to say what that means.`,
        `A test's expectations are a list of facts an expert explanation of that model would carry: which loop drives which phase of the behavior, which loop takes over and when, what the resulting shape is. Each fact states exactly one checkable claim. Conjunctions are deliberately split, because the judge answers true or false about a whole statement — an explanation that covered two of three conjoined claims would otherwise score zero for all three — and the dominance facts name the periods rather than enumerating exact year ranges, since identifying a period's dominant loop is the understanding being measured, not reproducing dates verbatim.`,
        `Grading runs one judge call per fact. The engine's text and a single statement go to a fixed judge model (the configured eval model, independent of the engine under test), which is asked whether the statement is clearly supported by that text and nothing else; anything unsupported or contradicted is false. Facts are therefore scored independently of each other and of the order in which the explanation happens to raise them.`
    ],
    criteria: [
        { name: 'Missing expected fact', description: 'A fact an expert explanation would carry was not clearly supported by the engine’s text. Recorded once per fact, quoting the fact that was missing.' },
        { name: 'Evaluation error', description: 'A judge call failed for some fact. Recorded as a failure rather than passed silently, so a broken judge never reads as a good answer.' }
    ],
    scoring: `Every fact must be present: one missing fact fails the test. There is no credit for partial coverage and no penalty for saying more than the facts require — an explanation may add correct material freely, as long as everything expected is in there.`
});

/**
 * The groups of tests to be evaluated as a part of this category
 *
 * Each expected fact states ONE checkable claim. The judge is asked whether a statement is
 * clearly supported and answers true or false for the whole statement, so a fact that
 * conjoins several claims fails entirely when the explanation covers all but one of them —
 * an engine that named sales effectiveness seven times and capacity expansion eight still
 * scored zero on the fact asking for those and revenue expansion together. Splitting the
 * conjunctions is what makes the answer "which of these did it explain", which is the thing
 * this category exists to measure.
 *
 * For the same reason the dominance facts name the periods rather than enumerating their
 * exact year ranges: an explanation that identifies U1 as the brief transition-phase loop
 * has understood the dominance analysis, whether or not it reproduces four date ranges from
 * the supplied data verbatim.
 */
export const groups = {
    "simpleFeedbackExplanation": [
        generateTest(
            "Arms race dynamics explanation",
            armsRaceModel,
            [
                "There are three feedback loops in this model.",
                "Two of the three feedback loops are balancing (negative).",
                "One of the three feedback loops is reinforcing (positive).",
                "Before time 7.625 the system's behavior is dominated by balancing (negative) feedback loops.",
                "After time 7.625, the system's behavior is dominated by the reinforcing (positive) feedback loop.",
            ]
        ),
        generateTest(
            "Bass diffusion dynamics explanation",
            bassDiffusionModel,
            [
                "There are two feedback loops in this model.",
                "One of the two feedback loops is balancing (negative).",
                "One of the two feedback loops is reinforcing (positive).",
                "Before time 9.625 the system's behavior is dominated by the reinforcing (positive) feedback loop.",
                "After time 9.625, the system's behavior is dominated by the balancing (negative) feedback loop.",
            ]
        ),
        generateTest(
            "Inventory workforce dynamics explanation",
            inventoryWorforceModel,
            [
                "There are three feedback loops in this model, and all three are balancing.",
                "One of the balancing feedback loops involves both inventory and workforce.",
                "One of the balancing feedback loops involves workforce only.",
                "The balancing feedback process involving both inventory and workforce is primarily responsible for the oscillation in behavior",
                "The balancing feedback process involving just workforce represents the worker adjustment process.",
                "The balancing feedback process involving just workforce is also involved with the oscillation in behavior.",
            ]
        ),
        generateTest(
            "Predator prey dynamics explanation",
            predatorPreyModel,
            [
                "The model produces oscillations",
                "The growth part of the oscillations are driven by reinforcing loops involving hare births and lynx births",
                "The decline part of the oscillations are driven by balancing feedback loops relating to deaths, especially the predation/starvation process"
            ]
        )
    ],
    "mediumFeedbackExplanation": [
        generateTest(
            "Market growth dynamics explanation",
            marketGrowthModel,
            [
                "The model produces oscillations",
                "Sales effectiveness is one of the keys to growing the business.",
                "Revenue expansion is one of the keys to growing the business.",
                "Capacity expansion is one of the keys to growing the business.",
                "Reinforcing feedback loops involving the sales force and revenue drive growth",
                "Growth is constrained by capacity and by delivery delays.",
                "Balancing feedback loops involving delivery delays are in part responsible for the observed oscillations.",
                "In the long run the business saturates rather than growing without limit.",
                "The saturation is caused by balancing feedback loops that stabilize growth in sales and in sales effectiveness."
            ]
        ),
        generateTest(
            "Maibab predator prey and food dynamics explanation",
            maibabModel,
            [
                "System behavior is governed by predator\u2013prey feedback.",
                "The oscillations are driven mainly by the reinforcing loop R1 and the balancing loops B1 and B2, which together create classic predator\u2013prey cycles.",
                "Growth and collapse phases alternate across the timeline.",
                "Periods dominated by R1 trigger rapid deer population growth, which are then followed by crashes or stabilization when B1 and B2 take over.",
                "U1 dominates only briefly, during the transitions between phases, marking rapid predator adjustments that reset the system before it returns to balancing control.",
                "After 1972, balancing loops dominate continuously.",
                "From 1980 to 2300, B1 and B2 maintain control."
            ]
        )
    ]
};
