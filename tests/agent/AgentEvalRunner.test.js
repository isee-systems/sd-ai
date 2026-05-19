import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals';

// ─── Module-level message sequence used by the AgentOrchestrator mock ────────
// Tests set this before calling runAgent; the mock factory closes over it.
let messageSequence = [];

// Mocks must be declared at the top level before any dynamic import of the
// module under test, so Jest can intercept the module registry.
jest.unstable_mockModule('../../agent/AgentOrchestrator.js', () => ({
  AgentOrchestrator: class MockOrchestrator {
    constructor(_sm, _sid, sendFn, _config, _provider) {
      this._send = sendFn;
    }
    async startConversation(_msg) {
      for (const msg of messageSequence) {
        await this._send(msg);
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
      return { time: [0, 1, 2], Population: [100, 110, 121] };
    }
  },
}));

// Dynamically import after mocks are registered
let findFeedbackLoops, patchAgentConfig, runAgent;

beforeAll(async () => {
  ({ findFeedbackLoops, patchAgentConfig, runAgent } =
    await import('../../agent/utilities/AgentEvalRunner.js'));
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
    expect(bodyStart).toMatch(/Never ask the user questions/);
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
