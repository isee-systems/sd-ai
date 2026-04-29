/**
 * Tests for agent/WorkerSpawner.js
 *
 * Covers:
 *  - WorkerSpawner.CONTAINER_SESSION_PATH value
 *  - WorkerSpawner.spawn returns a live ChildProcess with an IPC channel
 *  - The spawned process terminates cleanly when sent SIGKILL
 *  - SessionManager.createSessionWithId (the companion addition)
 */

import { jest } from '@jest/globals';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { WorkerSpawner } from '../../agent/WorkerSpawner.js';
import { SessionManager } from '../../agent/utilities/SessionManager.js';

function makeTempDir() {
  const dir = join(tmpdir(), `spawner-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('WorkerSpawner.CONTAINER_SESSION_PATH', () => {
  it('is /session', () => {
    expect(WorkerSpawner.CONTAINER_SESSION_PATH).toBe('/session');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('WorkerSpawner.spawn', () => {
  const workers = [];

  afterEach(() => {
    // Kill any workers that leaked out of tests
    for (const { worker, tempDir } of workers.splice(0)) {
      worker.kill('SIGKILL');
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function spawn(sessionId = 'sess_spawner_test') {
    const tempDir = makeTempDir();
    const worker = WorkerSpawner.spawn(sessionId, tempDir);
    workers.push({ worker, tempDir });
    return { worker, tempDir };
  }

  it('returns an object with a send() method (ChildProcess IPC interface)', () => {
    const { worker } = spawn();
    expect(typeof worker.send).toBe('function');
  });

  it('returns an object with a kill() method', () => {
    const { worker } = spawn();
    expect(typeof worker.kill).toBe('function');
  });

  it('returned process has a pid', () => {
    const { worker } = spawn();
    expect(typeof worker.pid).toBe('number');
    expect(worker.pid).toBeGreaterThan(0);
  });

  it('returned process is initially alive (exitCode is null)', () => {
    const { worker } = spawn();
    expect(worker.exitCode).toBeNull();
  });

  it('can send IPC messages without throwing', () => {
    const { worker } = spawn();
    expect(() => {
      worker.send({ type: 'get_context', requestId: 'probe' });
    }).not.toThrow();
  });

  it('IPC channel is active — worker responds to get_context', async () => {
    const { worker } = spawn();

    const response = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('IPC timeout')), 8000);
      worker.on('message', (msg) => {
        if (msg.type === 'context_response' && msg.requestId === 'probe') {
          clearTimeout(t);
          resolve(msg);
        }
      });
      // get_context works even before initialize (returns [])
      worker.send({ type: 'get_context', requestId: 'probe' });
    });

    expect(response.context).toEqual([]);
  }, 10000);

  it('process exits after SIGKILL', async () => {
    const { worker } = spawn();

    const exitCode = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Kill timeout')), 5000);
      worker.once('exit', (code, signal) => {
        clearTimeout(t);
        resolve({ code, signal });
      });
      worker.kill('SIGKILL');
    });

    // exitCode may be null on SIGKILL (signal-terminated), signal will be SIGKILL
    expect(exitCode.signal === 'SIGKILL' || exitCode.code !== undefined).toBe(true);
  }, 8000);

  it('each spawned worker gets its own process (distinct pids)', () => {
    const { worker: w1 } = spawn('sess_a');
    const { worker: w2 } = spawn('sess_b');
    expect(w1.pid).not.toBe(w2.pid);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SessionManager.createSessionWithId', () => {
  let sm;

  beforeEach(() => {
    sm = new SessionManager({ disableCleanup: true });
  });

  afterEach(() => {
    sm.shutdown();
  });

  it('creates a session with the provided ID', () => {
    const tempDir = makeTempDir();
    try {
      sm.createSessionWithId('test-id-1', null, tempDir);
      expect(sm.getSession('test-id-1')).toBeDefined();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('session has the correct tempDir', () => {
    const tempDir = makeTempDir();
    try {
      sm.createSessionWithId('test-id-2', null, tempDir);
      expect(sm.getSession('test-id-2').tempDir).toBe(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('session starts with empty conversationContext', () => {
    const tempDir = makeTempDir();
    try {
      sm.createSessionWithId('test-id-3', null, tempDir);
      expect(sm.getConversationContext('test-id-3')).toEqual([]);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('is idempotent — second call with same ID returns existing session', () => {
    const tempDir = makeTempDir();
    try {
      sm.createSessionWithId('test-id-4', null, tempDir);
      sm.addToConversationHistory('test-id-4', { role: 'user', content: 'hello' });
      sm.createSessionWithId('test-id-4', null, tempDir); // second call
      // History should be preserved — session was not replaced
      expect(sm.getConversationContext('test-id-4')).toHaveLength(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('can be initialized with initializeSession after creation', () => {
    const tempDir = makeTempDir();
    try {
      sm.createSessionWithId('test-id-5', null, tempDir);
      expect(() => {
        sm.initializeSession('test-id-5', 'sfd', null, [], {});
      }).not.toThrow();
      expect(sm.getSession('test-id-5').mode).toBe('sfd');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('disableCleanup prevents the cleanup timer from running', () => {
    // If cleanup were running, it would call cleanupStaleSessions every 5 minutes.
    // Just verify the timer is not set — SessionManager.cleanupTimer should be undefined.
    expect(sm.cleanupTimer).toBeUndefined();
  });
});
