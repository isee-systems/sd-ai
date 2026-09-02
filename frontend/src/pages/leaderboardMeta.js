/**
 * Board titles and copy, shared by the leaderboard index and the per-board page.
 *
 * `blurb` is the one-line version for the index cards. `description` is the board's page
 * lead-in, and `categoryNotes` says what each column of that board's grid measures, keyed
 * by the category id the results carry. The page lists them in the grid's own order and
 * links each to its test, so a reader can carry a column heading straight to the line that
 * explains it and from there to the eval itself. `note` is for anything true of the board
 * rather than of one column.
 *
 * They live together so the two pages cannot disagree about what a board is, and beside
 * the boards themselves so a category added to `evals/categories` has one obvious place
 * to be described.
 */

export const leaderboardConfig = {
  cld: {
    blurb:
      'Turning plain English into causal loop diagrams: link and loop translation, extending a diagram that already exists, instruction conformance, and causal reasoning about real-world systems.',
    title: 'Causal Loop Diagrams',
    description:
      'Each column measures one thing an engine has to get right when it turns a description into a causal loop diagram.',
    categoryNotes: {
      conformance:
        'Instruction-following in open-ended real-world contexts — whether the diagram includes the variables the user named, and honors limits on how many variables and feedback loops it may contain.',
      qualitativeCausalReasoning:
        'Whether a diagram built for a real domain contains the variables and causal mechanisms domain experts consider essential.',
      qualitativeIteration:
        'Adding the relationships asked for to a diagram that already exists, without disturbing the structure already there.',
      qualitativeTranslation:
        'Extracting every causal link, with the right polarity, from single sentences, single feedback loops and sets of overlapping loops — set in a synthetic “gibberish” universe of invented variable names, so nothing can be answered from training data.',
    },
    note:
      'The qualitative-zero “engine” is the control on this board: a plain, non-prompt-engineered LLM run against the same tests.',
  },
  sfd: {
    blurb:
      'Building stock-and-flow models that actually simulate: translation and iteration, modular structure, behavioral patterns, physical laws, error fixing, conformance and documentation.',
    title: 'Stock & Flow Diagrams',
    description:
      'Each column measures one thing an engine has to get right when it builds a stock-and-flow model that simulates.',
    categoryNotes: {
      behavioralPattern:
        'Building a model that produces a named behavior over time — exponential growth or decay, logistic growth or decay, sustained oscillation — with the simulated output classified against the target.',
      conformance:
        'Instruction-following: whether the model includes the variables the user named, and honors limits on how many variables and feedback loops it may contain.',
      physicalLaws:
        'Models of pendulums, spring-mass systems and gases, checked against the physics they are meant to obey.',
      quantitativeCausalReasoning:
        'Whether a model built for a real domain carries the stocks, flows and causal mechanisms domain experts consider essential.',
      quantitativeErrorFixing:
        'Repairing a model that contains known formulation errors, and explaining what was wrong and why.',
      quantitativeIteration:
        'Extending a stock-and-flow model that already exists without breaking the structure already there.',
      quantitativeModularModification:
        'Restructuring a model on request: making a flat model modular, flattening a modular one, and adding or removing modules and relationships.',
      quantitativeModularReasoning:
        'Whether a model built for a real domain carries the expected modules, and connects them through valid cross-module relationships.',
      quantitativeModularTranslation:
        'The same translation task where the structure has to be split across modules, with both intra-module and cross-module processes.',
      quantitativeTranslation:
        'Recovering fixed, proportional and interdependent flows from a written description, set in a synthetic “gibberish” universe of invented variable names.',
      simulationCompletion:
        'The most basic property of all: that the model integrates to the end of its own time horizon instead of failing in the simulator.',
      variableDocumentation:
        'Whether every variable comes back documented, with an LLM judge rejecting documentation that merely restates the variable’s name.',
    },
  },
  discussion: {
    blurb:
      'Talking about models rather than building them: explaining feedback loops, laying out model-building steps, setting the model boundary, suggesting fixes, and guiding a novice to policy leverage.',
    title: 'Discussion',
    description:
      'Each column measures one thing an engine has to get right when it talks about a model rather than building one.',
    categoryNotes: {
      errorFixingSuggestions:
        'Identifying and explaining the formulation errors in a model it is shown — where the stock-and-flow board’s error fixing test demands a repaired model back.',
      feedbackExplanation:
        'Explaining the loops in an existing model in a way that carries the specific facts an expert would expect to hear.',
      modelBuildingSteps:
        'Laying out the sequence of steps to build a model from a problem statement and background knowledge, judged against a ground-truth sequence.',
      modelScoping:
        'The boundary decision: given a list of candidate mechanisms — some genuinely in-boundary, the rest plausible-sounding distractors — saying which belong in a model of this problem and which do not.',
      policyGuidance:
        'Tutoring a novice: handed a complete model that behaves badly, bringing them to the leverage points through guiding questions tied to the model’s feedback structure, rather than simply naming a fix.',
    },
  },
};

/** The order the boards are presented in, everywhere. */
export const LEADERBOARD_ORDER = ['sfd', 'cld', 'discussion'];
