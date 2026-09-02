/**
 * Chart parameters for the leaderboard views.
 *
 * Scores and costs are magnitudes, so they get a sequential ramp: one hue, more-is-darker.
 * The two engine families on the cost chart are an identity distinction, so they get the
 * first two categorical slots — the only place on these pages where hue means "which",
 * not "how much".
 *
 * Colours are the validated defaults; the ramp is quoted at the steps it is sampled at
 * rather than inlined at the call sites, so re-theming is one edit here.
 */

/** Blue, light -> dark. Step 100 recedes toward the surface, which is what "near zero" wants. */
export const SEQUENTIAL_BLUE = [
  [0.0, '#cde2fb'],
  [0.25, '#86b6ef'],
  [0.5, '#3987e5'],
  [0.75, '#256abf'],
  [1.0, '#0d366b'],
];

/**
 * Where a cell's fill gets dark enough that ink has to flip to white. The ramp crosses
 * into "dark" around the 0.5 step (#3987e5), so that is the threshold.
 */
export const INK_FLIP_AT = 0.5;

/** Categorical slots 1 and 2 — used only to tell the engine families apart. */
export const CATEGORICAL = ['#2a78d6', '#eb6834'];

/** Chart chrome, so axes and gridlines stay recessive against the page. */
export const CHROME = {
  gridline: '#e1e0d9',
  axis: '#c3c2b7',
  muted: '#898781',
  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
};

export const CHART_FONT = { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', size: 12 };

/** Turn `quantitativeCausalReasoning` into `Quantitative Causal Reasoning`. */
export const camelCaseToWords = (s) => {
  const spaced = s.replace(/([A-Z])/g, ' $1');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * Category labels wrap rather than truncate on the heatmap axis: a dozen of them across
 * the width leaves no room for one line, and a truncated label is a label you have to
 * hover to read.
 */
export const wrapLabel = (s, perLine = 14) => {
  const words = camelCaseToWords(s).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > perLine) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('<br>');
};

/**
 * The ramp step nearest a 0..1 value, with the ink colour that stays legible on it.
 * Discrete steps rather than a smooth blend: in a table the exact number is already
 * printed in the cell, so the fill only has to make a column scannable, and banding does
 * that more clearly than a gradient.
 */
export function rampStep(value) {
  let nearest = SEQUENTIAL_BLUE[0];
  for (const stop of SEQUENTIAL_BLUE) {
    if (Math.abs(stop[0] - value) < Math.abs(nearest[0] - value)) nearest = stop;
  }
  return {
    bg: nearest[1],
    fg: nearest[0] >= INK_FLIP_AT ? '#ffffff' : CHROME.textPrimary,
  };
}
