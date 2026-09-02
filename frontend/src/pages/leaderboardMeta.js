/**
 * Board titles and copy, shared by the leaderboard index and the per-board page.
 *
 * `blurb` is the one-line version for the index cards; `description` is the full text the
 * board's own page carries. They live together so the two pages cannot disagree about
 * what a board is.
 */

export const leaderboardConfig = {
  cld: {
    blurb:
      'Turning plain English into causal graphs: link and loop translation, instruction conformance, and causal reasoning about real-world situations.',
    title: 'Causal Loop Diagrams',
    description:
      'The leaderboard showcases engines\' performance across three tests: causal-translation, which evaluates an engine\'s ability to convert plain English into structured causal graphs by identifying links and loops within synthetic gibberish-based ground truths, conformance, which assesses how well the engine follows user instructions by generating models with the correct variables and specified feedback loops in open-ended real-world contexts, and qualitative causal reasoning which checks how wee an engine can identify causal struture within real world situations. Each engine\'s results display its individual scores on all three tests, an overall combined score reflecting total performance, and a speed ranking to highlight how efficiently it completed the evaluations. The qualitative-zero "engine" attempts to measure how a default "non-prompt engineered" LLM performs on these same tasks.',
  },
  sfd: {
    blurb:
      'Building simulating stock-and-flow models: quantitative translation, causal reasoning, error fixing, physical laws and modular structure.',
    title: 'Stock & Flow Diagrams',
    description:
      'The leaderboard showcases engines\' performance across two tests: quantitative-causal-translation, which tests the engine\'s ability to translate quantitative stock-and-flow model descriptions with gibberish variables into simulating models by identifying causal relationships involving fixed, proportional, and interdependent flows; and quantitative-causal-reasoning, which measures the engine\'s capacity to generate simulating stock and flow models in complex contexts by evaluating its outputs against key expert-specified concepts. Each engine\'s results display its individual scores on all four tests, an overall combined score reflecting total performance, and a speed ranking that highlights how efficiently it completed the evaluations. This comprehensive leaderboard enables direct comparison of accuracy, reasoning, and execution speed to drive improvements in modeling capability and efficiency.',
  },
  discussion: {
    blurb:
      'Talking about models: explaining feedback loops, articulating model-building steps, and suggesting fixes for broken models.',
    title: 'Discussion',
    description:
      'The leaderboard evaluates engines\' ability to engage in meaningful discussion about models. It tests performance across three key areas: feedback explanation, which measures how well engines can explain the purpose and behavior of feedback loops in models; model building steps, which assesses the engine\'s ability to articulate the reasoning and steps involved in constructing models; and error fixing suggestions, which evaluates how effectively engines can identify issues in models and propose actionable fixes. Each engine\'s results display its individual scores on all three tests, an overall combined score reflecting total performance, and a speed ranking to highlight efficiency.',
  },
};

/** The order the boards are presented in, everywhere. */
export const LEADERBOARD_ORDER = ['sfd', 'cld', 'discussion'];
