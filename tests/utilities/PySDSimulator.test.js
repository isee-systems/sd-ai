import PySDSimulator from '../../evals/utilities/simulator/PySDSimulator.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('PySDSimulator', () => {
    let armsRaceContent;
    let bassDiffusionContent;

    beforeAll(() => {
        // Load the XMILE model files
        const armsRacePath = join(__dirname, '../../evals/categories/feedbackExplanationData/armsRace.stmx');
        const bassDiffusionPath = join(__dirname, '../../evals/categories/feedbackExplanationData/bassDiffusion.stmx');

        armsRaceContent = readFileSync(armsRacePath, 'utf8');
        bassDiffusionContent = readFileSync(bassDiffusionPath, 'utf8');
    });

    describe('Constructor', () => {
        test('should create simulator with valid XMILE content', () => {
            expect(() => new PySDSimulator(armsRaceContent)).not.toThrow();
        });

        test('should throw error for empty content', () => {
            expect(() => new PySDSimulator('')).toThrow('xmileContent must be a non-empty string');
        });

        test('should throw error for non-string content', () => {
            expect(() => new PySDSimulator(null)).toThrow('xmileContent must be a non-empty string');
            expect(() => new PySDSimulator(undefined)).toThrow('xmileContent must be a non-empty string');
            expect(() => new PySDSimulator(123)).toThrow('xmileContent must be a non-empty string');
        });
    });

    describe('getAvailableVariables', () => {
        test('should return variables for armsRace model', async () => {
            const simulator = new PySDSimulator(armsRaceContent);
            const variables = await simulator.getAvailableVariables();

            expect(Array.isArray(variables)).toBe(true);
            expect(variables.length).toBeGreaterThan(0);

            // Check for key variables in the arms race model
            expect(variables).toContain('Our Weapons');
            expect(variables).toContain('Their Weapons');
        });

        test('should return variables for bassDiffusion model', async () => {
            const simulator = new PySDSimulator(bassDiffusionContent);
            const variables = await simulator.getAvailableVariables();

            expect(Array.isArray(variables)).toBe(true);
            expect(variables.length).toBeGreaterThan(0);

            // Check for key variables in the bass diffusion model
            expect(variables).toContain('Adopters');
            expect(variables).toContain('Potential Adopters');
        });
    });

    describe('simulate - armsRace model', () => {
        let simulator;

        beforeEach(() => {
            simulator = new PySDSimulator(armsRaceContent);
        });

        test('should simulate with single variable', async () => {
            const results = await simulator.simulate(['Our Weapons']);

            expect(results).toHaveProperty('time');
            expect(results).toHaveProperty('Our Weapons');
            expect(Array.isArray(results.time)).toBe(true);
            expect(Array.isArray(results['Our Weapons'])).toBe(true);
            expect(results.time.length).toBe(results['Our Weapons'].length);
        });

        test('should simulate with multiple variables', async () => {
            const results = await simulator.simulate(['Our Weapons', 'Their Weapons']);

            expect(results).toHaveProperty('time');
            expect(results).toHaveProperty('Our Weapons');
            expect(results).toHaveProperty('Their Weapons');
            expect(results.time.length).toBe(results['Our Weapons'].length);
            expect(results.time.length).toBe(results['Their Weapons'].length);
        });

        test('should use model time specs (0 to 50 years)', async () => {
            const results = await simulator.simulate(['Our Weapons']);

            expect(results.time[0]).toBe(0);
            expect(results.time[results.time.length - 1]).toBe(50);
        });

        test('should show arms race escalation behavior', async () => {
            const results = await simulator.simulate(['Our Weapons', 'Their Weapons']);

            // Initial conditions: Our Weapons = 10, Their Weapons = 0
            expect(results['Our Weapons'][0]).toBe(10);
            expect(results['Their Weapons'][0]).toBe(0);

            // Both should increase over time (escalation)
            const ourFinal = results['Our Weapons'][results['Our Weapons'].length - 1];
            const theirFinal = results['Their Weapons'][results['Their Weapons'].length - 1];

            expect(ourFinal).toBeGreaterThan(results['Our Weapons'][0]);
            expect(theirFinal).toBeGreaterThan(results['Their Weapons'][0]);
        });

        test('should throw error for empty variables array', async () => {
            await expect(simulator.simulate([])).rejects.toThrow('variables must be a non-empty array');
        });

        test('should throw error for non-array variables', async () => {
            await expect(simulator.simulate('Our Weapons')).rejects.toThrow('variables must be a non-empty array');
        });

        test('should throw error for non-existent variable', async () => {
            await expect(simulator.simulate(['NonExistentVariable'])).rejects.toThrow();
        });

        test('should compute correct final values at t=50', async () => {
            const results = await simulator.simulate(['Our Weapons', 'Their Weapons']);

            const finalOurWeapons = results['Our Weapons'][results['Our Weapons'].length - 1];
            const finalTheirWeapons = results['Their Weapons'][results['Their Weapons'].length - 1];

            // Expected values from PySD simulation at t=50
            expect(finalOurWeapons).toBeCloseTo(36.76, 1);  // ~36.76 missiles
            expect(finalTheirWeapons).toBeCloseTo(36.76, 1);  // ~36.76 missiles

            // Both sides should converge to approximately equal arsenals
            expect(Math.abs(finalOurWeapons - finalTheirWeapons)).toBeLessThan(0.01);
        });

        test('should show correct mid-point values at t=25', async () => {
            const results = await simulator.simulate(['Our Weapons', 'Their Weapons']);

            // Find value closest to t=25
            const midIndex = results.time.findIndex(t => t >= 25);
            const ourWeaponsAtMid = results['Our Weapons'][midIndex];
            const theirWeaponsAtMid = results['Their Weapons'][midIndex];

            // At t=25, weapons should be between initial and final values
            expect(ourWeaponsAtMid).toBeGreaterThan(10);  // Greater than initial
            expect(ourWeaponsAtMid).toBeLessThan(36.76);  // Less than final
            expect(theirWeaponsAtMid).toBeGreaterThan(0);  // Greater than initial
            expect(theirWeaponsAtMid).toBeLessThan(36.76);  // Less than final
        });
    });

    describe('simulate - bassDiffusion model', () => {
        let simulator;

        beforeEach(() => {
            simulator = new PySDSimulator(bassDiffusionContent);
        });

        test('should simulate adopters and potential adopters', async () => {
            const results = await simulator.simulate(['Adopters', 'Potential Adopters']);

            expect(results).toHaveProperty('time');
            expect(results).toHaveProperty('Adopters');
            expect(results).toHaveProperty('Potential Adopters');
            expect(results.time.length).toBe(results.Adopters.length);
            expect(results.time.length).toBe(results['Potential Adopters'].length);
        });

        test('should use model time specs (0 to 15 years)', async () => {
            const results = await simulator.simulate(['Adopters']);

            expect(results.time[0]).toBe(0);
            expect(results.time[results.time.length - 1]).toBe(15);
        });

        test('should show S-curve adoption behavior', async () => {
            const results = await simulator.simulate(['Adopters', 'Potential Adopters']);

            // Initial conditions: Adopters = 1, Potential Adopters = Market_Size - 1
            expect(results.Adopters[0]).toBe(1);
            expect(results['Potential Adopters'][0]).toBeGreaterThan(0);

            // Adopters should increase over time
            const adoptersFinal = results.Adopters[results.Adopters.length - 1];
            expect(adoptersFinal).toBeGreaterThan(results.Adopters[0]);

            // Potential adopters should decrease over time
            const potentialFinal = results['Potential Adopters'][results['Potential Adopters'].length - 1];
            expect(potentialFinal).toBeLessThan(results['Potential Adopters'][0]);

            // Conservation: Adopters + Potential Adopters should remain approximately constant
            const initialSum = results.Adopters[0] + results['Potential Adopters'][0];
            const finalSum = adoptersFinal + potentialFinal;
            expect(Math.abs(finalSum - initialSum)).toBeLessThan(1); // Within rounding error
        });

        test('should simulate adoption flow', async () => {
            const results = await simulator.simulate(['adopting', 'Adopters']);

            expect(results).toHaveProperty('adopting');
            expect(Array.isArray(results.adopting)).toBe(true);

            // Adoption rate should be non-negative
            const allNonNegative = results.adopting.every(val => val >= 0);
            expect(allNonNegative).toBe(true);
        });

        test('should show increasing adoption rate initially', async () => {
            const results = await simulator.simulate(['adopting']);

            // The adoption rate should increase initially (reinforcing feedback)
            // then decrease as the market saturates (balancing feedback)
            const adoptionRates = results.adopting;

            // Find the peak adoption rate
            const maxRate = Math.max(...adoptionRates);
            const maxIndex = adoptionRates.indexOf(maxRate);

            // Peak should not be at the beginning or end (S-curve behavior)
            expect(maxIndex).toBeGreaterThan(0);
            expect(maxIndex).toBeLessThan(adoptionRates.length - 1);
        });

        test('should compute correct final values at t=15', async () => {
            const results = await simulator.simulate(['Adopters', 'Potential Adopters', 'adopting']);

            const finalAdoters = results.Adopters[results.Adopters.length - 1];
            const finalPotential = results['Potential Adopters'][results['Potential Adopters'].length - 1];
            const finalAdoptionRate = results.adopting[results.adopting.length - 1];

            // Expected values from PySD simulation at t=15
            // Market is nearly saturated - almost all potential adopters have adopted
            expect(finalAdoters).toBeCloseTo(999785, -2);  // ~999,785 adopters (99.98% of market)
            expect(finalPotential).toBeCloseTo(215, 0);     // ~215 potential adopters remaining
            expect(finalAdoptionRate).toBeCloseTo(322, 0);  // ~322 adopters/year (declining rate)

            // Total population should be conserved (1,000,000)
            const totalPopulation = finalAdoters + finalPotential;
            expect(totalPopulation).toBeCloseTo(1000000, -2);
        });

        test('should show S-curve inflection point in middle', async () => {
            const results = await simulator.simulate(['Adopters', 'adopting']);

            // Find the peak adoption rate (inflection point of S-curve)
            const maxRate = Math.max(...results.adopting);
            const maxIndex = results.adopting.indexOf(maxRate);
            const timeAtPeak = results.time[maxIndex];
            const adoptersAtPeak = results.Adopters[maxIndex];

            // Peak adoption should occur in the middle of the time range
            expect(timeAtPeak).toBeGreaterThan(3);   // After first 20% of simulation
            expect(timeAtPeak).toBeLessThan(12);     // Before last 20% of simulation

            // At peak adoption rate, roughly half the market should have adopted
            // (this is characteristic of S-curve diffusion)
            const percentAdopted = adoptersAtPeak / 1000000;
            expect(percentAdopted).toBeGreaterThan(0.3);  // At least 30%
            expect(percentAdopted).toBeLessThan(0.7);     // At most 70%
        });

        test('should show exponential growth in early phase', async () => {
            const results = await simulator.simulate(['Adopters']);

            // In early phase (first 5 years), growth should be exponential
            // Check if doubling time is relatively constant
            const early25Percent = Math.floor(results.time.length * 0.25);

            const adopters1 = results.Adopters[early25Percent];
            const adopters2 = results.Adopters[early25Percent * 2];

            // In exponential phase, doubling should occur
            // (characteristic of reinforcing feedback loop)
            expect(adopters2).toBeGreaterThan(adopters1 * 1.5);
        });
    });

    describe('Multiple simulations', () => {
        test('should handle multiple sequential simulations', async () => {
            const simulator = new PySDSimulator(armsRaceContent);

            const results1 = await simulator.simulate(['Our Weapons']);
            const results2 = await simulator.simulate(['Their Weapons']);

            expect(results1).toHaveProperty('Our Weapons');
            expect(results2).toHaveProperty('Their Weapons');
            expect(results1.time.length).toBe(results2.time.length);
        });

        test('should handle different models in parallel', async () => {
            const armsSimulator = new PySDSimulator(armsRaceContent);
            const bassSimulator = new PySDSimulator(bassDiffusionContent);

            const [armsResults, bassResults] = await Promise.all([
                armsSimulator.simulate(['Our Weapons']),
                bassSimulator.simulate(['Adopters'])
            ]);

            expect(armsResults).toHaveProperty('Our Weapons');
            expect(bassResults).toHaveProperty('Adopters');
        });
    });

    describe('Error handling', () => {
        test('should handle invalid XMILE content gracefully', async () => {
            const invalidXmile = '<xmile>invalid content</xmile>';
            const simulator = new PySDSimulator(invalidXmile);

            await expect(simulator.simulate(['test'])).rejects.toThrow();
        });

        test('should provide meaningful error message for missing variables', async () => {
            const simulator = new PySDSimulator(armsRaceContent);

            await expect(simulator.simulate(['InvalidVariable']))
                .rejects
                .toThrow(/Variable.*not found/i);
        });
    });

    describe('Data integrity', () => {
        test('should return consistent data types', async () => {
            const simulator = new PySDSimulator(armsRaceContent);
            const results = await simulator.simulate(['Our Weapons', 'Their Weapons']);

            // Check that all time values are numbers
            const allTimesAreNumbers = results.time.every(val => typeof val === 'number');
            expect(allTimesAreNumbers).toBe(true);

            // Check that all variable values are numbers
            const allOurWeaponsAreNumbers = results['Our Weapons'].every(val => typeof val === 'number');
            const allTheirWeaponsAreNumbers = results['Their Weapons'].every(val => typeof val === 'number');
            expect(allOurWeaponsAreNumbers).toBe(true);
            expect(allTheirWeaponsAreNumbers).toBe(true);
        });

        test('should return time in ascending order', async () => {
            const simulator = new PySDSimulator(bassDiffusionContent);
            const results = await simulator.simulate(['Adopters']);

            for (let i = 1; i < results.time.length; i++) {
                expect(results.time[i]).toBeGreaterThan(results.time[i - 1]);
            }
        });

        test('should not have NaN or Infinity values', async () => {
            const simulator = new PySDSimulator(bassDiffusionContent);
            const results = await simulator.simulate(['Adopters', 'Potential Adopters']);

            const hasInvalidValues = (arr) => arr.some(val => !isFinite(val));

            expect(hasInvalidValues(results.time)).toBe(false);
            expect(hasInvalidValues(results.Adopters)).toBe(false);
            expect(hasInvalidValues(results['Potential Adopters'])).toBe(false);
        });
    });
});
