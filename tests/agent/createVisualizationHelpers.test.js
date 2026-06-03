import { isRunKeyedFormat, extractRunFeedback } from '../../agent/tools/builtin/createVisualization.js';

describe('isRunKeyedFormat', () => {
  it('returns true for run-keyed variable data', () => {
    const data = {
      run_abc: { time: [0, 1], Population: [1000, 1020] },
      run_def: { time: [0, 1], Population: [1000, 980] }
    };
    expect(isRunKeyedFormat(data)).toBe(true);
  });

  it('returns true for single run', () => {
    expect(isRunKeyedFormat({ run_abc: { time: [0, 1], Population: [1000, 1020] } })).toBe(true);
  });

  it('returns false for flat format (has time key at top level)', () => {
    expect(isRunKeyedFormat({ time: [0, 1], Population: [1000, 1020] })).toBe(false);
  });

  it('returns false for feedback format (has feedbackContent key)', () => {
    expect(isRunKeyedFormat({ feedbackContent: {} })).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isRunKeyedFormat({})).toBe(false);
  });

  it('returns false when run values are not objects with a time array', () => {
    expect(isRunKeyedFormat({ run_abc: [1000, 1020] })).toBe(false);
  });
});

describe('extractRunFeedback', () => {
  const flatFeedback = { feedbackLoops: [{ identifier: 'R1' }], dominantLoopsByPeriod: [] };

  it('returns flat feedbackContent unchanged', () => {
    expect(extractRunFeedback(flatFeedback)).toBe(flatFeedback);
  });

  it('returns the preferred run when specified', () => {
    const content = {
      run_abc: { feedbackLoops: [{ identifier: 'R1' }] },
      run_def: { feedbackLoops: [{ identifier: 'R2' }] }
    };
    expect(extractRunFeedback(content, 'run_def')).toBe(content.run_def);
  });

  it('falls back to last run when preferredRunId is absent', () => {
    const content = {
      run_abc: { feedbackLoops: [{ identifier: 'R1' }] },
      run_def: { feedbackLoops: [{ identifier: 'R2' }] }
    };
    expect(extractRunFeedback(content)).toBe(content.run_def);
  });

  it('falls back to last run when preferredRunId is not in content', () => {
    const content = {
      run_abc: { feedbackLoops: [] },
      run_def: { feedbackLoops: [] }
    };
    expect(extractRunFeedback(content, 'run_missing')).toBe(content.run_def);
  });

  it('returns input unchanged for null/undefined', () => {
    expect(extractRunFeedback(null)).toBe(null);
    expect(extractRunFeedback(undefined)).toBe(undefined);
  });
});
