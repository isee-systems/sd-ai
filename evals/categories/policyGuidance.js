/**
 * This is the policy guidance test
 *
 * The policy guidance evaluation category tests whether a model discussion engine can act as a
 * good tutor to a novice modeler: given a *complete* example model that currently behaves in an
 * undesirable way, can the engine generate the questions and discussion that bring the novice to
 * a greater understanding of the policies that could steer the system toward desirable behavior?
 *
 * This directly targets the ability to teach leverage: it is not enough to name a fix, the
 * engine must help the learner see *why* a policy works by connecting it to the model's feedback
 * structure, and it must engage the learner with guiding questions rather than simply lecturing.
 *
 * Unlike the model-building categories, every test here feeds the engine a full, pre-built
 * example model as input (the classic textbook models reused from the feedback explanation data:
 * an arms race, Bass diffusion, an inventory–workforce system, and Forrester's market growth
 * model). Each model exhibits a well-known problem behavior (escalation, a slow adoption takeoff,
 * oscillation, or growth that stalls), and each has a well-established policy story about the
 * leverage points that would produce more desirable behavior.
 *
 * For each test the engine is asked, in the voice of a novice, to discuss what policies could
 * move the system toward a stated desirable behavior and to teach through guiding questions. A
 * single structured-output LLM judge then assesses, in one pass, (1) whether the discussion
 * conveys each of the key policy insights experts consider essential for that model, and (2)
 * whether the discussion actually generates guiding questions that engage the novice. A test
 * fails if any key policy insight is missing or if the engine does not pose guiding questions.
 *
 * @module categories/policyGuidance
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import { z } from 'zod';
import { validateEvaluationResult } from '../evaluationSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Loads one of the shared full example models used by the feedback explanation category,
 * returning both the model structure and its precomputed feedback-loop dominance analysis.
 * The feedback analysis is passed to the engine as `feedbackContent` so that single-pass
 * discussion engines (which do not run the model themselves) have the loop-dominance
 * information a policy discussion fundamentally depends on — matching the convention the
 * feedbackExplanation category uses with these same files.
 * @param {string} fileName The file name within feedbackExplanationData (e.g. 'armsRace.json')
 * @returns {{ model: Object, feedback: Object }} The full SD-JSON model and its feedback analysis
 */
const loadExample = function(fileName) {
    const data = JSON.parse(readFileSync(join(__dirname, 'feedbackExplanationData', fileName), 'utf-8'));
    return { model: data.model, feedback: data.feedback };
};

/**
 * The policy guidance cases. Each pairs one full example model with the problem a novice brings
 * to it: the system's current (undesirable) behavior, the desirable behavior they want to reach,
 * and the key policy insights a good tutoring discussion must surface. The key policies are the
 * well-established leverage points for these canonical models, phrased conceptually so the judge
 * checks whether the idea is present in the discussion rather than matching exact variable names.
 */
const cases = {
    "Arms Race": {
        ...loadExample('armsRace.json'),
        problemStatement: "I'm new to system dynamics and I've been handed this arms race model. I want to understand what policies could keep the two arsenals from spiraling ever upward.",
        currentBehavior: "each side keeps building more weapons in response to the other, so both arsenals escalate without bound",
        desirableBehavior: "the two arsenals stabilizing — and ideally coming down — instead of spiraling upward in an ever-escalating buildup",
        keyPolicies: [
            "The escalation is produced by a reinforcing feedback loop in which each side sizes its arsenal to exceed the other's, so the leverage lies in how each side reacts to the other's weapons, not in its own weapons directly.",
            "Reducing the desired safety margin — the excess each side wants to hold over the other — lowers the level the arsenals settle at and can convert escalation into de-escalation.",
            "Slowing or dampening each side's reaction (responding less aggressively, over a longer time, to the other's buildup) weakens the reinforcing loop and calms the race.",
            "Because the loop is mutual, unilateral restraint by one side is undercut by the other's response, so a durable policy requires coordinated, reciprocal reductions rather than one side acting alone."
        ]
    },
    "Bass Diffusion": {
        ...loadExample('bassDiffusion.json'),
        problemStatement: "I'm new to system dynamics and I have this product-adoption model. I want to understand what policies could get the product to catch on faster.",
        currentBehavior: "adoption starts slowly, then accelerates through word of mouth, and finally levels off as the pool of potential adopters is used up",
        desirableBehavior: "adoption taking off sooner and reaching the market faster — an earlier, quicker S-curve",
        keyPolicies: [
            "Adoption is driven by a reinforcing word-of-mouth loop in which more adopters create more contacts that convert potential adopters, so the leverage is in the strength of that loop — raising the contact rate or the adoption fraction (for example through referral incentives or making the product more shareable) speeds the takeoff.",
            "Because word-of-mouth adoption is proportional to the number of existing adopters, the takeoff depends on an initial base of adopters; a policy that seeds early adopters (such as advertising or free trials, which this word-of-mouth-only model does not yet represent) jump-starts the reinforcing loop and pulls the S-curve earlier.",
            "Adoption is ultimately bounded by the balancing depletion of potential adopters and the fixed market size, so these policies change when adoption happens rather than the final ceiling; increasing the total number of adopters requires expanding the market size or pool of potential adopters."
        ]
    },
    "Inventory Workforce": {
        ...loadExample('inventoryWorkforce.json'),
        problemStatement: "I'm new to system dynamics and I've been given this inventory-and-workforce model. I want to understand what policies would keep inventory and staffing steady instead of swinging up and down.",
        currentBehavior: "inventory and the workforce overshoot and oscillate around their desired levels rather than settling smoothly",
        desirableBehavior: "inventory and the workforce adjusting smoothly to demand and settling at their targets, instead of oscillating",
        keyPolicies: [
            "The oscillation is caused by delays (the time to hire or fire and the time to adjust demand expectations) combined with aggressive gap-closing, so the leverage is in the adjustment times and how hard the system corrects — not in demand, which is exogenous.",
            "Correcting the workforce and inventory more gradually rather than trying to close the entire gap at once reduces overshoot, though correcting too slowly leaves large persistent gaps — a tradeoff the modeler must tune.",
            "Accounting for adjustments already in the pipeline — workers already being hired and production already underway — prevents over-hiring and over-producing and the overshoot that follows.",
            "Reducing the delay in perceiving and adjusting to demand (faster, steadier demand forecasting) lets the system track demand with less overshoot."
        ]
    },
    "Market Growth": {
        ...loadExample('marketGrowth.json'),
        problemStatement: "I'm new to system dynamics and I have this market growth model for a company. I want to understand what policies would let the business keep growing instead of stalling out.",
        currentBehavior: "the business grows for a while but then stalls or oscillates because it fails to keep capacity up with demand",
        desirableBehavior: "sustained, stable growth of the business instead of growth that stalls or oscillates",
        keyPolicies: [
            "Growth is powered by a reinforcing loop — revenue funds the sales force, which wins orders, which generates more revenue — and sustaining growth means keeping this engine running.",
            "Growth is choked by a balancing loop: as orders outrun capacity, the backlog and delivery delay rise, which lowers sales effectiveness and orders; the highest-leverage fix is to expand capacity ahead of demand — shortening the capacity acquisition delay and basing capacity on anticipated rather than current orders — so delivery delay stays low.",
            "The company's own goal for acceptable delivery delay is both a leverage point and a trap: tolerating long delivery delays suppresses capacity investment and quietly stalls growth (an eroding-goals dynamic), so holding a tight delivery-delay goal drives timely capacity expansion.",
            "Delays in perceiving the delivery delay, by both the company and the market, make the balancing loop act late and contribute to overshoot and oscillation, so faster and clearer perception of service quality helps stabilize growth.",
            "Investment must be balanced between the sales force and production capacity — pouring money into selling without matching capacity worsens the delivery delay and backfires on growth."
        ]
    }
};

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The policy guidance test evaluates whether a model discussion engine can bring a novice modeler to a greater understanding of the policies that lead to desirable behavior. Given a complete example model that currently behaves undesirably, the engine must discuss which policies would steer the system toward a desirable behavior and why, and must teach through guiding questions. An LLM judge checks, in a single pass, that the discussion conveys each key policy insight for the model and that it generates guiding questions for the learner.`;
};

/**
 * Renders the key policy insights as a numbered list for the judge prompt.
 * @param {Array<string>} keyPolicies The expected policy insights
 * @returns {string} A newline-separated numbered list
 */
const numberedPolicies = function(keyPolicies) {
    return keyPolicies.map((p, i) => `${i + 1}. ${p}`).join('\n');
};

/**
 * Generates a policy guidance test for a given case. The full example model is provided as the
 * engine's `currentModel` input so the discussion is grounded in real model structure.
 * @param {string} name The name of the case (also used as the test/case key)
 * @returns {Object} Test case with prompt, model, parameters, and expectations
 */
const generateTest = function(name) {
    const c = cases[name];
    return {
        name: `${name} policy guidance`,
        prompt: `I'm new to system dynamics, and I've loaded a complete model into our session. As it stands, ${c.currentBehavior}. What I actually want is ${c.desirableBehavior}. As a novice, help me understand what policies — changes to the model's structure or parameters — could move the system toward that desirable behavior, and why they would work in terms of the model's feedback structure. Please teach me through discussion, and ask me guiding questions that help me reason about the leverage points myself rather than just handing me a list of answers.`,
        currentModel: c.model,
        additionalParameters: {
            problemStatement: c.problemStatement,
            backgroundKnowledge: `Right now, ${c.currentBehavior}. The desirable behavior I am aiming for is ${c.desirableBehavior}.`,
            // Provide the precomputed feedback-loop dominance analysis so the engine can ground
            // its policy discussion in the model's feedback structure. Without this, single-pass
            // engines correctly refuse to answer a dynamics question and ask for loop information.
            feedbackContent: c.feedback
        },
        expectations: {
            systemName: name,
            problemStatement: c.problemStatement,
            desirableBehavior: c.desirableBehavior,
            keyPolicies: c.keyPolicies
        }
    };
};

/**
 * The structured-output schema the judge must return: one coverage verdict per key policy
 * insight, plus a single verdict on whether the discussion generates guiding questions for the
 * novice.
 */
const policyGuidanceSchema = z.object({
    policyInsights: z.array(z.object({
        insightNumber: z.number().int().positive().describe('The number of the key policy insight (1-indexed) this verdict refers to'),
        covered: z.boolean().describe('True if the discussion conveys this policy insight to the learner, false otherwise'),
        explanation: z.string().describe('A brief explanation of the assessment')
    })).describe('One verdict for every key policy insight provided, in the same numbering'),
    generatesGuidingQuestions: z.object({
        present: z.boolean().describe('True if the discussion actually poses genuine guiding questions that invite the novice to reason about the system or its policies, false if it only lectures or asks no substantive questions'),
        explanation: z.string().describe('A brief explanation, citing an example question if present')
    }).describe('Whether the discussion generates guiding questions for the novice')
});

/**
 * Builds the message list for the single-pass judge. The judge is given the modeling context,
 * the desirable behavior, the numbered key policy insights, and the engine's discussion, and is
 * asked to report which insights the discussion conveys and whether it poses guiding questions.
 * @param {string} generatedText The engine's discussion text
 * @param {Object} expectations The test expectations (context and ground-truth insights)
 * @returns {Array<Object>} The messages to send to the judge LLM
 */
const buildJudgeMessages = function(generatedText, expectations) {
    const keyPolicies = expectations.keyPolicies || [];
    return [
        {
            role: 'system',
            content: `You are a System Dynamics expert evaluating how well a tutoring discussion helps a novice modeler understand the policies that would move a system toward desirable behavior. You will be given the modeling context, the desirable behavior the novice wants, a numbered list of key policy insights that a good discussion should convey, and the discussion that was generated.

Assess two things:
1. Policy insight coverage — for each numbered key policy insight, decide whether the discussion conveys that idea to the learner. The discussion need not use the same wording or variable names; it is enough that the concept is clearly communicated. Mark covered=true only when the idea is genuinely present, not merely hinted at.
2. Guiding questions — decide whether the discussion actually generates guiding questions that invite the novice to reason about the system or its policies (Socratic teaching). Genuine guiding questions probe the learner's understanding or prompt them to think about leverage points; generic pleasantries such as "Any other questions?" do not count.

Return one coverage verdict for every numbered key policy insight, plus the single guiding-questions verdict.`
        },
        {
            role: 'user',
            content: `Modeling context — the novice is working with the following problem:
"""
${expectations.problemStatement || expectations.systemName}
"""

The desirable behavior they want to reach is: ${expectations.desirableBehavior}

Here are the key policy insights a good discussion should convey:
${numberedPolicies(keyPolicies)}

Here is the discussion that was generated:
"""
${generatedText}
"""

For each numbered key policy insight, determine whether the discussion conveys it, and determine whether the discussion generates guiding questions for the novice.`
        }
    ];
};

/**
 * This method inspects the engine's tutoring discussion and returns a list of failure objects for
 * each key policy insight the discussion fails to convey, plus a failure if the discussion does
 * not generate guiding questions for the novice. Everything is judged in a single structured-
 * output LLM pass.
 * @param {Object} generatedResponse The response from the engine containing the discussion
 * @param {Object} expectations The expectations describing the case and its ground-truth insights
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const keyPolicies = expectations.keyPolicies || [];

    // Extract the engine's discussion text, matching the convention used by the other discussion
    // categories (feedbackExplanation, modelBuildingSteps).
    const generatedText = generatedResponse?.output?.textContent || '';

    if (!generatedText.trim()) {
        failures.push({
            type: 'No response produced',
            details: `The engine did not return any discussion text to assess for policy guidance.${generatedResponse?.err ? ` Engine error: ${generatedResponse.err}` : ''}`
        });
        return validateEvaluationResult(failures);
    }

    // Create LLMWrapper instance configured for evaluation purposes.
    const llm = new LLMWrapper({
        underlyingModel: LLMWrapper.EVAL_MODEL
    });
    const { underlyingModel, temperature } = llm.getLLMParameters(0);

    let parsed;
    try {
        const messages = buildJudgeMessages(generatedText, expectations);
        const response = await llm.createChatCompletion(
            messages,
            underlyingModel,
            policyGuidanceSchema,
            temperature
        );
        parsed = JSON.parse(response.content);
    } catch (error) {
        failures.push({
            type: 'Evaluation error',
            details: `Error judging policy guidance: ${error.message}`
        });
        return validateEvaluationResult(failures);
    }

    // 1) Policy insight coverage: every key policy insight must be conveyed to the learner.
    const insights = Array.isArray(parsed?.policyInsights) ? parsed.policyInsights : [];
    const verdictByNumber = new Map(insights.map((v) => [v.insightNumber, v]));

    keyPolicies.forEach((policy, i) => {
        const insightNumber = i + 1;
        const verdict = verdictByNumber.get(insightNumber);
        if (!verdict || verdict.covered !== true) {
            failures.push({
                type: 'Missing key policy insight',
                details: `The discussion did not bring the novice to understand policy insight ${insightNumber}: "${policy}"${verdict?.explanation ? ` Judge note: ${verdict.explanation}` : ''}`
            });
        }
    });

    // 2) Guiding questions: the discussion must generate genuine questions that engage the novice.
    if (parsed?.generatesGuidingQuestions?.present !== true) {
        failures.push({
            type: 'No guiding questions for the novice',
            details: `The discussion did not generate genuine guiding questions to help the novice reason about the leverage points.${parsed?.generatesGuidingQuestions?.explanation ? ` Judge note: ${parsed.generatesGuidingQuestions.explanation}` : ''}`
        });
    }

    return validateEvaluationResult(failures);
};

/**
 * The groups of tests to be evaluated as a part of this category. Difficulty rises with the size
 * and feedback complexity of the example model the engine must reason about.
 */
export const groups = {
    "simplePolicyGuidance": [
        generateTest("Arms Race"),
        generateTest("Bass Diffusion")
    ],
    "mediumPolicyGuidance": [
        generateTest("Inventory Workforce")
    ],
    "complexPolicyGuidance": [
        generateTest("Market Growth")
    ]
};
