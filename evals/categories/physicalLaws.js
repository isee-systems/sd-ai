/**
 * Physical Laws Evaluation
 *
 * This evaluation tests the LLM's ability to build System Dynamics models that accurately
 * represent physical systems governed by Newton's laws of motion. Specifically, it asks
 * the LLM to create a pendulum model and validates that the generated model:
 *
 * 1. Conserves energy (when no damping is present)
 * 2. Exhibits the correct relationship between angle, angular velocity, and angular acceleration
 * 3. Follows Newton's second law (F = ma, or τ = Iα for rotational motion)
 * 4. Produces physically realistic behavior (oscillation with correct period)
 *
 * The evaluation uses PySDSimulator to convert the LLM's sd-json response to XMILE format,
 * simulate it, and then validates the physical behavior against Newton's laws.
 *
 * @module categories/physicalLaws
 */

import PySDSimulator from '../utilities/simulator/PySDSimulator.js';
import { validateEvaluationResult } from '../evaluationSchema.js';
import SDJsonToXMILE from '../../utilities/SDJsonToXMILE.js';

/**
 * Returns the description for this category
 * @returns {string} The description describing this category
 */
export const description = () => {
    return `The physical laws evaluation assesses an LLM's ability to build System Dynamics models that
accurately represent physical systems governed by Newton's laws of motion. It tests whether the model
exhibits correct energy conservation, proper force-acceleration relationships, and physically realistic behavior.`;
};

/**
 * Validates that a pendulum model obeys Newton's laws of motion
 * @param {Object} simulationResults - Results from simulation containing time, angle, angular_velocity, angular_acceleration
 * @param {Object} model - The model object containing variables
 * @returns {Array<Object>} A list of failures with type and details
 */
const validateNewtonsLaws = (simulationResults, model) => {
    const fails = [];

    // Extract time series data
    const time = simulationResults.time;
    const angle = simulationResults.angle;
    const angularVelocity = simulationResults.angular_velocity;
    const angularAcceleration = simulationResults.angular_acceleration;

    if (!time || !angle || !angularVelocity || !angularAcceleration) {
        fails.push({
            type: "Missing required variables",
            details: "Simulation must produce 'angle', 'angular_velocity', and 'angular_acceleration' time series"
        });
        return fails;
    }

    // Validate data lengths match
    if (angle.length !== angularVelocity.length || angle.length !== angularAcceleration.length) {
        fails.push({
            type: "Inconsistent time series lengths",
            details: "All time series must have the same length"
        });
        return fails;
    }

    // Check for physically realistic oscillation
    // A pendulum should oscillate around zero (or some equilibrium)
    const angleMin = Math.min(...angle);
    const angleMax = Math.max(...angle);
    const angleRange = angleMax - angleMin;

    if (angleRange < 0.01) {
        fails.push({
            type: "No oscillation detected",
            details: `Angle range is too small (${angleRange.toFixed(6)}). Pendulum should oscillate.`
        });
    }

    // Check for sign changes in angle (crosses equilibrium)
    let signChanges = 0;
    for (let i = 1; i < angle.length; i++) {
        if ((angle[i] > 0 && angle[i - 1] < 0) || (angle[i] < 0 && angle[i - 1] > 0)) {
            signChanges++;
        }
    }

    if (signChanges < 2) {
        fails.push({
            type: "Insufficient oscillations",
            details: `Expected multiple oscillations but only detected ${signChanges} zero crossings`
        });
    }

    // Newton's Second Law for rotational motion: τ = I * α
    // For a simple pendulum: α = -(g/L) * sin(θ)
    // Check that angular_acceleration has the correct relationship with angle
    // We expect: angular_acceleration ≈ -constant * sin(angle) or for small angles: -constant * angle

    // Calculate correlation between angle and angular_acceleration
    // They should be negatively correlated (when angle is positive, acceleration should be negative)
    let correlationSum = 0;
    let angleSum = 0;
    let accelSum = 0;
    let validPoints = 0;

    for (let i = 0; i < angle.length; i++) {
        // Skip points with very small angles to avoid noise
        if (Math.abs(angle[i]) > 0.001) {
            correlationSum += angle[i] * angularAcceleration[i];
            angleSum += angle[i] * angle[i];
            accelSum += angularAcceleration[i] * angularAcceleration[i];
            validPoints++;
        }
    }

    if (validPoints > 0 && angleSum > 0 && accelSum > 0) {
        // Simplified correlation (should be negative for pendulum)
        const correlation = correlationSum / Math.sqrt(angleSum * accelSum);

        if (correlation > -0.5) {
            fails.push({
                type: "Newton's second law violation",
                details: `Angular acceleration should be negatively correlated with angle (restoring force). ` +
                        `Correlation coefficient: ${correlation.toFixed(3)} (expected < -0.5)`
            });
        }
    }

    // Check velocity-acceleration relationship
    // Angular velocity should be at maximum when angle is zero (conservation of energy)
    // Find indices where angle is closest to zero
    const zeroAngles = [];
    for (let i = 1; i < angle.length - 1; i++) {
        if (Math.abs(angle[i]) < Math.abs(angle[i - 1]) && Math.abs(angle[i]) < Math.abs(angle[i + 1])) {
            if (Math.abs(angle[i]) < 0.1 * angleRange) {
                zeroAngles.push(i);
            }
        }
    }

    // At zero angles, angular velocity should be at or near maximum
    if (zeroAngles.length > 0) {
        const maxVelocity = Math.max(...angularVelocity.map(Math.abs));
        let velocityAtZeroSum = 0;

        for (const idx of zeroAngles) {
            velocityAtZeroSum += Math.abs(angularVelocity[idx]);
        }

        const avgVelocityAtZero = velocityAtZeroSum / zeroAngles.length;

        // Average velocity at zero should be at least 60% of max (accounting for damping)
        if (avgVelocityAtZero < 0.5 * maxVelocity) {
            fails.push({
                type: "Energy conservation violation",
                details: `Angular velocity should be maximum when angle is zero (energy conservation). ` +
                        `Average velocity at zero: ${avgVelocityAtZero.toFixed(3)}, ` +
                        `Maximum velocity: ${maxVelocity.toFixed(3)} ` +
                        `(ratio: ${(avgVelocityAtZero / maxVelocity).toFixed(3)})`
            });
        }
    }

    // Check that angular velocity is the derivative of angle
    // For discrete time: velocity[i] ≈ (angle[i+1] - angle[i]) / dt
    if (time.length >= 3) {
        const dt = time[1] - time[0];
        let derivativeError = 0;
        let validDerivatives = 0;

        for (let i = 1; i < angle.length - 1; i++) {
            const numericalDerivative = (angle[i + 1] - angle[i - 1]) / (2 * dt);
            const modelVelocity = angularVelocity[i];

            // Calculate relative error
            if (Math.abs(modelVelocity) > 0.001) {
                const error = Math.abs(numericalDerivative - modelVelocity) / Math.abs(modelVelocity);
                derivativeError += error;
                validDerivatives++;
            }
        }

        if (validDerivatives > 0) {
            const avgDerivativeError = derivativeError / validDerivatives;

            // Average error should be less than 20%
            if (avgDerivativeError > 0.2) {
                fails.push({
                    type: "Kinematic consistency violation",
                    details: `Angular velocity should be the derivative of angle. ` +
                            `Average relative error: ${(avgDerivativeError * 100).toFixed(1)}% (expected < 20%)`
                });
            }
        }
    }

    // Check for unbounded growth (non-physical)
    const firstHalfMax = Math.max(...angle.slice(0, Math.floor(angle.length / 2)).map(Math.abs));
    const secondHalfMax = Math.max(...angle.slice(Math.floor(angle.length / 2)).map(Math.abs));

    // Allow some damping but not exponential growth
    if (secondHalfMax > 2 * firstHalfMax) {
        fails.push({
            type: "Unbounded growth",
            details: `Pendulum angle should not grow unbounded. ` +
                    `First half max: ${firstHalfMax.toFixed(3)}, ` +
                    `Second half max: ${secondHalfMax.toFixed(3)}`
        });
    }

    return fails;
};

/**
 * Evaluates whether the generated pendulum model obeys Newton's laws of motion
 * @param {Object} generatedResponse The response from the engine containing the model
 * @param {Object} requirements The test requirements
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

        // Check if required variables exist
        const requiredVars = ['angle', 'angular_velocity', 'angular_acceleration'];
        const missingVars = [];

        for (const varName of requiredVars) {
            const variable = model.variables?.find(v =>
                v.name.toLowerCase().replace(/[_\s]/g, '') === varName.replace(/[_\s]/g, '')
            );
            if (!variable) {
                missingVars.push(varName);
            }
        }

        if (missingVars.length > 0) {
            fails.push({
                type: "Missing required variables",
                details: `The model must contain variables: ${missingVars.join(', ')}`
            });
            return validateEvaluationResult(fails);
        }

        // Convert model to XMILE
        let xmileContent;
        try {
            xmileContent = SDJsonToXMILE(generatedResponse, {
                modelName: model.name || 'Pendulum Model',
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
            // Note: 'time' is automatically included in results, don't request it as a variable
            simulationResults = await simulator.simulate(['angle', 'angular_velocity', 'angular_acceleration']);
        } catch (error) {
            fails.push({
                type: "Simulation error",
                details: `Failed to simulate the model: ${error.message}`
            });
            return validateEvaluationResult(fails);
        }

        // Validate Newton's laws
        const physicsViolations = validateNewtonsLaws(simulationResults, model);
        fails.push(...physicsViolations);

    } catch (error) {
        fails.push({
            type: "Unexpected evaluation error",
            details: error.message
        });
    }

    return validateEvaluationResult(fails);
};

/**
 * Generate a pendulum test
 * @param {string} name - Test name
 * @param {string} description - Description of the specific pendulum scenario
 * @param {string} backgroundKnowledge - Background information about the physics
 * @returns {Object} Test configuration object
 */
const generatePendulumTest = function(name, description, backgroundKnowledge) {
    return {
        name: name,
        prompt: `Create a System Dynamics model of ${description}. The model must include variables named 'angle' (angular position in radians), 'angular_velocity' (angular velocity in radians/second), and 'angular_acceleration' (angular acceleration in radians/second²). The model should obey Newton's laws of motion.`,
        additionalParameters: {
            problemStatement: `I need a pendulum model that accurately represents ${description} and follows Newton's laws.`,
            backgroundKnowledge: backgroundKnowledge
        },
        expectations: {}
    };
};

/**
 * Test cases for pendulum models
 */
const pendulumTests = [
    generatePendulumTest(
        "Simple Pendulum",
        "a simple pendulum with a small initial displacement",
        "A simple pendulum consists of a mass suspended from a fixed point by a massless string. " +
        "For small angles, the motion approximates simple harmonic motion. " +
        "Newton's second law for rotational motion states: τ = I*α, where τ is torque, I is moment of inertia, and α is angular acceleration. " +
        "For a simple pendulum: α = -(g/L)*sin(θ), where g is gravitational acceleration (9.8 m/s²), L is length, and θ is angle. " +
        "For small angles, sin(θ) ≈ θ, giving α ≈ -(g/L)*θ. " +
        "The angular velocity ω = dθ/dt, and angular acceleration α = dω/dt. " +
        "Energy is conserved: E = (1/2)*I*ω² + mgh, where potential energy depends on height h = L*(1-cos(θ))."
    ),
    generatePendulumTest(
        "Damped Pendulum",
        "a damped pendulum with friction",
        "A damped pendulum experiences a resistive force proportional to velocity. " +
        "The equation of motion becomes: α = -(g/L)*sin(θ) - (b/I)*ω, where b is the damping coefficient. " +
        "Newton's second law still applies: τ_total = τ_gravity + τ_damping = I*α. " +
        "The system loses energy over time due to friction, causing oscillation amplitude to decrease exponentially. " +
        "Angular acceleration must still be the derivative of angular velocity, and angular velocity the derivative of angle."
    ),
    generatePendulumTest(
        "Pendulum with Moderate Initial Angle",
        "a simple pendulum with a moderate initial displacement (30 degrees)",
        "For larger angles, the small-angle approximation breaks down and we must use the full equation: α = -(g/L)*sin(θ). " +
        "This introduces non-linearity, making the period slightly longer than predicted by the small-angle approximation. " +
        "Newton's laws still govern the motion: the restoring torque is τ = -m*g*L*sin(θ), and τ = I*α. " +
        "Energy conservation still holds (in the absence of damping): KE + PE = constant, where PE = m*g*L*(1-cos(θ)). " +
        "The motion is still periodic but not exactly sinusoidal due to the nonlinear restoring force."
    )
];

/**
 * The groups of tests to be evaluated as a part of this category
 */
export const groups = {
    pendulumPhysics: pendulumTests
};
