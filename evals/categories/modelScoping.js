/**
 * This is the model scoping test
 *
 * The model scoping evaluation category tests whether a model discussion engine can set the
 * boundary of a system dynamics model correctly for the problem it is asked to address: can it
 * say which mechanisms should be *included* in the model, and which should be *excluded* from
 * it? Choosing the model boundary in light of the problem definition is one of the hardest and
 * most consequential steps in system dynamics — a good modeler pulls in the mechanisms that
 * materially drive the behavior of interest and leaves out those that, for this particular
 * problem, act on a very different time scale, are effectively constant over the relevant
 * horizon, sit below the level of aggregation, or belong to an altogether different question.
 *
 * Each test presents the engine with a modeling case: a problem statement, some background
 * knowledge, and a numbered list of candidate mechanisms. Some of those candidates genuinely
 * belong in a model built for that problem ("in-boundary"); the rest are plausible-sounding
 * distractors that a competent modeler would deliberately leave out ("out-of-boundary"). The
 * engine is asked to make a clear include-or-exclude decision for every candidate. An LLM judge
 * then reads the engine's discussion and reports, for each candidate, only what the engine
 * actually decided (include / exclude / unclear). This category's code compares those decisions
 * to the ground truth, failing the test when an in-boundary mechanism was not included, when an
 * out-of-boundary mechanism was not excluded, or when the engine failed to commit to a decision.
 *
 * @module categories/modelScoping
 */

import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import { z } from 'zod';
import { validateEvaluationResult } from '../evaluationSchema.js';

/**
 * The modeling cases used by this category. Each case fixes a specific problem definition and a
 * list of candidate mechanisms. Every mechanism carries a `shouldInclude` flag that is the
 * ground truth boundary decision for *this* problem: `true` means the mechanism materially drives
 * the behavior the problem is about and belongs inside the model boundary; `false` means it is a
 * defensible-but-wrong distractor that should be left out for this problem (wrong time scale,
 * effectively constant over the horizon, below the level of aggregation, or a different question).
 * Mechanisms are listed in a fixed, deliberately interleaved order so their position never leaks
 * the correct decision.
 */
const cases = {
    "Cooling Coffee": {
        problemStatement: "I want to understand how the temperature of a freshly poured cup of coffee falls toward room temperature over the roughly thirty minutes after it is poured.",
        backgroundKnowledge: `A hot cup of coffee sits in a room. It loses heat to the surrounding air, and the rate of heat loss is larger when the coffee is much hotter than the room and shrinks as the coffee's temperature approaches the room's. The room is large enough that its temperature does not change appreciably while the coffee cools.`,
        mechanisms: [
            { text: "Heat flowing from the coffee to the surrounding air at a rate that grows with the gap between the coffee's temperature and the room's temperature.", shouldInclude: true },
            { text: "The narrowing gap between the coffee's temperature and the room's temperature slowing the rate of cooling as the coffee approaches room temperature.", shouldInclude: true },
            { text: "The gradual loss of drinkable liquid volume to evaporation and how much coffee is left in the cup to drink after several hours.", shouldInclude: false },
            { text: "The fixed room temperature acting as the target that the coffee's temperature approaches.", shouldInclude: true },
            { text: "Seasonal changes in the building's ambient room temperature across the year.", shouldInclude: false },
            { text: "The slow chemical breakdown of aroma and flavor compounds that changes how the coffee tastes over the following hours.", shouldInclude: false }
        ]
    },
    "Retirement Savings": {
        problemStatement: "I want to project the balance of a retirement savings account over the next thirty years as it earns interest and receives steady monthly contributions.",
        backgroundKnowledge: `Each month the account holder deposits a fixed contribution, and the account earns interest on its current balance, which is added back to the balance. The account holder does not plan to withdraw any money during these thirty years, so we only need to project the balance itself.`,
        mechanisms: [
            { text: "Interest earned on the current balance being added back to the balance, so that a larger balance earns still more interest.", shouldInclude: true },
            { text: "Second-by-second fluctuations in the quoted market value of the account's holdings during a trading day.", shouldInclude: false },
            { text: "The fixed monthly contribution adding to the balance.", shouldInclude: true },
            { text: "The bank's own staffing levels and the profitability of its branches.", shouldInclude: false },
            { text: "Inflation reducing the purchasing power of the dollars held in the account.", shouldInclude: false },
            { text: "Changes over the account holder's career in which employer they work for and their job title.", shouldInclude: false }
        ]
    },
    "Population Growth": {
        problemStatement: "I want to project how the size of a single population of animals in a fenced reserve changes over the next several years, given its birth and death processes.",
        backgroundKnowledge: `The population grows through births and shrinks through deaths, and both the number of births and the number of deaths per year scale with the current size of the population. Food and space in the reserve are abundant over the horizon of interest, so crowding does not yet limit growth. The reserve is fenced, so no animals enter or leave.`,
        mechanisms: [
            { text: "Births adding to the population at a rate proportional to the current population, so a larger population produces more births.", shouldInclude: true },
            { text: "Density-dependent crowding that would cap the population as it nears the reserve's carrying capacity.", shouldInclude: false },
            { text: "Deaths removing individuals at a rate proportional to the current population.", shouldInclude: true },
            { text: "Immigration and emigration of animals across the reserve's boundary.", shouldInclude: false },
            { text: "Random day-to-day weather affecting how many individual animals happen to be counted on a given day.", shouldInclude: false },
            { text: "Genetic evolution of the species toward different traits over many generations.", shouldInclude: false }
        ]
    },
    "Flu Outbreak": {
        problemStatement: "I want to understand how the number of currently infected people rises to a peak and then falls over the course of a single four-month outbreak of a flu-like illness in one town.",
        backgroundKnowledge: `People start out susceptible. Susceptible people become infected through contact with people who are currently infected, and infected people recover after an average illness duration and are then immune. The town is fairly isolated during the outbreak.`,
        mechanisms: [
            { text: "Susceptible people becoming infected through contact with infected people, at a rate that rises with how many people are currently infected.", shouldInclude: true },
            { text: "Infected people recovering after an average duration of illness.", shouldInclude: true },
            { text: "The shrinking pool of remaining susceptible people slowing new infections as the outbreak progresses.", shouldInclude: true },
            { text: "Births and natural deaths gradually changing the town's total population.", shouldInclude: false },
            { text: "Recovered people slowly losing their immunity and becoming susceptible again.", shouldInclude: false },
            { text: "The economic cost to local businesses of workers staying home while sick.", shouldInclude: false }
        ]
    },
    "Inventory Oscillation": {
        problemStatement: "I want to understand why a distributor's inventory keeps overshooting and oscillating around its target as the distributor reorders stock to correct shortages, over the course of a year of roughly steady sales.",
        backgroundKnowledge: `The distributor ships product to customers to meet demand, which is roughly constant. It places replenishment orders to close the gap between its desired and actual inventory. Orders do not arrive immediately: there is a shipping and production delay of a few weeks between placing an order and receiving the goods, and stock is already on order in the pipeline.`,
        mechanisms: [
            { text: "Placing replenishment orders in proportion to the gap between desired and actual inventory.", shouldInclude: true },
            { text: "The delay between placing an order and receiving the goods, which lets inventory keep responding to orders placed weeks earlier.", shouldInclude: true },
            { text: "Neglecting the stock already on order in the pipeline when deciding how much more to order.", shouldInclude: true },
            { text: "The detailed mechanics of how forklifts and workers physically move pallets within the warehouse.", shouldInclude: false },
            { text: "Shipments to customers drawing inventory down to meet demand.", shouldInclude: true },
            { text: "Long-run growth of the overall market and customer base over the coming decade.", shouldInclude: false },
            { text: "The distributor's choice of advertising and branding strategy.", shouldInclude: false }
        ]
    },
    "Thermostat Heating": {
        problemStatement: "I want to understand how the air temperature in a room approaches and settles at the thermostat's set point after the heater is switched on, over a few hours.",
        backgroundKnowledge: `A heater adds warmth to the room's air. A thermostat compares the room temperature to a set point and turns the heater's output up when the room is below the set point and down as it approaches. The room also loses heat to the colder outdoors at a rate that grows with the indoor-outdoor temperature difference.`,
        mechanisms: [
            { text: "The heater adding heat to the room's air.", shouldInclude: true },
            { text: "The thermostat adjusting the heater's output based on the gap between the room temperature and the set point.", shouldInclude: true },
            { text: "Heat leaking from the warm room to the colder outdoors, faster when the indoor-outdoor gap is larger.", shouldInclude: true },
            { text: "Slow seasonal drift in the average outdoor climate across the year.", shouldInclude: false },
            { text: "The gradual degradation of the heater's efficiency as its components age over many years.", shouldInclude: false },
            { text: "The molecule-by-molecule turbulent motion of individual air currents within the room.", shouldInclude: false }
        ]
    },
    "Fishery Boom and Bust": {
        problemStatement: "I want to understand how a commercial fish stock and the fishing fleet that harvests it can boom and then collapse over several decades of fishing.",
        backgroundKnowledge: `The fish stock regenerates through net births, growing fastest at intermediate stock levels and leveling off near the habitat's carrying capacity. Ships harvest fish at a rate that rises with both the number of ships and the density of fish. Profit from harvesting, net of operating costs, drives investment in new ships, but new ships arrive only after a construction and financing delay; when profit turns negative, ships leave the fishery.`,
        mechanisms: [
            { text: "Regeneration of the fish stock through net births, saturating as the stock nears its carrying capacity.", shouldInclude: true },
            { text: "Harvesting that increases with both the number of ships and the density of fish.", shouldInclude: true },
            { text: "Profit-driven investment in new ships, delayed by construction and financing, which lets the fleet overshoot the sustainable level.", shouldInclude: true },
            { text: "Day-to-day storms that keep boats in port on rough-weather days.", shouldInclude: false },
            { text: "Falling fish density lowering the catch per ship and therefore profit, which eventually shrinks the fleet.", shouldInclude: true },
            { text: "Evolutionary change in the fish species toward smaller body size under sustained fishing pressure.", shouldInclude: false },
            { text: "The retail price and grocery-store margins that consumers pay for fish.", shouldInclude: false }
        ]
    },
    "Software Project Rework": {
        problemStatement: "I want to understand why a fixed-scope software project runs late once undiscovered rework and schedule pressure are taken into account, over the roughly twelve-month life of the project.",
        backgroundKnowledge: `The team completes tasks from a backlog. Some completed work contains defects and becomes undiscovered rework rather than being truly done; this rework is found only after a discovery delay and then flows back into the backlog. As the deadline nears with work remaining, schedule pressure rises, which pushes the team to work faster but also raises the fraction of work done incorrectly. Sustained overtime also erodes productivity.`,
        mechanisms: [
            { text: "Completed work that contains defects becoming undiscovered rework, being found only after a discovery delay, and flowing back into the backlog to be redone.", shouldInclude: true },
            { text: "Schedule pressure rising as the deadline nears with work remaining, pushing up the work rate.", shouldInclude: true },
            { text: "Higher schedule pressure raising the fraction of work done incorrectly, which generates still more undiscovered rework.", shouldInclude: true },
            { text: "The multi-year career progression and promotions of the individual developers on the team.", shouldInclude: false },
            { text: "Sustained overtime eroding developer productivity through fatigue.", shouldInclude: true },
            { text: "Quarter-to-quarter movements in the company's stock price.", shouldInclude: false },
            { text: "The specific programming-language syntax and coding-style choices the team makes.", shouldInclude: false }
        ]
    },
    "App Growth and Capacity": {
        problemStatement: "I want to understand why a fast-growing subscription app's user growth can stall or oscillate as its ability to onboard and support new users struggles to keep up with demand, over its first few years.",
        backgroundKnowledge: `Existing users refer new users through word of mouth, so growth feeds on itself. The company invests revenue in support and onboarding capacity to serve users well, but new capacity comes online only after a hiring and training delay. When capacity lags demand, service quality falls, which increases user churn and reduces the rate at which new users are won.`,
        mechanisms: [
            { text: "Existing users referring new users through word of mouth, so that more users generate still more new users.", shouldInclude: true },
            { text: "Revenue funding investment in support and onboarding capacity that comes online only after a hiring and training delay.", shouldInclude: true },
            { text: "Capacity lagging demand degrading service quality, which raises churn and slows new-user acquisition.", shouldInclude: true },
            { text: "Micro-optimizations to the app's user-interface pixel layout and the exact colors of its buttons.", shouldInclude: false },
            { text: "Existing users leaving the service, reducing the installed user base.", shouldInclude: true },
            { text: "Macroeconomic interest-rate cycles playing out over the coming decades.", shouldInclude: false },
            { text: "The founders' personal equity ownership percentages and the company's cap-table structure.", shouldInclude: false }
        ]
    }
};

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The model scoping test evaluates whether a model discussion engine can set the boundary of a system dynamics model correctly for the problem at hand — deciding which mechanisms should be included in the model and which should be excluded from it. For each modeling case the engine is given a problem definition and a mix of in-boundary and out-of-boundary candidate mechanisms, and must make a clear include-or-exclude decision for each; the test passes only if every in-boundary mechanism is included and every out-of-boundary mechanism is excluded.`;
};

/**
 * Renders the candidate mechanisms as a numbered list for the engine's prompt, exposing only the
 * mechanism text (never the ground truth `shouldInclude` decision).
 * @param {Array<{text: string, shouldInclude: boolean}>} mechanisms The candidate mechanisms
 * @returns {string} A newline-separated numbered list of mechanism texts
 */
const numberedMechanisms = function(mechanisms) {
    return mechanisms.map((m, i) => `${i + 1}. ${m.text}`).join('\n');
};

/**
 * Generates a model scoping test for a given modeling case.
 * @param {string} name The name of the case (also used as the test/case key)
 * @returns {Object} Test case with prompt, parameters, and expectations
 */
const generateTest = function(name) {
    const c = cases[name];
    return {
        name: `${name} model scoping`,
        prompt: `Given the problem statement and background knowledge I have provided, help me set the boundary of a system dynamics model built to address this specific problem. Below is a numbered list of candidate mechanisms. For each one, make a clear decision: should it be INCLUDED in the model (because it materially drives the behavior this problem is about) or EXCLUDED from it (because, for this particular problem, it lies outside an appropriate boundary — for example it acts on a very different time scale, is effectively constant over the relevant horizon, sits below the level of aggregation, or belongs to a different question)? State an explicit include-or-exclude decision for every numbered mechanism and briefly justify each one.

Candidate mechanisms:
${numberedMechanisms(c.mechanisms)}`,
        currentModel: null, // No model is provided as input; this is a scoping discussion.
        additionalParameters: {
            problemStatement: c.problemStatement,
            backgroundKnowledge: c.backgroundKnowledge
        },
        expectations: {
            systemName: name,
            problemStatement: c.problemStatement,
            mechanisms: c.mechanisms
        }
    };
};

/**
 * The structured-output schema the judge must return: for each candidate mechanism, only the
 * decision the engine's discussion actually reached. The judge reports what the engine said; it
 * does not decide for itself whether a mechanism belongs (that comparison happens against the
 * ground truth in code).
 */
const scopingDecisionSchema = z.object({
    decisions: z.array(z.object({
        mechanismNumber: z.number().int().positive().describe('The number of the candidate mechanism (1-indexed) this decision refers to'),
        decision: z.enum(['include', 'exclude', 'unclear']).describe("The decision the response reached for this mechanism: 'include', 'exclude', or 'unclear' if the response did not clearly commit either way"),
        evidence: z.string().describe('A brief quote or paraphrase of the part of the response that supports this reading')
    })).describe('One decision for every candidate mechanism that was provided, in the same numbering')
});

/**
 * Builds the message list for the LLM judge. The judge is deliberately NOT told the ground truth
 * boundary decisions; its only job is to extract, for each numbered mechanism, the decision the
 * engine's discussion arrived at. This keeps the judge from substituting its own opinion for what
 * the engine actually said.
 * @param {string} generatedText The engine's discussion text
 * @param {Object} expectations The test expectations (problem context and candidate mechanisms)
 * @returns {Array<Object>} The messages to send to the judge LLM
 */
const buildJudgeMessages = function(generatedText, expectations) {
    const mechanisms = expectations.mechanisms || [];
    return [
        {
            role: 'system',
            content: `You are a System Dynamics expert. You will be given a modeling problem, a numbered list of candidate mechanisms, and a response that was asked to decide, for each mechanism, whether it should be INCLUDED in or EXCLUDED from a system dynamics model built for that problem.

Your ONLY job is to read the response and report, for each numbered mechanism, the decision the response reached:
- "include" if the response clearly concludes the mechanism should be in the model,
- "exclude" if the response clearly concludes the mechanism should be left out of the model,
- "unclear" if the response does not clearly commit to either, does not mention the mechanism, or is self-contradictory about it.

Do NOT apply your own judgment about whether a mechanism truly belongs in the model. Report only what the response itself decided. Return exactly one decision for every numbered mechanism.`
        },
        {
            role: 'user',
            content: `The modeling problem is:
"""
${expectations.problemStatement || expectations.systemName}
"""

The candidate mechanisms, numbered, were:
${numberedMechanisms(mechanisms)}

Here is the response to analyze:
"""
${generatedText}
"""

For each numbered candidate mechanism, report the include/exclude/unclear decision the response reached.`
        }
    ];
};

/**
 * This method inspects the engine's scoping discussion and returns a list of failure objects for
 * every mechanism whose boundary decision does not match the ground truth: an in-boundary
 * mechanism that was not included, or an out-of-boundary mechanism that was not excluded. A
 * mechanism the engine did not clearly decide on ("unclear") counts as a failure either way,
 * because the whole point of the test is whether the engine can *say* what belongs and what does
 * not. All mechanisms are judged in a single structured-output LLM pass.
 * @param {Object} generatedResponse The response from the engine containing the scoping discussion
 * @param {Object} expectations The expectations describing the modeling case and its ground truth
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const mechanisms = expectations.mechanisms || [];

    // Extract the engine's discussion text, matching the convention used by the other discussion
    // categories (feedbackExplanation, modelBuildingSteps).
    const generatedText = generatedResponse?.output?.textContent || '';

    if (!generatedText.trim()) {
        failures.push({
            type: 'No response produced',
            details: `The engine did not return any discussion text to assess for model scoping.${generatedResponse?.err ? ` Engine error: ${generatedResponse.err}` : ''}`
        });
        return validateEvaluationResult(failures);
    }

    // Create LLMWrapper instance configured for evaluation purposes.
    const llm = new LLMWrapper({
        underlyingModel: LLMWrapper.EVAL_MODEL
    });
    const { underlyingModel, temperature } = llm.getLLMParameters(0);

    let decisionsByNumber;
    try {
        const messages = buildJudgeMessages(generatedText, expectations);
        const response = await llm.createChatCompletion(
            messages,
            underlyingModel,
            scopingDecisionSchema,
            temperature
        );

        const parsed = JSON.parse(response.content);
        const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
        decisionsByNumber = new Map(decisions.map((d) => [d.mechanismNumber, d]));
    } catch (error) {
        failures.push({
            type: 'Evaluation error',
            details: `Error judging model scoping decisions: ${error.message}`
        });
        return validateEvaluationResult(failures);
    }

    // Compare each engine decision against the ground truth boundary decision for its mechanism.
    mechanisms.forEach((mechanism, i) => {
        const mechanismNumber = i + 1;
        const judged = decisionsByNumber.get(mechanismNumber);
        const decision = judged ? judged.decision : 'unclear';

        if (mechanism.shouldInclude) {
            if (decision !== 'include') {
                failures.push({
                    type: 'In-boundary mechanism not included',
                    details: `Mechanism ${mechanismNumber} materially drives the behavior this problem is about and should be INCLUDED, but the engine ${decision === 'exclude' ? 'excluded it' : 'did not clearly decide to include it'}. Mechanism: "${mechanism.text}"`
                });
            }
        } else {
            if (decision !== 'exclude') {
                failures.push({
                    type: 'Out-of-boundary mechanism not excluded',
                    details: `Mechanism ${mechanismNumber} lies outside an appropriate boundary for this problem and should be EXCLUDED, but the engine ${decision === 'include' ? 'included it' : 'did not clearly decide to exclude it'}. Mechanism: "${mechanism.text}"`
                });
            }
        }
    });

    return validateEvaluationResult(failures);
};

/**
 * The groups of tests to be evaluated as a part of this category. Difficulty rises from small,
 * few-mechanism systems (simple) to systems with delays, feedback, and more tempting distractors
 * (complex).
 */
export const groups = {
    "simpleModelScoping": [
        generateTest("Cooling Coffee"),
        generateTest("Retirement Savings"),
        generateTest("Population Growth")
    ],
    "mediumModelScoping": [
        generateTest("Flu Outbreak"),
        generateTest("Inventory Oscillation"),
        generateTest("Thermostat Heating")
    ],
    "complexModelScoping": [
        generateTest("Fishery Boom and Bust"),
        generateTest("Software Project Rework"),
        generateTest("App Growth and Capacity")
    ]
};
