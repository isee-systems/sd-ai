/**
 * Integration tests for the AgentWorker.js IPC protocol.
 *
 * Spawns the actual worker process via fork and exercises the message
 * contract. Does NOT test AgentOrchestrator's agent loop (that requires
 * the Anthropic API); focuses on the IPC plumbing that routes messages
 * between the main process and the worker.
 */

import { fork } from 'child_process';
import { jest } from '@jest/globals';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, '../../agent/AgentWorker.js');

const TEST_SESSION_ID = 'sess_test_ipc_worker';

function makeTempDir() {
  const dir = join(tmpdir(), `agent-worker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function spawnWorker(tempDir, sessionId = TEST_SESSION_ID) {
  return fork(WORKER_PATH, [], {
    env: {
      ...process.env,
      SESSION_ID: sessionId,
      SESSION_TEMP_DIR: tempDir,
    },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
}

/**
 * Wait for the first IPC message from the worker that satisfies the predicate.
 */
function waitForMessage(worker, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`IPC message timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
    function handler(msg) {
      if (predicate(msg)) {
        clearTimeout(t);
        worker.off('message', handler);
        resolve(msg);
      }
    }
    worker.on('message', handler);
  });
}

/** Wait for the worker process to exit. */
function waitForExit(worker, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (worker.exitCode !== null) { resolve(worker.exitCode); return; }
    const t = setTimeout(() => reject(new Error('Worker exit timeout')), timeoutMs);
    worker.once('exit', (code) => { clearTimeout(t); resolve(code); });
  });
}

/** Send a minimal valid initialize message. */
function sendInit(worker, extras = {}) {
  worker.send({
    type: 'initialize',
    mode: 'cld',
    model: null,
    tools: [],
    context: {},
    conversationHistory: [],
    isAgentSwitch: false,
    ...extras,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe('AgentWorker IPC — get_context', () => {
  let worker;
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
    worker = spawnWorker(tempDir);
  });

  afterEach(() => {
    worker.kill('SIGKILL');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('responds to get_context even before initialize (returns empty array)', async () => {
    const requestId = 'req-before-init';
    worker.send({ type: 'get_context', requestId });

    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );

    expect(resp.context).toEqual([]);
  }, 10000);

  it('get_context returns conversation history loaded during initialize', async () => {
    const history = [
      { role: 'user', content: 'What is a stock?' },
      { role: 'assistant', content: 'A stock accumulates flows.' },
    ];

    sendInit(worker, { conversationHistory: history });

    const requestId = 'req-after-init';
    worker.send({ type: 'get_context', requestId });

    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );

    expect(resp.context).toEqual(history);
  }, 10000);

  it('multiple get_context calls return the same history', async () => {
    const history = [{ role: 'user', content: 'Hello' }];
    sendInit(worker, { conversationHistory: history });

    for (let i = 0; i < 3; i++) {
      const requestId = `req-${i}`;
      worker.send({ type: 'get_context', requestId });
      const resp = await waitForMessage(
        worker,
        (m) => m.type === 'context_response' && m.requestId === requestId
      );
      expect(resp.context).toEqual(history);
    }
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AgentWorker IPC — tool_response routing', () => {
  let worker;
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
    worker = spawnWorker(tempDir);
    sendInit(worker);
  });

  afterEach(() => {
    worker.kill('SIGKILL');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles unknown callId in tool_response without crashing', async () => {
    worker.send({
      type: 'tool_response',
      callId: 'call-totally-unknown',
      result: 'some result',
      isError: false,
    });

    // Worker should stay alive — verify it still responds to get_context
    const requestId = 'alive-check';
    worker.send({ type: 'get_context', requestId });
    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );
    expect(resp).toBeDefined();
  }, 10000);

  it('handles error-flagged tool_response with unknown callId without crashing', async () => {
    worker.send({
      type: 'tool_response',
      callId: 'call-error-unknown',
      result: 'it broke',
      isError: true,
    });

    const requestId = 'alive-check-2';
    worker.send({ type: 'get_context', requestId });
    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );
    expect(resp).toBeDefined();
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AgentWorker IPC — model_updated', () => {
  let worker;
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
    worker = spawnWorker(tempDir);
    sendInit(worker);
  });

  afterEach(() => {
    worker.kill('SIGKILL');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('model_updated does not crash the worker', async () => {
    worker.send({
      type: 'model_updated',
      model: { variables: [{ name: 'Population', type: 'stock' }] },
    });

    const requestId = 'alive-after-model';
    worker.send({ type: 'get_context', requestId });
    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );
    expect(resp).toBeDefined();
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AgentWorker IPC — shutdown', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits cleanly with code 0 on shutdown', async () => {
    const worker = spawnWorker(tempDir);
    sendInit(worker);

    // Confirm it's running first
    const requestId = 'pre-shutdown-check';
    worker.send({ type: 'get_context', requestId });
    await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );

    worker.send({ type: 'shutdown' });
    const code = await waitForExit(worker);
    expect(code).toBe(0);
  }, 10000);

  it('exits even without initialize', async () => {
    const worker = spawnWorker(tempDir);
    worker.send({ type: 'shutdown' });
    const code = await waitForExit(worker);
    expect(code).toBe(0);
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AgentWorker IPC — error handling', () => {
  let worker;
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
    worker = spawnWorker(tempDir);
  });

  afterEach(() => {
    worker.kill('SIGKILL');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sends worker_error on bad initialize (invalid mode)', async () => {
    worker.send({
      type: 'initialize',
      mode: 'INVALID_MODE',
      model: null,
      tools: [],
      context: {},
      conversationHistory: [],
      isAgentSwitch: false,
    });

    const errMsg = await waitForMessage(worker, (m) => m.type === 'worker_error');
    expect(errMsg.error).toBeDefined();
    expect(typeof errMsg.error).toBe('string');
  }, 10000);

  it('unknown message type does not crash the worker', async () => {
    sendInit(worker);
    worker.send({ type: 'this_does_not_exist', payload: 42 });

    // Worker should still respond to get_context
    const requestId = 'unknown-msg-check';
    worker.send({ type: 'get_context', requestId });
    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );
    expect(resp).toBeDefined();
  }, 10000);

  it('multiple sequential get_context requests have unique requestIds', async () => {
    sendInit(worker);

    const ids = ['r1', 'r2', 'r3'];
    const responses = await Promise.all(
      ids.map((requestId) => {
        worker.send({ type: 'get_context', requestId });
        return waitForMessage(
          worker,
          (m) => m.type === 'context_response' && m.requestId === requestId
        );
      })
    );

    expect(responses.map((r) => r.requestId)).toEqual(ids);
  }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AgentWorker IPC — isAgentSwitch flag', () => {
  let worker;
  let tempDir;

  beforeEach(() => {
    tempDir = makeTempDir();
    worker = spawnWorker(tempDir);
  });

  afterEach(() => {
    worker.kill('SIGKILL');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializing with isAgentSwitch=true still loads history correctly', async () => {
    const history = [
      { role: 'user', content: 'Prior question' },
      { role: 'assistant', content: 'Prior answer' },
    ];

    sendInit(worker, { conversationHistory: history, isAgentSwitch: true });

    const requestId = 'switch-context-check';
    worker.send({ type: 'get_context', requestId });
    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );

    expect(resp.context).toEqual(history);
  }, 10000);

  it('initializing with isAgentSwitch=false loads history correctly', async () => {
    const history = [{ role: 'user', content: 'Fresh session question' }];

    sendInit(worker, { conversationHistory: history, isAgentSwitch: false });

    const requestId = 'no-switch-context-check';
    worker.send({ type: 'get_context', requestId });
    const resp = await waitForMessage(
      worker,
      (m) => m.type === 'context_response' && m.requestId === requestId
    );

    expect(resp.context).toEqual(history);
  }, 10000);
});
