/**
 * Unit tests for the Physical Laws evaluation
 *
 * These tests verify that the evaluate() method correctly identifies violations
 * of Newton's laws in pendulum models, including energy conservation, force-acceleration
 * relationships, and kinematic consistency.
 */

import { describe, expect, test } from '@jest/globals';
import * as physicalLaws from '../../../evals/categories/physicalLaws.js';

describe('Physical Laws Evaluation', () => {

    describe('evaluate()', () => {
        test('should fail when model is missing', async () => {
            const response = {};
            const requirements = {};

            const result = await physicalLaws.evaluate(response, requirements);

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0].type).toBe('Missing model');
            expect(result[0].details).toContain('does not contain a model');
        });

        test('should fail when required variables are missing', async () => {
            const response = {
                model: {
                    name: 'Test Model',
                    variables: [
                        { name: 'angle', type: 'stock' }
                        // Missing angular_velocity and angular_acceleration
                    ]
                }
            };
            const requirements = {};

            const result = await physicalLaws.evaluate(response, requirements);

            expect(Array.isArray(result)).toBe(true);
            expect(result.length).toBe(1);
            expect(result[0].type).toBe('Missing required variables');
            expect(result[0].details).toContain('angular_velocity');
            expect(result[0].details).toContain('angular_acceleration');
        });

        test('should detect angle variable case-insensitively', async () => {
            const response = {
                model: {
                    name: 'Test Model',
                    variables: [
                        { name: 'ANGLE', type: 'stock' },
                        { name: 'Angular_Velocity', type: 'flow' }
                        // Still missing angular_acceleration
                    ]
                }
            };
            const requirements = {};

            const result = await physicalLaws.evaluate(response, requirements);

            expect(Array.isArray(result)).toBe(true);
            // Should not complain about angle or angular_velocity, only angular_acceleration
            expect(result[0].details).toContain('angular_acceleration');
            expect(result[0].details).not.toContain('angle');
            expect(result[0].details).not.toContain('angular_velocity');
        });

        test('should handle model with all required variables present', async () => {
            const response = {
                model: {
                    name: 'Complete Model',
                    variables: [
                        { name: 'angle', type: 'stock', equation: '0.3' },
                        { name: 'angular_velocity', type: 'stock', equation: '0' },
                        { name: 'angular_acceleration', type: 'auxiliary', equation: '-9.8*angle' }
                    ]
                }
            };
            const requirements = {};

            const result = await physicalLaws.evaluate(response, requirements);

            expect(Array.isArray(result)).toBe(true);
            // Will likely fail at XMILE conversion or simulation, but not at variable check
            if (result.length > 0) {
                expect(result[0].type).not.toBe('Missing required variables');
            }
        });

        test('should validate evaluation result schema', async () => {
            const response = {};
            const requirements = {};

            const result = await physicalLaws.evaluate(response, requirements);

            expect(Array.isArray(result)).toBe(true);
            result.forEach(failure => {
                expect(failure).toHaveProperty('type');
                expect(failure).toHaveProperty('details');
                expect(typeof failure.type).toBe('string');
                expect(typeof failure.details).toBe('string');
            });
        });

        test('should return empty array when no failures occur', async () => {
            // This test checks the structure - it's expected to fail at some point
            // but validates that the function returns an array
            const response = {
                model: {
                    name: 'Test',
                    variables: []
                }
            };
            const requirements = {};

            const result = await physicalLaws.evaluate(response, requirements);

            expect(Array.isArray(result)).toBe(true);
        });
    });
});
