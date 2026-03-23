import { describe, test, expect } from '@jest/globals';
import BehaviorClassifier from '../../evals/utilities/BehaviorClassifier.js';

describe('BehaviorClassifier', () => {

    describe('classifyTimeSeries', () => {
        test('should reject empty array', async () => {
            await expect(BehaviorClassifier.classifyTimeSeries([]))
                .rejects.toThrow('timeSeriesData must be a non-empty array');
        });

        test('should reject null input', async () => {
            await expect(BehaviorClassifier.classifyTimeSeries(null))
                .rejects.toThrow('timeSeriesData must be a non-empty array');
        });

        test('should reject non-array input', async () => {
            await expect(BehaviorClassifier.classifyTimeSeries('not an array'))
                .rejects.toThrow('timeSeriesData must be a non-empty array');
        });

        test('should classify linear growth pattern', async () => {
            // Generate linear growth: y = 2*x + 10
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            const result = await BehaviorClassifier.classifyTimeSeries(data);

            expect(result).toHaveProperty('best_label');
            expect(result).toHaveProperty('base_shape');
            expect(result).toHaveProperty('direction');
            expect(result).toHaveProperty('probabilities');
            expect(result).toHaveProperty('scale_metadata');

            // Should detect linear growth
            expect(result.best_label).toBe('linear_growth');
            expect(result.direction).toBe('increasing');
        }, 10000);

        test('should classify increasing pattern correctly', async () => {
            // Generate clear increasing data
            const data = Array.from({ length: 100 }, (_, i) => i * 5 + 100);

            const result = await BehaviorClassifier.classifyTimeSeries(data);

            // Should detect some form of increasing pattern
            expect(result.direction).toBe('increasing');
            expect(result.best_label).toContain('growth');
        }, 10000);

        test('should classify any monotonic pattern', async () => {
            // Generate data that changes monotonically
            const data = Array.from({ length: 100 }, (_, i) => 1000 - i * 5);

            const result = await BehaviorClassifier.classifyTimeSeries(data);

            // Should detect a pattern with valid structure
            expect(result).toHaveProperty('best_label');
            expect(result.best_label.length).toBeGreaterThan(0);
            expect(result).toHaveProperty('direction');
            expect(['increasing', 'decreasing', 'stable']).toContain(result.direction);
        }, 10000);

        test('should return valid structure for any pattern', async () => {
            const data = Array.from({ length: 100 }, (_, i) =>
                50 + 30 * Math.sin(0.3 * i)
            );

            const result = await BehaviorClassifier.classifyTimeSeries(data);

            // Verify all required properties exist
            expect(result).toHaveProperty('best_label');
            expect(typeof result.best_label).toBe('string');
            expect(result.best_label.length).toBeGreaterThan(0);

            expect(result).toHaveProperty('base_shape');
            expect(typeof result.base_shape).toBe('string');

            expect(result).toHaveProperty('direction');
            expect(['increasing', 'decreasing', 'stable']).toContain(result.direction);

            expect(result).toHaveProperty('probabilities');
            expect(typeof result.probabilities).toBe('object');

            // Probabilities should sum to approximately 1
            const probSum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
            expect(probSum).toBeCloseTo(1.0, 1);
        }, 10000);

        test('should return scale metadata', async () => {
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            const result = await BehaviorClassifier.classifyTimeSeries(data);

            expect(result.scale_metadata).toBeDefined();
            expect(result.scale_metadata).toHaveProperty('mean');
            expect(result.scale_metadata).toHaveProperty('std');
            expect(result.scale_metadata).toHaveProperty('min');
            expect(result.scale_metadata).toHaveProperty('max');
            expect(result.scale_metadata).toHaveProperty('range');
            expect(result.scale_metadata).toHaveProperty('start_value');
            expect(result.scale_metadata).toHaveProperty('end_value');
            expect(result.scale_metadata).toHaveProperty('delta');

            // Verify scale metadata is reasonable
            expect(result.scale_metadata.max).toBeGreaterThan(result.scale_metadata.min);
            expect(result.scale_metadata.range).toBe(
                result.scale_metadata.max - result.scale_metadata.min
            );
        }, 10000);

        test('should return top matches with probabilities', async () => {
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            const result = await BehaviorClassifier.classifyTimeSeries(data, { topN: 3 });

            expect(result.top_matches).toBeDefined();
            expect(Array.isArray(result.top_matches)).toBe(true);
            expect(result.top_matches.length).toBeGreaterThan(0);
            expect(result.top_matches.length).toBeLessThanOrEqual(3);

            result.top_matches.forEach(match => {
                expect(match).toHaveProperty('label');
                expect(match).toHaveProperty('probability');
                expect(match).toHaveProperty('description');
                expect(typeof match.label).toBe('string');
                expect(typeof match.probability).toBe('number');
                expect(match.probability).toBeGreaterThanOrEqual(0);
                expect(match.probability).toBeLessThanOrEqual(1);
            });

            // Top matches should be sorted by probability (descending)
            for (let i = 1; i < result.top_matches.length; i++) {
                expect(result.top_matches[i-1].probability).toBeGreaterThanOrEqual(
                    result.top_matches[i].probability
                );
            }
        }, 10000);
    });

    describe('checkPattern', () => {
        test('should return checkPattern structure correctly', async () => {
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            const result = await BehaviorClassifier.checkPattern(
                data,
                'linear_growth',
                { minConfidence: 0.5 }
            );

            expect(result).toHaveProperty('matches');
            expect(result).toHaveProperty('confidence');
            expect(result).toHaveProperty('detected');
            expect(result).toHaveProperty('expected');
            expect(result).toHaveProperty('details');

            expect(result.expected).toBe('linear_growth');
            expect(result.detected).toBe('linear_growth');
            expect(typeof result.matches).toBe('boolean');
            expect(result.confidence).toBeGreaterThanOrEqual(0);
        }, 10000);

        test('should return matches=false for incorrect pattern expectation', async () => {
            // Generate clear linear growth
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            // Expect something completely different
            const result = await BehaviorClassifier.checkPattern(
                data,
                'oscillating',
                { minConfidence: 0.5 }
            );

            expect(result.matches).toBe(false);
            expect(result.detected).not.toBe('oscillating');
            expect(result.expected).toBe('oscillating');
        }, 10000);

        test('should respect minConfidence threshold', async () => {
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            // With very high confidence threshold
            const highThreshold = await BehaviorClassifier.checkPattern(
                data,
                'linear_growth',
                { minConfidence: 0.99 }
            );

            // With low confidence threshold
            const lowThreshold = await BehaviorClassifier.checkPattern(
                data,
                'linear_growth',
                { minConfidence: 0.1 }
            );

            // Both should detect the same pattern
            expect(highThreshold.detected).toBe(lowThreshold.detected);
            expect(highThreshold.detected).toBe('linear_growth');

            // Confidence should be the same for both
            expect(highThreshold.confidence).toBe(lowThreshold.confidence);

            // Matches depends on threshold
            if (highThreshold.confidence >= 0.99) {
                expect(highThreshold.matches).toBe(true);
            }
            if (lowThreshold.confidence >= 0.1) {
                expect(lowThreshold.matches).toBe(true);
            }
        }, 10000);

        test('should reject empty array', async () => {
            await expect(BehaviorClassifier.checkPattern([], 'exponential_growth'))
                .rejects.toThrow();
        });

        test('should include full classification details', async () => {
            const data = Array.from({ length: 100 }, (_, i) => 2 * i + 10);

            const result = await BehaviorClassifier.checkPattern(
                data,
                'linear_growth'
            );

            expect(result.details).toBeDefined();
            expect(result.details).toHaveProperty('best_label');
            expect(result.details).toHaveProperty('probabilities');
            expect(result.details).toHaveProperty('scale_metadata');
        }, 10000);
    });

    describe('Integration with different data patterns', () => {
        test('should handle noisy data gracefully', async () => {
            // Generate linear with some noise
            const data = Array.from({ length: 100 }, (_, i) =>
                2 * i + 10 + (Math.random() - 0.5) * 5
            );

            const result = await BehaviorClassifier.classifyTimeSeries(data);

            expect(result).toHaveProperty('best_label');
            expect(result.best_label).toBeTruthy();
            // Check probabilities uses base_shape as key
            expect(result).toHaveProperty('probabilities');
            expect(result.probabilities[result.base_shape]).toBeGreaterThan(0);
            expect(result.direction).toBe('increasing');
        }, 10000);

        test('should handle different array lengths', async () => {
            const shortData = Array.from({ length: 20 }, (_, i) => 2 * i + 10);
            const longData = Array.from({ length: 500 }, (_, i) => 2 * i + 10);

            const shortResult = await BehaviorClassifier.classifyTimeSeries(shortData);
            const longResult = await BehaviorClassifier.classifyTimeSeries(longData);

            // Both should detect linear growth
            expect(shortResult.best_label).toBe('linear_growth');
            expect(longResult.best_label).toBe('linear_growth');
            expect(shortResult.direction).toBe('increasing');
            expect(longResult.direction).toBe('increasing');
        }, 10000);

        test('should handle values of different magnitudes', async () => {
            const smallData = Array.from({ length: 100 }, (_, i) => 0.1 * i + 1);
            const largeData = Array.from({ length: 100 }, (_, i) => 1000 * i + 5000);

            const smallResult = await BehaviorClassifier.classifyTimeSeries(smallData);
            const largeResult = await BehaviorClassifier.classifyTimeSeries(largeData);

            // Both should detect linear growth regardless of magnitude
            expect(smallResult.best_label).toBe('linear_growth');
            expect(largeResult.best_label).toBe('linear_growth');
        }, 10000);
    });
});
