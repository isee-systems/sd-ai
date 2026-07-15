/**
 * Simulation Completion Evaluation
 *
 * This evaluation category tests whether the stock-and-flow models an engine builds are
 * actually runnable: it takes the generated SD-JSON model, converts it to XMILE, and runs
 * it through the PySD simulator, confirming that the model simulates all the way to the end
 * of its own time horizon.
 *
 * Where the quantitative-reasoning and translation categories check whether a model contains
 * the right structure, this category checks the far more basic property that the structure
 * the engine produced can be numerically integrated at all. A model that references a
 * variable it never defines, divides by zero, leaves a flow without an equation, or omits a
 * usable set of simulation specs will build fine as JSON but will fail the moment a simulator
 * tries to run it. This test catches exactly those failures.
 *
 * For each scenario the engine is asked to build a complete, simulatable quantitative
 * stock-and-flow model. The evaluation then verifies, in order:
 *
 *   1. Structure — the model contains at least one stock and one flow (i.e. it really is a
 *      stock-and-flow model) and defines numeric simulation specs with a stopTime that is
 *      strictly later than its startTime, so "the end" of the run is well defined.
 *   2. Convertibility — the model can be converted to XMILE without error.
 *   3. Simulatability — PySD loads and runs the model without raising an error while tracking
 *      every stock (the integrated state variables) in the model.
 *   4. Completion — the returned time series reaches the model's stopTime (the run was not cut
 *      short), and every stock trajectory is made up of finite values from start to finish,
 *      so the model did not blow up numerically before reaching the end.
 *
 * @module categories/simulationCompletion
 */

import PySDSimulator from '../utilities/simulator/PySDSimulator.js';
import { validateEvaluationResult } from '../evaluationSchema.js';
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';
import utils from '../../utilities/utils.js';

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The simulation completion evaluation assesses whether the stock-and-flow models an engine builds can actually be run. Each generated model is converted to XMILE and executed with the PySD simulator; the test passes only if the model contains a genuine stock-and-flow structure with usable simulation specs, loads and runs without error, produces finite trajectories for every stock, and simulates all the way to the end of its defined time horizon.`;
};

/**
 * The build scenarios used by this category. Each is a classic dynamic system that yields a
 * runnable stock-and-flow model. The background knowledge deliberately includes concrete
 * initial conditions, parameter values, and a suggested time horizon so a competent engine has
 * everything it needs to assemble a well-posed, simulatable model — this keeps the test focused
 * on whether the engine can produce a model that runs, rather than on whether it can invent
 * good numbers. Difficulty rises from a single stock (simple) to several interacting stocks
 * with feedback and delays (complex).
 */
const cases = {
    "Population Growth": {
        problemStatement: "I want to project how a population changes over time given its birth and death processes.",
        backgroundKnowledge: `A single population is a stock of individuals. It increases through births and decreases through deaths. Births each year equal the current population multiplied by a fractional birth rate, and deaths each year equal the current population multiplied by a fractional death rate. Use an initial population of 1000 individuals, a fractional birth rate of 0.03 per year, and a fractional death rate of 0.015 per year. Simulate from year 0 to year 100 with a time step of 0.25 years, using years as the time unit.`
    },
    "Savings Account": {
        problemStatement: "I want to understand how the balance of a savings account evolves as it earns interest and money is added and withdrawn.",
        backgroundKnowledge: `A savings account has a single stock: its balance, in dollars. The balance grows through an inflow made up of interest earned plus regular deposits, and shrinks through an outflow of regular withdrawals. Interest earned each year equals the current balance multiplied by an annual interest rate. Use an initial balance of 5000 dollars, an annual interest rate of 0.03 per year, deposits of 2400 dollars per year, and withdrawals of 1200 dollars per year. Simulate from year 0 to year 30 with a time step of 0.25 years, using years as the time unit.`
    },
    "Infectious Disease Spread": {
        problemStatement: "I want to understand how an infectious disease moves through a fixed population during an outbreak.",
        backgroundKnowledge: `Use the classic SIR structure with three stocks: susceptible people, infected people, and recovered people. Susceptible people become infected and flow into the infected stock; infected people recover and flow into the recovered stock. The infection rate equals the contact rate times the infectivity times the number of infected people times the fraction of the total population that is still susceptible (susceptible divided by total population). The recovery rate equals the infected population divided by the average duration of illness. Use a total population of 10000, with 9990 initially susceptible, 10 initially infected, and 0 recovered. Use a contact rate of 6 contacts per person per day, an infectivity of 0.05, and an average duration of illness of 5 days. Simulate from day 0 to day 100 with a time step of 0.5 days, using days as the time unit.`
    },
    "Inventory Management": {
        problemStatement: "I want to understand how a store's inventory responds when it continuously reorders stock toward a target level.",
        backgroundKnowledge: `A store holds a single stock of inventory, in units. Inventory rises through a production/delivery inflow and falls through a shipment outflow. Shipments equal customer demand, which is a constant 100 units per week. The store wants to keep inventory at a desired level equal to a target coverage of expected sales: desired inventory equals demand multiplied by a desired coverage of 4 weeks. The production rate equals demand plus a correction that closes the gap between desired inventory and current inventory over an inventory adjustment time of 8 weeks (that is, production equals demand plus (desired inventory minus inventory) divided by the adjustment time). Start with an initial inventory of 200 units, which is below the desired level, so the correction loop is active. Simulate from week 0 to week 52 with a time step of 0.25 weeks, using weeks as the time unit.`
    },
    "Predator-Prey Dynamics": {
        problemStatement: "I want to understand how the populations of a predator and its prey rise and fall together over time.",
        backgroundKnowledge: `Use the classic Lotka-Volterra structure with two stocks: a prey population and a predator population. The prey population grows through prey births and shrinks through prey deaths caused by predation. Prey births equal a prey birth rate coefficient times the prey population. Prey deaths equal a predation coefficient times the prey population times the predator population. The predator population grows through predator births and shrinks through predator deaths. Predator births equal a predator efficiency coefficient times the prey population times the predator population. Predator deaths equal a predator death rate coefficient times the predator population. Use an initial prey population of 100 and an initial predator population of 20. Use a prey birth rate coefficient of 0.5, a predation coefficient of 0.02, a predator efficiency coefficient of 0.01, and a predator death rate coefficient of 0.4 (all per appropriate time unit). Because this system oscillates, use a small time step for numerical stability: simulate from time 0 to time 50 with a time step of 0.03125, using months as the time unit.`
    },
    "Software Project Rework": {
        problemStatement: "I want to understand why a software project takes longer than planned once undiscovered rework is taken into account.",
        backgroundKnowledge: `Model a fixed-scope software project with three stocks, all measured in tasks: work to be done, undiscovered rework, and work truly done. The team completes tasks at a work rate that flows out of work to be done. The work rate equals the number of developers times their productivity. A fraction of completed work is done correctly and flows into work truly done; the remaining fraction contains defects and flows into undiscovered rework instead. Undiscovered rework is not visible immediately: it is detected and flows back into work to be done at a rework discovery rate equal to the undiscovered rework stock divided by an average discovery delay. Use an initial work to be done of 500 tasks, an initial undiscovered rework of 0 tasks, and an initial work truly done of 0 tasks. Use 10 developers, a productivity of 0.4 tasks per developer per week, a fraction correct of 0.85 (so 0.15 of completed work becomes undiscovered rework), and an average discovery delay of 4 weeks. To avoid completed work continuing to be generated once the backlog is empty, the work rate should not exceed the amount of work remaining to be done. Simulate from week 0 to week 200 with a time step of 0.25 weeks, using weeks as the time unit.`
    }
};

/**
 * Generates a simulation completion test for a given build scenario.
 * @param {string} name The name of the scenario (also used as the test/case key)
 * @returns {Object} Test case with prompt, parameters, and expectations
 */
const generateTest = function(name) {
    const c = cases[name];
    return {
        name: `${name} simulates to completion`,
        prompt: `Using the information I have given you, please build a complete, simulatable quantitative stock-and-flow model of ${name.toLowerCase()}. Every stock must have a numeric initial value, every flow and auxiliary must have a well-defined equation, and the model must include simulation specifications (start time, stop time, time step, and time units) covering the full horizon described. The model must be able to run to completion in a system dynamics simulator without errors.`,
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
 * Inspects the generated model and returns a list of failure objects if the model is not a
 * runnable stock-and-flow model, cannot be converted to XMILE, fails to simulate through PySD,
 * or does not simulate cleanly to the end of its defined time horizon.
 * @param {Object} generatedResponse The response from the engine containing the built model
 * @param {Object} expectations The expectations describing the modeling scenario
 * @returns {Array<Object>} A list of failures with type and details.
 */
export const evaluate = async function(generatedResponse, expectations) {
    const failures = [];
    const model = generatedResponse?.model;
    const variables = (model && Array.isArray(model.variables)) ? model.variables : [];

    // A model with variables must exist before anything else can be checked.
    if (!model || variables.length === 0) {
        failures.push({
            type: 'No model produced',
            details: `The engine did not return a model containing variables to simulate.${generatedResponse?.err ? ` Engine error: ${generatedResponse.err}` : ''}`
        });
        return validateEvaluationResult(failures);
    }

    // 1) Structure: it must genuinely be a stock-and-flow model.
    const stocks = variables.filter((v) => v.type === 'stock');
    const flows = variables.filter((v) => v.type === 'flow');
    if (stocks.length === 0 || flows.length === 0) {
        failures.push({
            type: 'Not a stock-and-flow model',
            details: `A simulatable stock-and-flow model must contain at least one stock and one flow. Found ${stocks.length} stock(s) and ${flows.length} flow(s).`
        });
        return validateEvaluationResult(failures);
    }

    // The time horizon must be well defined so "the end" of the run is unambiguous. The
    // simulator runs on the model's own specs, so those specs have to describe a real interval.
    const specs = model.specs || {};
    const startTime = Number(specs.startTime);
    const stopTime = Number(specs.stopTime);
    const dt = (Number.isFinite(Number(specs.dt)) && Number(specs.dt) > 0) ? Number(specs.dt) : 1;

    if (!Number.isFinite(startTime) || !Number.isFinite(stopTime) || stopTime <= startTime) {
        failures.push({
            type: 'Missing simulation specs',
            details: `The model must define numeric simulation specs with a stopTime strictly greater than its startTime so it has a defined end. Got startTime=${specs.startTime}, stopTime=${specs.stopTime}.`
        });
        return validateEvaluationResult(failures);
    }

    // 2) Convertibility: turn the model into XMILE for the simulator.
    let xmileContent;
    try {
        xmileContent = SDJsonToXMILE(generatedResponse, {
            modelName: model.name || expectations.systemName || 'Simulation Completion Model',
            vendor: 'SD-AI Evaluation',
            product: 'sd-ai-evals',
            version: '1.0'
        });
    } catch (error) {
        failures.push({
            type: 'XMILE conversion error',
            details: `Failed to convert the model to XMILE for simulation: ${error.message}`
        });
        return validateEvaluationResult(failures);
    }

    // 3) Simulatability: run the model, tracking every stock (the integrated state variables).
    // If PySD cannot load or integrate the model it raises, which surfaces here as an error.
    // Track by the XMILE-normalized name (spaces -> underscores): SDJsonToXMILE names the
    // model elements via utils.xmileName, so the simulator only knows a stock like
    // "savings balance" as "savings_balance". Passing the raw name makes PySD reject it as a
    // missing model element.
    const stockNames = stocks.map((s) => utils.xmileName(s.name));
    let simulationResults;
    try {
        const simulator = new PySDSimulator(xmileContent);
        simulationResults = await simulator.simulate(stockNames);
    } catch (error) {
        failures.push({
            type: 'Simulation error',
            details: `The model failed to simulate through the PySD simulator: ${error.message}`
        });
        return validateEvaluationResult(failures);
    }

    const time = simulationResults?.time;
    if (!Array.isArray(time) || time.length === 0) {
        failures.push({
            type: 'No simulation output',
            details: 'The simulator did not return any time steps for the model.'
        });
        return validateEvaluationResult(failures);
    }

    // 4a) Completion: the run must reach the model's stopTime rather than stopping short. A
    // tolerance of one time step absorbs save-interval grids that do not land exactly on stopTime.
    const lastTime = time[time.length - 1];
    const tolerance = Math.max(dt, Math.abs(stopTime) * 1e-6, 1e-9);
    if (!Number.isFinite(lastTime) || Math.abs(lastTime - stopTime) > tolerance) {
        failures.push({
            type: 'Simulation did not reach end time',
            details: `The simulation was expected to run to its stopTime of ${stopTime}${specs.timeUnits ? ` ${specs.timeUnits}` : ''} but the last reported time step was ${lastTime}.`
        });
    }

    // 4b) Completion: every stock must hold finite values across the whole run. A non-finite
    // value means the model diverged (overflow, division blow-up, etc.) before reaching the end.
    for (const stock of stocks) {
        const series = simulationResults[utils.xmileName(stock.name)];
        if (!Array.isArray(series) || series.length === 0) {
            failures.push({
                type: 'Missing stock trajectory',
                details: `The simulator returned no trajectory for stock "${stock.name}".`
            });
            continue;
        }
        const badIndex = series.findIndex((v) => !Number.isFinite(v));
        if (badIndex !== -1) {
            failures.push({
                type: 'Non-finite simulation values',
                details: `Stock "${stock.name}" produced a non-finite value (${series[badIndex]}) at time ${time[badIndex]}, indicating the model did not simulate cleanly to the end.`
            });
        }
    }

    return validateEvaluationResult(failures);
};

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    "simpleSimulationCompletion": [
        generateTest("Population Growth"),
        generateTest("Savings Account")
    ],
    "mediumSimulationCompletion": [
        generateTest("Infectious Disease Spread"),
        generateTest("Inventory Management")
    ],
    "complexSimulationCompletion": [
        generateTest("Predator-Prey Dynamics"),
        generateTest("Software Project Rework")
    ]
};
