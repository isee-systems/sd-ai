import PySDSimulator from '../../evals/utilities/simulator/PySDSimulator.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('PySDSimulator', () => {
    let armsRaceContent;
    let bassDiffusionContent;
    const TIMEOUT = 5*60*1000;
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
        }, TIMEOUT);

        test('should throw error for empty content', () => {
            expect(() => new PySDSimulator('')).toThrow('xmileContent must be a non-empty string');
        }, TIMEOUT);

        test('should throw error for non-string content', () => {
            expect(() => new PySDSimulator(null)).toThrow('xmileContent must be a non-empty string');
            expect(() => new PySDSimulator(undefined)).toThrow('xmileContent must be a non-empty string');
            expect(() => new PySDSimulator(123)).toThrow('xmileContent must be a non-empty string');
        }, TIMEOUT);
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
        }, TIMEOUT);

        test('should return variables for bassDiffusion model', async () => {
            const simulator = new PySDSimulator(bassDiffusionContent);
            const variables = await simulator.getAvailableVariables();

            expect(Array.isArray(variables)).toBe(true);
            expect(variables.length).toBeGreaterThan(0);

            // Check for key variables in the bass diffusion model
            expect(variables).toContain('Adopters');
            expect(variables).toContain('Potential Adopters');
        }, TIMEOUT);
    });

    describe('simulate - armsRace model', () => {
        let simulator;

        beforeEach(() => {
            simulator = new PySDSimulator(armsRaceContent);
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
        }, TIMEOUT);

    });

    describe('simulate - bassDiffusion model', () => {
        let simulator;

        beforeEach(() => {
            simulator = new PySDSimulator(bassDiffusionContent);
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
        }, TIMEOUT);

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
});
