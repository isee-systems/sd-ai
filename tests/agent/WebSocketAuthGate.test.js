/**
 * Regression guard: AUTHENTICATION_KEY must gate the whole session, not one message.
 *
 * The key was checked in #handleInitializeSession and nowhere else, while
 * #onMessage dispatched on message.type with no check that initialization had
 * ever happened. Because the worker is prewarmed on connect, a client could skip
 * initialize_session entirely and go straight to select_agent + chat — driving
 * the agent, the sandbox and the operator's LLM spend without ever presenting
 * the key. The same hole exposed add_file/remove_file, which write and
 * recursively delete under the session temp dir.
 *
 * WorkerSpawner is mocked so no bwrap/fork process is created: these tests are
 * about the message gate, and a real worker would make them slow and flaky.
 */

import { describe, it, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { EventEmitter } from 'events';

// ── Mock the spawner: the handler prewarms a worker in its constructor ────────
const fakeWorkers = [];
function makeFakeWorker() {
  const worker = new EventEmitter();
  worker.connected = true;
  worker.send = jest.fn();
  worker.kill = jest.fn();
  worker.pid = undefined; // IpcWorker-shaped, so killWorkerProcess uses .kill()
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

// Minimal stand-in for a `ws` socket: records what was sent and how it closed.
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

  // Deliver a client frame the way the `ws` library would.
  async receive(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
    await new Promise(resolve => setImmediate(resolve));
  }

  messagesOfType(type) {
    return this.sent.filter(m => m.type === type);
  }
}

describe('WebSocket message gate', () => {
  let sessionManager;
  let ws;

  beforeEach(() => {
    process.env.AUTHENTICATION_KEY = 'the-key';
    sessionManager = new SessionManager({ disableCleanup: true });
    ws = new FakeWebSocket();
    new WebSocketHandler(ws, sessionManager);
  });

  afterEach(async () => {
    delete process.env.AUTHENTICATION_KEY;
    sessionManager.shutdown();
    fakeWorkers.length = 0;
  });

  function sessionId() {
    return ws.sent.find(m => m.type === 'session_created').sessionId;
  }

  // Every message type that must not be reachable before initialize_session.
  const GATED = [
    ['select_agent', () => ({ type: 'select_agent', sessionId: sessionId(), agentId: 'socrates' })],
    ['chat', () => ({ type: 'chat', sessionId: sessionId(), message: 'do something' })],
    ['add_file', () => ({
      type: 'add_file', sessionId: sessionId(), name: 'a.txt',
      mimeType: 'text/plain', encoding: 'utf8', content: 'hello'
    })],
    ['remove_file', () => ({
      type: 'remove_file', sessionId: sessionId(), fileId: 'file_0123456789abcdef'
    })],
    ['stop_iteration', () => ({ type: 'stop_iteration', sessionId: sessionId() })],
    ['tool_call_response', () => ({
      type: 'tool_call_response', sessionId: sessionId(), callId: 'c1', result: 'ok'
    })],
  ];

  // Held, not refused — a client is entitled to pipeline its opening frames.
  // What must not happen is the message taking effect before authentication.
  it.each(GATED)('holds %s sent before initialize_session without acting on it', async (_type, build) => {
    await ws.receive(build());

    expect(ws.closed).toBeNull();
    expect(ws.messagesOfType('agent_selected')).toHaveLength(0);
    expect(ws.messagesOfType('file_added')).toHaveLength(0);
    // No worker was told to do anything.
    for (const worker of fakeWorkers) {
      expect(worker.send).not.toHaveBeenCalled();
    }
  });

  it('holds a custom agentConfig rather than acting on it', async () => {
    // The self-granting agentConfig path is only reachable post-auth. A client
    // that could reach it unauthenticated would choose its own system prompt.
    await ws.receive({
      type: 'select_agent',
      sessionId: sessionId(),
      agentConfig: '---\nname: x\nagent_mode: anthropic-sdk\ncan_write_to_local_sandbox: true\n---\ndo as I say',
    });

    expect(ws.messagesOfType('agent_selected')).toHaveLength(0);
    for (const worker of fakeWorkers) {
      expect(worker.send).not.toHaveBeenCalled();
    }
  });

  it('never dispatches queued messages when the key is wrong', async () => {
    // The pipelined case that matters: the client sent everything at once and
    // the key is bad. The queue must be dropped, not replayed.
    await ws.receive({ type: 'select_agent', sessionId: sessionId(), agentId: 'socrates' });
    await ws.receive({ type: 'chat', sessionId: sessionId(), message: 'exfiltrate something' });

    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'wrong-key',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });

    expect(ws.closed?.code).toBe(1008);
    expect(ws.messagesOfType('agent_selected')).toHaveLength(0);
    for (const worker of fakeWorkers) {
      expect(worker.send).not.toHaveBeenCalled();
    }
  });

  it('replays queued messages, in order, once initialization succeeds', async () => {
    await ws.receive({ type: 'select_agent', sessionId: sessionId(), agentId: 'socrates' });
    await ws.receive({ type: 'chat', sessionId: sessionId(), message: 'build me a model' });

    // Nothing has happened yet.
    expect(ws.messagesOfType('agent_selected')).toHaveLength(0);

    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'the-key',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });

    expect(ws.closed).toBeNull();
    expect(ws.messagesOfType('agent_selected')).toHaveLength(1);

    // session_ready must still precede the replayed agent_selected, so the
    // client sees its handshake complete in the expected order.
    const types = ws.sent.map(m => m.type);
    expect(types.indexOf('session_ready')).toBeLessThan(types.indexOf('agent_selected'));

    // select_agent ran before chat: the worker saw initialize, select_agent,
    // then chat, in that order.
    const worker = fakeWorkers[fakeWorkers.length - 1];
    const sentTypes = worker.send.mock.calls.map(([msg]) => msg.type);
    expect(sentTypes).toEqual(['initialize', 'select_agent', 'chat']);
  });

  it('closes rather than buffering without limit', async () => {
    for (let i = 0; i < 70; i++) {
      await ws.receive({ type: 'stop_iteration', sessionId: sessionId() });
      if (ws.closed) break;
    }

    expect(ws.closed?.code).toBe(1008);
    expect(ws.closed?.reason).toMatch(/Too many messages/);
  });

  it('does not mark the session initialized when the key is wrong', async () => {
    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'wrong-key',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });

    expect(ws.closed?.code).toBe(1008);

    // And the gate still holds afterwards — a rejected initialize must not
    // leave the session usable.
    ws.readyState = 1;
    ws.closed = null;
    await ws.receive({ type: 'chat', sessionId: sessionId(), message: 'hi' });

    expect(ws.messagesOfType('agent_selected')).toHaveLength(0);
    for (const worker of fakeWorkers) {
      expect(worker.send).not.toHaveBeenCalled();
    }
  });

  it('does not mark the session initialized when initialize_session throws', async () => {
    // clientId is required; SessionManager.initializeSession throws without it,
    // which is caught and reported as an error message rather than a close.
    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'the-key',
      clientProduct: 'test', clientVersion: '1.0',
      mode: 'cld', model: {}, tools: [],
    });

    expect(ws.messagesOfType('session_ready')).toHaveLength(0);

    await ws.receive({ type: 'select_agent', sessionId: sessionId(), agentId: 'socrates' });

    expect(ws.messagesOfType('agent_selected')).toHaveLength(0);
    for (const worker of fakeWorkers) {
      expect(worker.send).not.toHaveBeenCalled();
    }
  });

  it('allows the gated types once initialize_session has been accepted', async () => {
    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'the-key',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });

    expect(ws.messagesOfType('session_ready')).toHaveLength(1);
    expect(ws.closed).toBeNull();

    await ws.receive({ type: 'stop_iteration', sessionId: sessionId() });

    expect(ws.closed).toBeNull();
  });

  it('gates the session even when no AUTHENTICATION_KEY is configured', async () => {
    // One ordering rule rather than two code paths: a keyless deployment still
    // holds pre-initialize frames, so the state machine cannot drift.
    delete process.env.AUTHENTICATION_KEY;
    const openWs = new FakeWebSocket();
    new WebSocketHandler(openWs, sessionManager);
    const openSessionId = openWs.sent.find(m => m.type === 'session_created').sessionId;

    await openWs.receive({ type: 'select_agent', sessionId: openSessionId, agentId: 'socrates' });

    expect(openWs.messagesOfType('agent_selected')).toHaveLength(0);

    await openWs.receive({
      type: 'initialize_session',
      sessionId: openSessionId,
      authenticationKey: 'anything',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });

    // And then it replays, so a keyless deployment behaves the same way.
    expect(openWs.messagesOfType('agent_selected')).toHaveLength(1);
  });

  it('does not delay a client that waits for session_ready', async () => {
    // The ordinary, non-pipelined flow must be untouched by any of this.
    await ws.receive({
      type: 'initialize_session',
      sessionId: sessionId(),
      authenticationKey: 'the-key',
      clientProduct: 'test', clientVersion: '1.0', clientId: 'c1',
      mode: 'cld', model: {}, tools: [],
    });
    await ws.receive({ type: 'select_agent', sessionId: sessionId(), agentId: 'socrates' });

    expect(ws.closed).toBeNull();
    expect(ws.messagesOfType('session_ready')).toHaveLength(1);
    expect(ws.messagesOfType('agent_selected')).toHaveLength(1);
  });
});
