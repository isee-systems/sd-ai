import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// ─── Module-level message sequence used by the AgentOrchestrator mock ────────
// Tests set this before calling runAgent; the mock factory closes over it.
let messageSequence = [];
// Every message runAgent sent this run, in order, plus the constructor args. A run can take
// more than one turn now (the harness corrects an agent that never wrote a model), so the
// composed prompt is userMessages[0] rather than whatever arrived last.
let userMessages = [];
let lastConstructorArgs = null;
// What the harness resolved each pending request with, keyed by requestId.
let resolvedPayloads = new Map();
// Set by a test to make the simulator mock fail the way PySD does.
let simulatorError = null;

// Mocks must be declared at the top level before any dynamic import of the
// module under test, so Jest can intercept the module registry.
jest.unstable_mockModule('../../agent/AgentOrchestrator.js', () => ({
  AgentOrchestrator: class MockOrchestrator {
    constructor(sessionManager, sessionId, sendFn, _config, provider, intelligence, toolModels) {
      this._sessionManager = sessionManager;
      this._sessionId = sessionId;
      this._send = sendFn;
      lastConstructorArgs = { provider, intelligence, toolModels };
    }

    // Stand in for a real tool: register the pending resolver, send, and record what the
    // harness resolved it with. Without this the runner's replies go nowhere and a test can
    // only prove the run didn't hang — not what the agent was actually told.
    async startConversation(msg) {
      userMessages.push(msg);
      for (const outbound of messageSequence) {
        const session = this._sessionManager.getSession(this._sessionId);
        const pendingMap = outbound.type === 'feedback_request'
          ? (session.pendingFeedbackRequests ||= new Map())
          : (session.pendingModelRequests ||= new Map());

        let settled = null;
        if (outbound.requestId) {
          settled = new Promise((resolve) => {
            pendingMap.set(outbound.requestId, {
              timeout: setTimeout(() => {}, 0),
              resolve: (value) => { resolvedPayloads.set(outbound.requestId, value); resolve(value); },
              reject: resolve,
            });
          });
        }

        await this._send(outbound);
        if (settled) {
          const value = await settled;
          // The real update_model/get_current_model tools push the echoed model into the
          // session after it resolves. Skipping that here would leave the session model
          // empty no matter what the agent wrote.
          if (outbound.type === 'update_model' || outbound.type === 'get_current_model') {
            this._sessionManager.updateClientModel(this._sessionId, value);
          }
        }
      }
    }
  },
}));

jest.unstable_mockModule('../../utilities/SDJsonToXMILE.js', () => ({
  default: () => '<xml/>',
}));

jest.unstable_mockModule('../../evals/utilities/simulator/PySDSimulator.js', () => ({
  default: class MockSimulator {
    async simulate() {
      if (simulatorError) throw new Error(simulatorError);
      return { time: [0, 1, 2], Population: [100, 110, 121] };
    }
  },
}));

// Dynamically import after mocks are registered
let findFeedbackLoops, patchAgentConfig, runAgent;
let validateModelLikeClient, modelIsEmpty, summarizeSimulationError;

beforeAll(async () => {
  ({ findFeedbackLoops, patchAgentConfig, runAgent,
     validateModelLikeClient, modelIsEmpty, summarizeSimulationError } =
    await import('../../agent/utilities/AgentEvalRunner.js'));
});

beforeEach(() => {
  resolvedPayloads = new Map();
  simulatorError = null;
});

// ─── findFeedbackLoops ───────────────────────────────────────────────────────

describe('findFeedbackLoops', () => {
  test('returns empty array for null/undefined relationships', () => {
    expect(findFeedbackLoops(null)).toEqual([]);
    expect(findFeedbackLoops(undefined)).toEqual([]);
    expect(findFeedbackLoops([])).toEqual([]);
  });

  test('returns empty array for a DAG (no cycles)', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '+' },
      { from: 'B', to: 'C', polarity: '+' },
    ];
    expect(findFeedbackLoops(rels)).toEqual([]);
  });

  test('detects a simple 2-node reinforcing loop (both +)', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '+' },
      { from: 'B', to: 'A', polarity: '+' },
    ];
    const loops = findFeedbackLoops(rels);
    expect(loops).toHaveLength(1);
    expect(loops[0].polarity).toBe('+');
    expect(loops[0].identifier).toBe('L1');
  });

  test('detects a simple 2-node balancing loop (one - polarity)', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '+' },
      { from: 'B', to: 'A', polarity: '-' },
    ];
    const loops = findFeedbackLoops(rels);
    expect(loops).toHaveLength(1);
    expect(loops[0].polarity).toBe('-');
  });

  test('two negative links → reinforcing (even negatives)', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '-' },
      { from: 'B', to: 'A', polarity: '-' },
    ];
    const loops = findFeedbackLoops(rels);
    expect(loops[0].polarity).toBe('+');
  });

  test('3-node cycle — correct link structure', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '+' },
      { from: 'B', to: 'C', polarity: '+' },
      { from: 'C', to: 'A', polarity: '-' },
    ];
    const loops = findFeedbackLoops(rels);
    expect(loops).toHaveLength(1);
    expect(loops[0].links).toHaveLength(3);
    expect(loops[0].polarity).toBe('-');

    const fromNodes = loops[0].links.map(l => l.from).sort();
    expect(fromNodes).toEqual(['A', 'B', 'C']);
  });

  test('two independent cycles are both detected', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '+' },
      { from: 'B', to: 'A', polarity: '+' },
      { from: 'C', to: 'D', polarity: '-' },
      { from: 'D', to: 'C', polarity: '+' },
    ];
    const loops = findFeedbackLoops(rels);
    expect(loops).toHaveLength(2);
  });

  test('defaults missing polarity to "+"', () => {
    const rels = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'A' },
    ];
    const loops = findFeedbackLoops(rels);
    expect(loops[0].polarity).toBe('+');
    expect(loops[0].links.every(l => l.polarity === '+')).toBe(true);
  });

  test('loop identifiers are sequential L1, L2, ...', () => {
    const rels = [
      { from: 'A', to: 'B', polarity: '+' },
      { from: 'B', to: 'A', polarity: '+' },
      { from: 'C', to: 'D', polarity: '+' },
      { from: 'D', to: 'C', polarity: '+' },
    ];
    const loops = findFeedbackLoops(rels);
    const ids = loops.map(l => l.identifier).sort();
    expect(ids).toEqual(['L1', 'L2']);
  });

  test('each loop link connects consecutive nodes and closes back to start', () => {
    const rels = [
      { from: 'X', to: 'Y', polarity: '+' },
      { from: 'Y', to: 'X', polarity: '-' },
    ];
    const [loop] = findFeedbackLoops(rels);
    const nodes = loop.links.map(l => l.from);
    const targets = loop.links.map(l => l.to);
    for (let i = 0; i < nodes.length; i++) {
      expect(targets[i]).toBe(nodes[(i + 1) % nodes.length]);
    }
  });
});

// ─── patchAgentConfig ────────────────────────────────────────────────────────

const SAMPLE_MD = `---
name: "TestAgent"
agent_mode: manual
max_iterations: 10
supported_modes:
  - sfd
supported_providers:
  - anthropic
---

## Instructions
Do things.
`;

describe('patchAgentConfig', () => {
  test('replaces max_iterations with 9999', () => {
    const result = patchAgentConfig(SAMPLE_MD);
    expect(result).toMatch(/^max_iterations: 9999$/m);
    expect(result).not.toMatch(/^max_iterations: 10$/m);
  });

  test('replaces agent_mode when agentMode is provided', () => {
    const result = patchAgentConfig(SAMPLE_MD, 'sdk');
    expect(result).toMatch(/^agent_mode: sdk$/m);
    expect(result).not.toMatch(/^agent_mode: manual$/m);
  });

  test('does not touch agent_mode when agentMode is omitted', () => {
    const result = patchAgentConfig(SAMPLE_MD);
    expect(result).toMatch(/^agent_mode: manual$/m);
  });

  test('appends EVAL MODE instruction block after closing ---', () => {
    const result = patchAgentConfig(SAMPLE_MD);
    const frontmatterEnd = result.indexOf('\n---\n');
    expect(frontmatterEnd).toBeGreaterThan(-1);
    const bodyStart = result.slice(frontmatterEnd + 5);
    expect(bodyStart).toMatch(/EVAL MODE/);
    expect(bodyStart).toMatch(/Never block or stop to wait for input/);
    // The rule is about waiting, not rhetoric: a discussion eval can ask for guiding
    // questions, and an instruction reading "never ask questions" made the agent answer
    // every one of its own prompts and fail the rubric it was being scored against.
    expect(bodyStart).toMatch(/questions to a learner/);
  });

  test('EVAL MODE instruction comes before original body content', () => {
    const result = patchAgentConfig(SAMPLE_MD);
    const evalIdx = result.indexOf('EVAL MODE');
    const doThingsIdx = result.indexOf('Do things.');
    expect(evalIdx).toBeLessThan(doThingsIdx);
  });

  test('appends EVAL MODE at end when no frontmatter separator exists', () => {
    const noFrontmatter = 'Just some markdown content without frontmatter.';
    const result = patchAgentConfig(noFrontmatter);
    expect(result).toMatch(/EVAL MODE/);
    expect(result).toContain('Just some markdown content without frontmatter.');
  });

  test('handles markdown with no max_iterations line gracefully', () => {
    const md = `---\nname: "X"\nagent_mode: sdk\nsupported_modes:\n  - sfd\nsupported_providers:\n  - anthropic\n---\n## Body\n`;
    const result = patchAgentConfig(md, 'manual');
    expect(result).toMatch(/^agent_mode: manual$/m);
    expect(result).toMatch(/EVAL MODE/);
  });
});

// ─── sendToClient mock handler ───────────────────────────────────────────────

describe('sendToClient mock handler', () => {
  beforeEach(() => {
    messageSequence = [];
  });

  const baseParams = {
    agentName: 'merlin',
    agentMode: 'sdk',
    provider: 'anthropic',
    mode: 'sfd',
  };

  const currentModel = {
    variables: [{ name: 'Population', type: 'stock', equation: '100' }],
    relationships: [],
  };

  test('agent_complete resolves runAgent and returns collected text', async () => {
    messageSequence = [
      { type: 'agent_text', isThinking: false, content: 'Hello' },
      { type: 'agent_text', isThinking: false, content: ' world' },
      { type: 'agent_complete', status: 'done' },
    ];

    const result = await runAgent('test prompt', currentModel, baseParams);
    expect(result.explanation).toBe('Hello\n\n world');
  });

  test('agent_text with isThinking:true is excluded from explanation', async () => {
    messageSequence = [
      { type: 'agent_text', isThinking: true, content: 'internal thought' },
      { type: 'agent_text', isThinking: false, content: 'visible response' },
      { type: 'agent_complete', status: 'done' },
    ];

    const result = await runAgent('test prompt', currentModel, baseParams);
    expect(result.explanation).not.toContain('internal thought');
    expect(result.explanation).toContain('visible response');
  });

  test('update_model resolves without error and lastModel comes from SessionManager', async () => {
    messageSequence = [
      { type: 'update_model', requestId: 'r1', modelData: { variables: [], relationships: [] } },
      { type: 'agent_complete', status: 'done' },
    ];

    const result = await runAgent('test prompt', currentModel, baseParams);
    // In real usage the tool calls sessionManager.updateClientModel() after resolution;
    // here we verify runAgent completes and lastModel is whatever the session holds.
    expect(result.lastModel).toBeDefined();
  });

  test('error message rejects runAgent with an Error', async () => {
    messageSequence = [
      { type: 'error', error: 'Something broke' },
    ];

    await expect(runAgent('test prompt', currentModel, baseParams))
      .rejects.toThrow('Something broke');
  });

  test('error with no message text uses fallback "Agent error"', async () => {
    messageSequence = [
      { type: 'error' },
    ];

    await expect(runAgent('test prompt', currentModel, baseParams))
      .rejects.toThrow('Agent error');
  });

  test('feedback_request resolves using pre-computed feedbackContent', async () => {
    const preComputed = {
      feedbackLoops: [{ identifier: 'L1', name: 'Loop 1', links: [], polarity: '+' }],
    };
    messageSequence = [
      { type: 'feedback_request', requestId: 'fr1', runIds: ['run-1'] },
      { type: 'agent_complete', status: 'done' },
    ];

    const params = { ...baseParams, feedbackContent: preComputed };
    await expect(runAgent('test prompt', currentModel, params)).resolves.toBeDefined();
  });

  test('feedback_request falls back to DFS when no feedbackContent provided', async () => {
    const modelWithLoop = {
      variables: [{ name: 'A' }, { name: 'B' }],
      relationships: [
        { from: 'A', to: 'B', polarity: '+' },
        { from: 'B', to: 'A', polarity: '+' },
      ],
    };
    messageSequence = [
      { type: 'feedback_request', requestId: 'fr2', runIds: [] },
      { type: 'agent_complete', status: 'done' },
    ];

    await expect(runAgent('test prompt', modelWithLoop, baseParams)).resolves.toBeDefined();
  });

  test('get_current_model resolves with the initial model', async () => {
    let resolvedModel;
    messageSequence = [
      { type: 'get_current_model', requestId: 'gcm1' },
      { type: 'agent_complete', status: 'done' },
    ];

    // Just verify it doesn't hang (no timeout) — the session resolves the pending request
    await expect(runAgent('test prompt', currentModel, baseParams)).resolves.toBeDefined();
  });
});

// ─── composed user message ───────────────────────────────────────────────────

describe('the message runAgent composes', () => {
  beforeEach(() => {
    messageSequence = [{ type: 'agent_complete', status: 'ok' }];
    userMessages = [];
    lastConstructorArgs = null;
  });

  test('carries the naming rule whenever background knowledge is supplied', async () => {
    // Regression guard for a real leaderboard failure: given background prose like
    // "the baseline inventory shows twenty frimbulators", the agent named the stock
    // "Inventory" and put "frimbulators" in the units. The ground truth matcher is
    // containment-based, so a name carrying none of the term matches nothing and the
    // test scored zero while the same model passed as a plain engine. The rule below is
    // what tells the agent the term belongs in the NAME; losing it silently reintroduces
    // that failure across every gibberish-variable test.
    await runAgent('build me a model', { variables: [], relationships: [] }, {
      agentName: 'merlin',
      provider: 'anthropic',
      mode: 'sfd',
      backgroundKnowledge: 'the baseline inventory shows twenty frimbulators',
    });

    expect(userMessages[0]).toContain('the baseline inventory shows twenty frimbulators');
    expect(userMessages[0]).toContain('NAMING RULE');
    expect(userMessages[0]).toMatch(/MUST appear in the NAME/);
    expect(userMessages[0]).toMatch(/never a substitute/);
  });

  test('omits the background section entirely when none is supplied', async () => {
    await runAgent('build me a model', { variables: [], relationships: [] }, {
      agentName: 'merlin',
      provider: 'anthropic',
      mode: 'sfd',
    });

    expect(userMessages[0]).toBe('build me a model');
    expect(userMessages[0]).not.toContain('NAMING RULE');
  });

  test('passes intelligence and toolModels through to the orchestrator', async () => {
    // The experiment files drive both of these; a silent drop would run every agent row
    // on the provider default model with the shared config tool lane instead.
    const toolModels = { build: { normal: 'm', hard: 'm' }, nonBuild: { normal: 'm', hard: 'm' } };
    await runAgent('build me a model', { variables: [], relationships: [] }, {
      agentName: 'merlin',
      provider: 'anthropic',
      intelligence: 'maximum',
      toolModels,
      mode: 'sfd',
    });

    expect(lastConstructorArgs).toEqual({ provider: 'anthropic', intelligence: 'maximum', toolModels });
  });
});

// ─── client-fidelity behaviours ──────────────────────────────────────────────
// Everything below exists because the harness used to answer the agent with an
// unconditional success. A model whose relationships named variables that did not exist,
// and a simulation that never ran, both came back indistinguishable from the real thing,
// so the agent had nothing to correct and the leaderboard scored the wreckage.

describe('validateModelLikeClient', () => {
  test('passes a model whose references all resolve', () => {
    expect(validateModelLikeClient({
      variables: [
        { name: 'Population', type: 'stock', inflows: ['Births'] },
        { name: 'Births', type: 'flow' },
      ],
      relationships: [{ from: 'Births', to: 'Population', polarity: '+' }],
    })).toEqual([]);
  });

  test('names the drift when a reference resolves only after folding', () => {
    // The exact shape that cost merlin-sfd-sonnet-5 the American Revolution conformance
    // test: 29 variables named with spaces, 24 relationship endpoints named with
    // underscores, and a conformance eval that counted 27 distinct variables.
    const errors = validateModelLikeClient({
      variables: [{ name: 'Colonial Identity' }, { name: 'Hostilities' }],
      relationships: [{ from: 'Colonial_Identity', to: 'Hostilities', polarity: '+' }],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Colonial_Identity');
    expect(errors[0]).toContain('Colonial Identity');
    expect(errors[0]).toMatch(/spaces and underscores are not interchangeable/);
  });

  test('reports a reference to a variable that does not exist at all', () => {
    const errors = validateModelLikeClient({
      variables: [{ name: 'Population', type: 'stock', inflows: ['Births'] }],
      relationships: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Stock "Population" lists inflow refers to "Births"/);
    expect(errors[0]).toMatch(/not a variable in this model/);
  });

  test('reports two variables whose names differ only by spacing', () => {
    const errors = validateModelLikeClient({
      variables: [{ name: 'colonial identity' }, { name: 'colonial_identity' }],
      relationships: [],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Duplicate variable names/);
  });

  test('stays quiet about relationship endpoints when no variables are declared', () => {
    // A relationships-only model is a shape engines legitimately return; flagging every
    // endpoint there would bury the real findings in noise.
    expect(validateModelLikeClient({
      variables: [],
      relationships: [{ from: 'A', to: 'B', polarity: '+' }],
    })).toEqual([]);
  });
});

describe('summarizeSimulationError', () => {
  test('drops the PySD parse tree and keeps the offending expression', () => {
    const err = new Error(
      'Failed to load XMILE model: KeyError: 3\n\nParse tree:\n<Node called "call" matching "MIN(Developers*Productivity, Work_To_Be_Done/TIME STEP)">' +
      '\n  <Node called "reference">'.repeat(400)
    );
    const summary = summarizeSimulationError(err);

    expect(summary).toContain('Failed to load XMILE model: KeyError: 3');
    expect(summary).not.toContain('Parse tree:');
    expect(summary.length).toBeLessThan(700);
  });
});

describe('modelIsEmpty', () => {
  test('is true for the model a session starts with when nothing was handed in', () => {
    expect(modelIsEmpty({ variables: [], relationships: [] })).toBe(true);
    expect(modelIsEmpty(null)).toBe(true);
  });

  test('is false as soon as the model holds anything', () => {
    expect(modelIsEmpty({ variables: [{ name: 'A' }], relationships: [] })).toBe(false);
    expect(modelIsEmpty({ variables: [], relationships: [{ from: 'A', to: 'B' }] })).toBe(false);
  });
});

describe('what the harness tells the agent', () => {
  const baseParams = {
    agentName: 'merlin',
    agentMode: 'sdk',
    provider: 'anthropic',
    mode: 'sfd',
  };

  test('a model echoed back carries the client errors it earned', async () => {
    messageSequence = [
      {
        type: 'update_model',
        requestId: 'um1',
        modelData: {
          variables: [{ name: 'Colonial Identity' }, { name: 'Hostilities' }],
          relationships: [{ from: 'Colonial_Identity', to: 'Hostilities', polarity: '+' }],
        },
      },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('test prompt', { variables: [], relationships: [] }, baseParams);

    const echoed = resolvedPayloads.get('um1');
    expect(echoed.errors).toHaveLength(1);
    expect(echoed.errors[0]).toContain('Colonial_Identity');
  });

  test('a clean model is echoed back with no errors key at all', async () => {
    messageSequence = [
      {
        type: 'update_model',
        requestId: 'um2',
        modelData: {
          variables: [{ name: 'Population', type: 'stock' }],
          relationships: [],
        },
      },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('test prompt', { variables: [], relationships: [] }, baseParams);

    expect(resolvedPayloads.get('um2')).not.toHaveProperty('errors');
  });

  test('a stale errors array read back off the session model is replaced, not repeated', async () => {
    messageSequence = [
      {
        type: 'update_model',
        requestId: 'um3',
        modelData: {
          errors: ['Relationship from refers to "Gone", which is not a variable in this model.'],
          variables: [{ name: 'Population', type: 'stock' }],
          relationships: [],
        },
      },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('test prompt', { variables: [], relationships: [] }, baseParams);

    expect(resolvedPayloads.get('um3')).not.toHaveProperty('errors');
  });

  test('a failed simulation says so, with the reason', async () => {
    simulatorError = 'Failed to load XMILE model: KeyError: 3\n\nParse tree:\n<Node ...>';
    messageSequence = [
      { type: 'run_model', requestId: 'rm1' },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('test prompt', {
      variables: [{ name: 'Population', type: 'stock', equation: '100' }],
      relationships: [],
    }, baseParams);

    const runResult = resolvedPayloads.get('rm1');
    expect(runResult.simulated).toBe(false);
    expect(runResult.error).toContain('KeyError: 3');
    expect(runResult.error).not.toContain('Parse tree:');
  });

  test('a successful simulation reports itself as simulated and carries no error', async () => {
    messageSequence = [
      { type: 'run_model', requestId: 'rm2' },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('test prompt', {
      variables: [{ name: 'Population', type: 'stock', equation: '100' }],
      relationships: [],
    }, baseParams);

    expect(resolvedPayloads.get('rm2')).toEqual({ runId: 'eval-run-1', simulated: true });
  });

  test('asking for data from a failed run returns the reason, not an empty series', async () => {
    simulatorError = 'Failed to load XMILE model: dt';
    messageSequence = [
      { type: 'run_model', requestId: 'rm3' },
      { type: 'get_variable_data', requestId: 'gvd1', variableNames: ['Population'], runIds: ['eval-run-failed-1'] },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('test prompt', {
      variables: [{ name: 'Population', type: 'stock', equation: '100' }],
      relationships: [],
    }, baseParams);

    expect(resolvedPayloads.get('gvd1')['eval-run-failed-1'].error).toContain('dt');
  });

  test('harness progress notices are kept out of the graded answer', async () => {
    // Only some provider loops emit these. Left in, an engine's answer would differ by
    // which loop happened to run it — 93 of merlin-sfd-gemini's 93 explanations carried
    // them, and none of the Anthropic SDK ones did.
    messageSequence = [
      { type: 'agent_text', isThinking: false, isProgress: true, content: 'Running model simulation...' },
      { type: 'agent_text', isThinking: false, content: 'The oscillation comes from the workforce loop.' },
      { type: 'agent_complete', status: 'done' },
    ];

    const result = await runAgent('test prompt', {
      variables: [{ name: 'Workforce', type: 'stock', equation: '10' }],
      relationships: [],
    }, baseParams);

    expect(result.explanation).toBe('The oscillation comes from the workforce loop.');
  });
});

describe('the correction sent when no model was written', () => {
  const baseParams = {
    agentName: 'merlin',
    agentMode: 'sdk',
    provider: 'anthropic',
    mode: 'cld',
  };

  beforeEach(() => {
    userMessages = [];
  });

  test('a build run that ends empty gets one correction', async () => {
    // merlin-cld-sonnet-5 answered three qualitativeTranslation tests correctly in prose
    // in under 11 seconds each, never called update_model, and scored zero on all three.
    messageSequence = [{ type: 'agent_complete', status: 'done' }];

    await runAgent('extract the feedback loops', { variables: [], relationships: [] }, baseParams);

    expect(userMessages).toHaveLength(2);
    expect(userMessages[1]).toMatch(/Your answer never reached the model/);
    expect(userMessages[1]).toMatch(/call update_model/);
  });

  test('no correction once the agent has written something', async () => {
    messageSequence = [
      {
        type: 'update_model',
        requestId: 'um4',
        modelData: { variables: [{ name: 'A' }], relationships: [] },
      },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('extract the feedback loops', { variables: [], relationships: [] }, baseParams);

    expect(userMessages).toHaveLength(1);
  });

  test('no correction when a model was handed in and returned unchanged', async () => {
    // An iteration test that comes back untouched is a wrong answer, not a forfeit, and
    // the score should say so rather than paying for another turn.
    messageSequence = [{ type: 'agent_complete', status: 'done' }];

    await runAgent('add a stock', {
      variables: [{ name: 'Population', type: 'stock', equation: '100' }],
      relationships: [],
    }, { ...baseParams, mode: 'sfd' });

    expect(userMessages).toHaveLength(1);
  });

  test('no correction in discussion mode, where there is no model to write', async () => {
    messageSequence = [
      { type: 'agent_text', isThinking: false, content: 'Here is the explanation.' },
      { type: 'agent_complete', status: 'done' },
    ];

    await runAgent('explain the behaviour', { variables: [], relationships: [] },
      { ...baseParams, mode: 'cld-discuss' });

    expect(userMessages).toHaveLength(1);
  });
});
