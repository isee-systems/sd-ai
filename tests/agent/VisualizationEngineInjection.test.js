/**
 * Regression guard: Python code injection in the visualization templates.
 *
 * The five template generators used to build Python by dropping values into
 * single-quoted literals — `ax.set_title('${options.title}')` and about a dozen
 * siblings. Every one of those values (title, timeUnits, seriesUnits, variable
 * names, highlight-period labels and colors) is typed `z.string()` on the
 * create_visualization tool, so the model picks it, so a prompt injection
 * reaching the model picks it. A title of `x'); import os; os.system(...); ('`
 * closed the literal and ran as code in the process executing the script.
 *
 * The fix passes those values as JSON the script loads at runtime, so a string
 * cannot become a statement. These tests assert the property directly: the
 * generated source must contain no caller-supplied text at all, and the only
 * interpolated values must be the three server-generated paths.
 *
 * The rendering half (that each chart type still draws with these values) needs
 * python3 + matplotlib, so it is skipped where they are unavailable.
 */

import { describe, it, expect, afterAll } from '@jest/globals';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VisualizationEngine } from '../../agent/utilities/VisualizationEngine.js';

// Closes the Python string literal, runs code, reopens it — the classic shape.
const MARKER_NAME = 'INJECTION_MARKER';

const hasMatplotlib = () =>
  spawnSync('python3', ['-c', 'import matplotlib'], { encoding: 'utf8' }).status === 0;

// Built at module scope, not in beforeAll: `it.each(cases())` is evaluated
// during collection, which runs before any hook. Assigning the payload in a
// hook would hand every case `undefined` and the suite would pass vacuously.
const tempDir = mkdtempSync(join(tmpdir(), 'viz-injection-'));
const EVIL = `x'); import os; open(${JSON.stringify(join(tempDir, MARKER_NAME))}, 'w').write('x'); ('`;

const engine = new VisualizationEngine(
  { getSessionTempDir: () => tempDir, getSession: () => ({ clientId: 'test-client' }) },
  'sess_injection_test'
);

const TIME = [0, 1, 2, 3, 4, 5];
const FLAT = { time: TIME, Population: [1, 2, 3, 4, 5, 6], GDP: [2, 4, 6, 8, 10, 12] };
const RUN_KEYED = {
  run1: { time: TIME, Population: [1, 2, 3, 4, 5, 6] },
  run2: { time: TIME, Population: [2, 3, 4, 5, 6, 7] },
  run3: { time: TIME, Population: [0, 2, 5, 6, 7, 9] },
};
const LOOPS = { time: TIME, R1: [10, 20, 30, 40, 50, 60], B1: [90, 80, 70, 60, 50, 40] };

// Every chart type, each with the payload in every string-typed option it reads.
function cases() {
  const base = {
    title: EVIL,
    timeUnits: EVIL,
    seriesUnits: { Population: EVIL, GDP: EVIL, R1: EVIL, B1: EVIL },
    width: 800,
    height: 600,
  };

  return [
    ['time_series', FLAT, ['Population', 'GDP'], {
      ...base,
      timeRange: { start: 1, end: 4 },
      highlightPeriods: [{ start: 1, end: 2, label: EVIL, color: '#ff0000' }],
    }],
    ['phase_portrait', FLAT, ['Population', 'GDP'], base],
    ['feedback_dominance', LOOPS, ['R1', 'B1'], {
      ...base,
      highlightPeriods: [{ startTime: 1, endTime: 3, label: EVIL, color: 'yellow', loopIds: ['R1'] }],
    }],
    ['comparison', RUN_KEYED, ['Population'], { ...base, timeRange: { start: 0, end: 5 } }],
    ['confidence_interval', RUN_KEYED, ['Population'], { ...base, confidenceIntervals: [50, 95] }],
  ];
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('generated Python contains no caller-supplied text', () => {
  it.each(cases())('%s', (type, data, variables, options) => {
    const { script, params } = engine.generatePythonVisualizationScript(
      type,
      join(tempDir, 'data.json'),
      join(tempDir, 'out.svg'),
      join(tempDir, 'params.json'),
      variables,
      options
    );

    // The payload must not appear in the source at all — not escaped, not
    // partially stripped, not present.
    expect(script).not.toContain(EVIL);
    expect(script).not.toContain('import os');
    expect(script).not.toContain(MARKER_NAME);

    // It must still be carried, as data, so the chart is actually labelled with
    // what the caller asked for. A fix that silently dropped the value would
    // pass the assertions above.
    expect(JSON.stringify(params)).toContain(MARKER_NAME);
  });

  it('keeps a legitimate apostrophe intact rather than mangling it', () => {
    // The value that would break a naive escape-by-stripping fix.
    const { script, params } = engine.generatePythonVisualizationScript(
      'time_series',
      join(tempDir, 'data.json'),
      join(tempDir, 'out.svg'),
      join(tempDir, 'params.json'),
      ['Population'],
      { title: "Q3 'Growth' Report", timeUnits: 'Years', seriesUnits: { Population: 'People' } }
    );

    expect(params.title).toBe("Q3 'Growth' Report");
    expect(script).not.toContain("Q3 'Growth' Report");
  });

  it('only interpolates the three server-generated paths', () => {
    const dataPath = join(tempDir, 'data.json');
    const outputPath = join(tempDir, 'out.svg');
    const paramsPath = join(tempDir, 'params.json');

    const { script } = engine.generatePythonVisualizationScript(
      'time_series', dataPath, outputPath, paramsPath, ['Population'],
      { title: EVIL, timeUnits: EVIL, seriesUnits: {} }
    );

    // Every single-quoted literal in the script must be one of the three paths
    // or a plain identifier-ish constant — never caller text.
    const literals = [...script.matchAll(/'([^'\n]*)'/g)].map(m => m[1]);
    const suspicious = literals.filter(literal =>
      literal.includes(';') || literal.includes('import ') || literal.includes(MARKER_NAME)
    );

    expect(suspicious).toEqual([]);
    expect(script).toContain(`open('${paramsPath}'`);
  });
});

const describeIfPython = hasMatplotlib() ? describe : describe.skip;

describeIfPython('the templates still render with hostile values', () => {
  it.each(cases())('%s renders and executes nothing', async (type, data, variables, options) => {
    const svg = await engine.createVisualizationWithPython(type, data, variables, options);

    expect(svg).toMatch(/<svg|<\?xml/);
    expect(existsSync(join(tempDir, MARKER_NAME))).toBe(false);
  }, 120000);
});
