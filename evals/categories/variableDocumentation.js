/**
 * This is the variable documentation test
 *
 * The variable documentation evaluation category tests whether engines produce complete,
 * high-quality documentation for every variable in the models they build. Where the
 * feedback explanation test checks the text of a discussion engine for known facts, this
 * test inspects the structure of a generated model. It measures two things:
 *
 *   1. Coverage — every variable in the returned model must carry a non-empty
 *      `documentation` string (see the SD-JSON `variables[].documentation` field in the
 *      top-level project README).
 *   2. Quality — in a single structured-output pass, an LLM judge verifies that each
 *      variable's documentation is accurate, specific, and genuinely descriptive of that
 *      variable's role within the system, rather than a vacuous restatement of the
 *      variable's name. The judge returns a `success`/`failureReason` verdict per variable.
 *
 * @module categories/variableDocumentation
 */

import { z } from 'zod';
import { LLMWrapper } from '../../utilities/LLMWrapper.js';
import { validateEvaluationResult } from '../evaluationSchema.js';

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The variable documentation test evaluates whether an engine produces complete, high-quality documentation for the models it builds. It verifies that every variable in the returned model carries documentation, and uses an LLM judge to confirm that each variable's documentation is accurate, specific, and descriptive of that variable's role within the system.`;
};

/**
 * The build scenarios used by this category. Each is a real-world dynamic system that
 * naturally yields a stock-and-flow model with a modest number of variables. The prompt
 * explicitly asks for documented variables so the test measures the engine's ability to
 * follow through on that instruction across every part of the system it builds.
 */
const cases = {
    "Population Growth": {
        problemStatement: "I want to understand how a population grows and shrinks over time so I can project its size into the future.",
        backgroundKnowledge: `A population increases through births and decreases through deaths. The number of births and deaths in a period both scale with the current size of the population. A fractional birth rate and a fractional death rate control how quickly each process happens.`
    },
    "Savings Account": {
        problemStatement: "I want to understand how the balance of a savings account changes over time as money is added, earns interest, and is withdrawn.",
        backgroundKnowledge: `A savings account has a balance that grows when the account holder makes deposits and when interest accrues, and shrinks when the account holder makes withdrawals. Interest earned each period is a fraction (the interest rate) of the current balance.`
    },
    "Inventory Management": {
        problemStatement: "I want to understand how a store's inventory of a product fluctuates as it is restocked and sold.",
        backgroundKnowledge: `A store holds an inventory of a product. Inventory rises as new units are produced or delivered and falls as units are sold to customers. The store tries to keep inventory near a desired coverage of expected sales, ordering more when inventory is low. Sales depend on customer demand, which can be limited by how much inventory is available.`
    },
    "Infectious Disease Spread": {
        problemStatement: "I want to understand how an infectious disease spreads through a population over the course of an outbreak.",
        backgroundKnowledge: `In a classic epidemic model a population is divided into people who are susceptible, people who are currently infected, and people who have recovered. Susceptible people become infected through contact with infected people, at a rate that depends on the contact rate and the infectivity of the disease. Infected people recover after an average duration of illness, moving into the recovered group.`
    },
    "Software Project Rework": {
        problemStatement: "I want to understand why software projects run late even when the team works hard, and how undiscovered errors and schedule pressure feed on each other over the life of a project.",
        backgroundKnowledge: `A software project has a fixed scope of work. Tasks begin in a backlog of work still to be done and move to a pool of completed work as the team finishes them at a work rate. The work rate depends on the number of developers and their productivity. Not all completed work is actually correct: a fraction contains defects and becomes undiscovered rework instead of being truly finished. Undiscovered rework is not visible to the team until it is found during testing, after a discovery delay, at which point it flows back into the backlog of work to be done. As the deadline approaches with work remaining, schedule pressure rises. Higher schedule pressure pushes developers to work faster, raising the work rate, but it also raises the fraction of work done incorrectly (haste makes waste), which generates still more undiscovered rework and further delays the project. Sustained overtime also erodes productivity as developers fatigue.`
    },
    "Fishery Boom and Bust": {
        problemStatement: "I want to understand how a commercial fishery can collapse from overharvesting, and why fishing fleet investment tends to drive boom-and-bust cycles in the fish population.",
        backgroundKnowledge: `A fish population grows through births and shrinks through natural deaths and through harvesting by a fishing fleet. The population regenerates fastest at intermediate levels and its net regeneration falls toward zero as it approaches the carrying capacity of the habitat or is driven near depletion. The harvest rate rises with both the number of fishing ships and the density of fish, since the catch per ship is higher when fish are abundant. Revenue from the harvest, less the operating cost of running the ships, determines the profit per ship. Profit drives investment in new ships, though new capacity is added only after a construction and financing delay; when profit turns negative, ships are scrapped or leave the fishery. More ships raise the harvest, which depletes the fish population, which lowers the catch per ship and eventually profit — a balancing process — but the investment delays cause the fleet to overshoot the sustainable level, producing cycles of boom and collapse.`
    },
    "Market Growth and Capacity": {
        problemStatement: "I want to understand why a fast-growing company's sales can stall or oscillate as it struggles to expand production capacity quickly enough to meet demand.",
        backgroundKnowledge: `A company's installed base of customers grows as the sales force wins new customers and shrinks as existing customers are lost. Customers place orders, and orders that cannot be filled immediately accumulate in a backlog. Production capacity limits how quickly the backlog can be filled, so the delivery delay experienced by customers is the backlog divided by the available capacity. A longer delivery delay reduces the company's attractiveness, which lowers the order rate and slows customer acquisition — a balancing loop that constrains growth. Revenue from filled orders funds investment in both the sales force and additional production capacity, but new capacity comes online only after a construction delay. A larger sales force wins customers faster, creating a reinforcing growth loop, while the capacity and delivery-delay dynamics push back against that growth and can cause sales to overshoot and oscillate.`
    }
};

/**
 * Generates a variable documentation test for a given build scenario.
 * @param {string} name The name of the scenario (also used as the test/case key)
 * @returns {Object} Test case with prompt, parameters, and expectations
 */
const generateTest = function(name) {
    const c = cases[name];
    return {
        name: `${name} variable documentation`,
        prompt: `Using the information I have given you, please build a complete stock-and-flow model of ${name.toLowerCase()}. Make sure that every variable in the model is clearly documented, describing what it represents and its role within the system.`,
        additionalParameters: {
            problemStatement: c.problemStatement,
            backgroundKnowledge: c.backgroundKnowledge
        },
        expectations: {
            systemName: name,
            problemStatement: c.problemStatement
        }
    };
};

/**
 * Produces a compact, human-readable summary of the causal links that touch a variable so
 * the quality judge can assess how well the documentation situates the variable within the
 * broader system without needing the entire (potentially large) model dumped into context.
 * @param {Object} model The generated SD-JSON model
 * @param {string} variableName The name of the variable to summarize links for
 * @returns {{incoming: Array<string>, outgoing: Array<string>}} Incoming and outgoing link descriptions
 */
const summarizeRelationshipsFor = function(model, variableName) {
    const relationships = model.relationships || [];
    const incoming = relationships
        .filter((r) => r.to === variableName)
        .map((r) => `${r.from} ${r.polarity || '?'}→ ${variableName}`);
    const outgoing = relationships
        .filter((r) => r.from === variableName)
        .map((r) => `${variableName} ${r.polarity || '?'}→ ${r.to}`);
    return { incoming, outgoing };
};

/**
 * Builds a compact textual description of a single variable, including its structural role
 * (type, equation, units, flows) and the causal links that connect it to the rest of the model.
 *
 * Graphical-function (lookup) variables need special care: their `equation` field holds only
 * the INPUT expression, and the actual — usually non-linear — relationship is encoded in the
 * lookup points. Presenting just the equation makes it look like a direct linear assignment to
 * the input, which caused the judge to wrongly flag correct documentation (e.g. an inverse
 * lookup documented as "attractiveness falls as delay rises") as contradicting its equation.
 * So we label the equation as the lookup input and spell out the points.
 * @param {Object} variable The variable to describe
 * @param {Object} model The full generated model, used to find the variable's causal links
 * @returns {string} A multi-line description of the variable
 */
const describeVariable = function(variable, model) {
    const parts = [`Name: ${variable.name}`, `Type: ${variable.type}`];
    if (variable.units) parts.push(`Units: ${variable.units}`);

    const gfPoints = (variable.graphicalFunction && Array.isArray(variable.graphicalFunction.points))
        ? variable.graphicalFunction.points
        : [];
    const hasGraphicalFunction = gfPoints.length > 0;

    if (variable.equation) {
        parts.push(hasGraphicalFunction
            ? `Graphical function input (the equation is the lookup's input, not a closed-form value): ${variable.equation}`
            : `Equation: ${variable.equation}`);
    }
    if (hasGraphicalFunction) {
        const pts = gfPoints.map((p) => `(${p.x}, ${p.y})`).join(', ');
        parts.push(`Graphical function points mapping the input above to this variable's value (input, output): ${pts}`);
    }

    // Arrayed variables span one or more dimensions and may carry per-element equations in
    // arrayEquations instead of (or in addition to) the scalar `equation` field above. Without
    // this the judge sees an arrayed variable as if it had no/one equation and can wrongly flag
    // it as incomplete or inconsistent with documentation that describes per-element behavior.
    if (Array.isArray(variable.dimensions) && variable.dimensions.length) {
        parts.push(`Arrayed over dimension(s): ${variable.dimensions.join(', ')}`);
    }
    if (Array.isArray(variable.arrayEquations) && variable.arrayEquations.length) {
        const arrayEqs = variable.arrayEquations.map((ae) => {
            const rawElements = Array.isArray(ae.forElements) ? ae.forElements.join(', ') : (ae.forElements ?? ae.index ?? '');
            const elements = String(rawElements).trim();
            return `${elements ? `[${elements}]` : '[apply to all]'} = ${ae.equation}`;
        }).join('; ');
        parts.push(`Per-element equations: ${arrayEqs}`);
    }

    if (Array.isArray(variable.inflows) && variable.inflows.length) parts.push(`Inflows: ${variable.inflows.join(', ')}`);
    if (Array.isArray(variable.outflows) && variable.outflows.length) parts.push(`Outflows: ${variable.outflows.join(', ')}`);

    const { incoming, outgoing } = summarizeRelationshipsFor(model, variable.name);
    if (incoming.length) parts.push(`Incoming causal links: ${incoming.join('; ')}`);
    if (outgoing.length) parts.push(`Outgoing causal links: ${outgoing.join('; ')}`);

    return parts.join('\n');
};

/**
 * Builds the message list for the single-pass LLM judge that assesses the documentation
 * quality of every variable in the model at once.
 * @param {Array<Object>} variables The variables to judge (all carry documentation by this point)
 * @param {Object} model The full generated model
 * @param {string} allVariableNames Comma separated list of every variable name in the model
 * @param {Object} expectations The test expectations (used to give the judge the modeling context)
 * @returns {Array<Object>} The messages to send to the judge LLM
 */
const buildQualityJudgeMessages = function(variables, model, allVariableNames, expectations) {
    const variablesBlock = variables.map((variable, i) => {
        return `--- Variable ${i + 1} ---
${describeVariable(variable, model)}
Documentation:
"""
${variable.documentation}
"""`;
    }).join('\n\n');

    return [
        {
            role: 'system',
            content: `You are a System Dynamics expert reviewing the quality of the documentation attached to the variables of a model. You will be shown the modeling context and, for every documented variable, its structural details and the documentation written for it. Judge each variable's documentation independently.

High-quality variable documentation must satisfy ALL of the following:
1. Accurate — it is consistent with the variable's name, type, units, equation, and its causal links to other variables. It contains no factual errors or contradictions.
2. Descriptive of the system — it explains what the variable represents and the role or purpose it serves within this particular system, not just a generic definition.
3. Specific and informative — it is not vacuous, boilerplate, or a mere restatement of the variable's name.

Return one evaluation for every variable you are shown. For each, set success to true only if the documentation satisfies all three criteria; otherwise set success to false and give a short failureReason. Leave failureReason empty when success is true.`
        },
        {
            role: 'user',
            content: `Modeling context: the model is being built to help with the following problem.
"""
${expectations.problemStatement || expectations.systemName}
"""

The model as a whole contains these variables: ${allVariableNames}.

Here is the documentation to review, one block per variable:

${variablesBlock}

Evaluate the documentation quality of each variable listed above.`
        }
    ];
};

/**
 * The structured-output schema the judge must return: one verdict per variable.
 */
const documentationQualitySchema = z.object({
    evaluations: z.array(z.object({
        variableName: z.string().describe('The exact name of the variable being evaluated'),
        success: z.boolean().describe('True if the documentation for this variable is high quality, false otherwise'),
        failureReason: z.string().describe('When success is false, a short explanation of why the documentation is inadequate; empty string when success is true')
    })).describe('One evaluation for every documented variable that was provided')
});

/**
 * This method inspects the generated model and returns a list of failure objects for any
 * variable that is missing documentation or whose documentation is judged low quality. The
 * quality of all documented variables is judged in a single structured-output LLM pass.
 * @param {Object} generatedResponse The response from the engine containing the built model
 * @param {Object} expectations The expectations describing the modeling scenario
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const model = generatedResponse?.model;
    const allVariables = (model && Array.isArray(model.variables)) ? model.variables : [];

    if (!model || allVariables.length === 0) {
        failures.push({
            type: 'No model produced',
            details: `The engine did not return a model containing variables to document.${generatedResponse?.err ? ` Engine error: ${generatedResponse.err}` : ''}`
        });
        return validateEvaluationResult(failures);
    }

    // In modularized models the flat variables array also contains ghost variables
    // (crossLevelGhostOf set): cross-module reference copies of a real variable defined in
    // another module. Ghosts carry no authored documentation of their own — the real
    // variable, which is also present in this list, holds it — so requiring or judging
    // documentation on a ghost would spuriously fail every modular model. Exclude them.
    const variables = allVariables.filter((v) => !((v.crossLevelGhostOf || '').toString().trim()));

    // 1) Coverage: every variable must be documented. A single undocumented variable fails
    // the evaluation outright, so there is no need to spend an LLM call judging quality in
    // that case — we report the missing documentation and stop here.
    for (const variable of variables) {
        if (!(variable.documentation || '').trim()) {
            failures.push({
                type: 'Missing documentation',
                details: `Variable "${variable.name}" (${variable.type}) has no documentation.`
            });
        }
    }

    if (failures.length > 0) {
        return validateEvaluationResult(failures);
    }

    // 2) Quality: every variable is documented at this point, so judge them all in a single pass.
    const allVariableNames = variables.map((v) => v.name).join(', ');

    // Create LLMWrapper instance configured for evaluation purposes
    const llm = new LLMWrapper({
        underlyingModel: LLMWrapper.EVAL_MODEL
    });
    const { underlyingModel, temperature } = llm.getLLMParameters(0);

    try {
        const messages = buildQualityJudgeMessages(variables, model, allVariableNames, expectations);
        const response = await llm.createChatCompletion(
            messages,
            underlyingModel,
            documentationQualitySchema,
            temperature
        );

        const parsed = JSON.parse(response.content);
        const evaluations = Array.isArray(parsed?.evaluations) ? parsed.evaluations : [];

        for (const result of evaluations) {
            if (result && result.success === false) {
                failures.push({
                    type: 'Low quality documentation',
                    details: `Documentation for variable "${result.variableName}" was judged low quality: ${result.failureReason || 'No reason provided by judge.'}`
                });
            }
        }
    } catch (error) {
        failures.push({
            type: 'Evaluation error',
            details: `Error judging documentation quality: ${error.message}`
        });
    }

    return validateEvaluationResult(failures);
};

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    "simpleVariableDocumentation": [
        generateTest("Population Growth"),
        generateTest("Savings Account")
    ],
    "mediumVariableDocumentation": [
        generateTest("Inventory Management"),
        generateTest("Infectious Disease Spread")
    ],
    "complexVariableDocumentation": [
        generateTest("Software Project Rework"),
        generateTest("Fishery Boom and Bust"),
        generateTest("Market Growth and Capacity")
    ]
};
