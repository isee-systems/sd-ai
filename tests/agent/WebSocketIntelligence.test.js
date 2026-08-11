/**
 * The session-level half of intelligence levels: what the WebSocket handler remembers
 * between messages, and what it refuses to do too often.
 *
 * The resolution rules themselves are covered in intelligenceLevels.test.js. What can
 * only be tested here is the handler's *state* — that a level set on a live session
 * survives the next select_agent, and that applying one is rate-limited — because both
 * are properties of the sequence of messages rather than of any one of them.
 *
 * WorkerSpawner is mocked, as in WebSocketAuthGate.test.js: these tests assert on what
 * the handler sends the worker, not on anything the worker does.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

const fakeWorkers = [];
function makeFakeWorker() {
  const worker = new EventEmitter();
  worker.connected = true;
  worker.send = jest.fn();
  worker.kill = jest.fn();
  worker.pid = undefined;
  fakeWorkers.push(worker);
  return worker;
}

class FakeSandboxUnavailableError extends Error {}

jest.unstable_mockModule('../../agent/WorkerSpawner.js', () => ({
  WorkerSpawner: {
    CONTAINER_SESSION_PATH: '/session',
    spawn: jest.fn(async () => makeFakeWorker()),
  },
  SandboxUnavailableError: FakeSandboxUnavailableError,
}));

const { WebSocketHandler } = await import('../../agent/WebSocket.js');
const { SessionManager } = await import('../../agent/utilities/SessionManager.js');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 1;
    this.sent = [];
    this.closed = null;
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  async receive(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
    await new Promise(resolve => setImmediate(resolve));
  }

  messagesOfType(type) {
    return this.sent.filter(m => m.type === type);
  }
}

describe('WebSocket intelligence handling', () => {
  let sessionManager;
  let ws;

  beforeEach(async () => {
    process.env.AUTHENTICATION_KEY = 'the-key';
    sessionManager = new SessionManager({ disableCleanup: true });
    ws = new FakeWebSocket();
    new WebSocketHandler(ws, sessionManager);
    await new Promise(resolve => setImmediate(resolve));
    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'the-key',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });
  });

  afterEach(() => {
    delete process.env.AUTHENTICATION_KEY;
    sessionManager.shutdown();
    fakeWorkers.length = 0;
  });

  function sessionId() {
    return ws.sent.find(m => m.type === 'session_created').sessionId;
  }

  async function selectAgent(extra = {}) {
    await ws.receive({ type: 'select_agent', sessionId: sessionId(), agentId: 'socrates', ...extra });
  }

  async function setIntelligence(intelligence) {
    await ws.receive({ type: 'set_intelligence', sessionId: sessionId(), intelligence });
  }

  // What the worker was last told the level is, across every worker this session used.
  function lastLevelSentToWorker() {
    const sends = fakeWorkers.flatMap(w => w.send.mock.calls.map(([m]) => m));
    const relevant = sends.filter(m => m?.type === 'select_agent' || m?.type === 'set_intelligence');
    return relevant.at(-1)?.intelligence;
  }

  it('applies a level chosen on select_agent', async () => {
    await selectAgent({ provider: 'anthropic', intelligence: 'high' });

    expect(ws.messagesOfType('agent_selected')[0].currentIntelligence).toBe('high');
    expect(lastLevelSentToWorker()).toBe('high');
  });

  it('keeps a set_intelligence level across a later select_agent that omits it', async () => {
    // The bug this guards: select_agent is sent for reasons unrelated to the level (an
    // agent switch), and resolving an absent field to the provider default silently
    // undid whatever the user had chosen.
    await selectAgent({ provider: 'anthropic' });
    await setIntelligence('maximum');
    expect(ws.messagesOfType('intelligence_changed')[0].currentIntelligence).toBe('maximum');

    await selectAgent({ provider: 'anthropic' });

    expect(ws.messagesOfType('agent_selected').at(-1).currentIntelligence).toBe('maximum');
    expect(lastLevelSentToWorker()).toBe('maximum');
  });

  it('still honours an explicit level on a later select_agent', async () => {
    await selectAgent({ provider: 'anthropic' });
    await setIntelligence('maximum');

    await selectAgent({ provider: 'anthropic', intelligence: 'standard' });

    expect(ws.messagesOfType('agent_selected').at(-1).currentIntelligence).toBe('standard');
  });

  it('resets to the new provider default when the provider changes', async () => {
    // Level ids are per provider, so carrying one across a provider switch would be
    // carrying a value the new ladder may not even define.
    await selectAgent({ provider: 'anthropic' });
    await setIntelligence('maximum');

    await selectAgent({ provider: 'google' });

    expect(ws.messagesOfType('agent_selected').at(-1).currentIntelligence).toBe('standard');
  });

  it('rate-limits applied changes and answers with the level still in effect', async () => {
    await selectAgent({ provider: 'anthropic', intelligence: 'standard' });

    await setIntelligence('high');       // first change: applied
    await setIntelligence('maximum');    // inside the cooldown: not applied

    const replies = ws.messagesOfType('intelligence_changed');
    expect(replies[0].currentIntelligence).toBe('high');
    // The truth, not what was asked for — which is what the client is told to display.
    expect(replies[1].currentIntelligence).toBe('high');
    expect(lastLevelSentToWorker()).toBe('high');
  });

  it('does not consume the cooldown on a request that changes nothing', async () => {
    await selectAgent({ provider: 'anthropic', intelligence: 'standard' });

    await setIntelligence('standard');   // no-op, must not start the cooldown
    await setIntelligence('high');       // therefore still the first real change

    expect(ws.messagesOfType('intelligence_changed').at(-1).currentIntelligence).toBe('high');
    expect(lastLevelSentToWorker()).toBe('high');
  });

  it('refuses set_intelligence before an agent is selected', async () => {
    // A level is meaningless without a provider to resolve it against.
    await setIntelligence('high');

    expect(ws.messagesOfType('error').at(-1).errorCode).toBe('NO_AGENT');
    expect(ws.messagesOfType('intelligence_changed')).toHaveLength(0);
  });
});
