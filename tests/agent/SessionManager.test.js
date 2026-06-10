import { SessionManager } from '../../agent/utilities/SessionManager.js';
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';

describe('SessionManager', () => {
  let sessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  describe('initializeSession', () => {
    it('should create a new session with CLD model type', () => {
      const mode = 'cld';
      const model = { variables: [], relationships: [] };
      const tools = [];
      const context = { description: 'Test context' };

      const sessionId = sessionManager.createSession(null); // null WebSocket for testing
      sessionManager.initializeSession(sessionId, mode, model, tools, context, 'test-client');

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session.mode).toBe('cld');
      expect(session.clientModel).toEqual(model);
      expect(session.context).toEqual(context);
      expect(session.conversationContext).toEqual([]);
    });

    it('should create a new session with SFD model type', () => {
      const mode = 'sfd';
      const model = { variables: [] };

      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, mode, model, [], {}, '');

      const session = sessionManager.getSession(sessionId);
      expect(session.mode).toBe('sfd');
    });

    it('should create temp folder for session', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, '');

      const session = sessionManager.getSession(sessionId);
      expect(session.tempDir).toBeDefined();
      expect(fs.existsSync(session.tempDir)).toBe(true);
    });

    it('should throw error for invalid model type', () => {
      const sessionId = sessionManager.createSession(null);
      expect(() => {
        sessionManager.initializeSession(sessionId, 'invalid', {}, [], {}, '');
      }).toThrow();
    });
  });

  describe('getSession', () => {
    it('should return session if exists', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, '');

      const session = sessionManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session.mode).toBe('cld');
    });

    it('should return undefined for non-existent session', () => {
      const session = sessionManager.getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('updateClientModel', () => {
    it('should update the client model', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'sfd', {}, [], {}, '');

      const newModel = { variables: [{ name: 'Stock1', type: 'stock' }] };
      sessionManager.updateClientModel(sessionId, newModel);

      const session = sessionManager.getSession(sessionId);
      expect(session.clientModel).toEqual(newModel);
    });

    it('should not throw error for non-existent session', () => {
      expect(() => {
        sessionManager.updateClientModel('non-existent', {});
      }).not.toThrow();
    });
  });

  describe('conversation history', () => {
    let testSessionId;

    beforeEach(() => {
      testSessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(testSessionId, 'cld', {}, [], {}, '');
    });

    it('should add messages to conversation history', () => {
      sessionManager.addToConversationHistory(testSessionId, {
        role: 'user',
        content: 'Hello'
      });

      const history = sessionManager.getConversationContext(testSessionId);
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
    });

    it('should maintain conversation order', () => {
      sessionManager.addToConversationHistory(testSessionId, {
        role: 'user',
        content: 'First'
      });
      sessionManager.addToConversationHistory(testSessionId, {
        role: 'assistant',
        content: 'Second'
      });

      const history = sessionManager.getConversationContext(testSessionId);
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('First');
      expect(history[1].content).toBe('Second');
    });
  });

  describe('deleteSession', () => {
    it('should remove session and clean up temp folder', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, '');

      const session = sessionManager.getSession(sessionId);
      const tempFolder = session.tempDir;
      expect(fs.existsSync(tempFolder)).toBe(true);

      sessionManager.deleteSession(sessionId);

      expect(sessionManager.getSession(sessionId)).toBeUndefined();
      expect(fs.existsSync(tempFolder)).toBe(false);
    });

    it('should not throw error for non-existent session', () => {
      expect(() => {
        sessionManager.deleteSession('non-existent');
      }).not.toThrow();
    });
  });

  describe('attachedFiles (RAG metadata)', () => {
    it('adds, retrieves, and removes attached file metadata', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'client');

      expect(sessionManager.getAttachedFiles(sessionId)).toEqual([]);

      sessionManager.addAttachedFile(sessionId, { fileId: 'f1', name: 'a.txt', status: 'ready' });
      sessionManager.addAttachedFile(sessionId, { fileId: 'f2', name: 'b.txt', status: 'processing' });
      expect(sessionManager.getAttachedFiles(sessionId)).toHaveLength(2);

      // Re-adding the same fileId replaces (updates status)
      sessionManager.addAttachedFile(sessionId, { fileId: 'f2', name: 'b.txt', status: 'ready' });
      expect(sessionManager.getAttachedFiles(sessionId)).toHaveLength(2);
      expect(sessionManager.getAttachedFiles(sessionId).find(f => f.fileId === 'f2').status).toBe('ready');

      expect(sessionManager.removeAttachedFile(sessionId, 'f1')).toBe(true);
      expect(sessionManager.removeAttachedFile(sessionId, 'nope')).toBe(false);
      expect(sessionManager.getAttachedFiles(sessionId)).toHaveLength(1);
    });

    it('clears attached files on deleteSession', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'client');
      sessionManager.addAttachedFile(sessionId, { fileId: 'f1', name: 'a.txt', status: 'ready' });
      sessionManager.deleteSession(sessionId);
      expect(sessionManager.getAttachedFiles(sessionId)).toEqual([]);
    });
  });

  describe('shutdown', () => {
    it('should clean up all sessions', () => {
      const sessionId1 = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId1, 'cld', {}, [], {}, '');

      const sessionId2 = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId2, 'sfd', {}, [], {}, '');

      const session1 = sessionManager.getSession(sessionId1);
      const session2 = sessionManager.getSession(sessionId2);
      const temp1 = session1.tempDir;
      const temp2 = session2.tempDir;

      sessionManager.shutdown();

      expect(sessionManager.getSession(sessionId1)).toBeUndefined();
      expect(sessionManager.getSession(sessionId2)).toBeUndefined();
      expect(fs.existsSync(temp1)).toBe(false);
      expect(fs.existsSync(temp2)).toBe(false);
    });
  });

  describe('getSessionTempDir', () => {
    it('should return temp folder path for session', () => {
      const sessionId = sessionManager.createSession(null);
      sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, '');

      const tempFolder = sessionManager.getSessionTempDir(sessionId);
      expect(tempFolder).toBeDefined();
      expect(fs.existsSync(tempFolder)).toBe(true);
    });

    it('should return undefined for non-existent session', () => {
      const tempFolder = sessionManager.getSessionTempDir('non-existent');
      expect(tempFolder).toBeUndefined();
    });
  });

  describe('setWorkerTeardown', () => {
    it('initializes workerTeardown to null on new sessions', () => {
      const sessionId = sessionManager.createSession(null);
      // Bypass getSession() so we don't touch lastActivity in assertions
      // that other tests might extend.
      expect(sessionManager.sessions.get(sessionId).workerTeardown).toBeNull();
    });

    it('installs a teardown hook on the session', () => {
      const sessionId = sessionManager.createSession(null);
      const teardown = () => Promise.resolve();
      sessionManager.setWorkerTeardown(sessionId, teardown);
      expect(sessionManager.sessions.get(sessionId).workerTeardown).toBe(teardown);
    });

    it('is a no-op for an unknown session id', () => {
      expect(() => sessionManager.setWorkerTeardown('nope', () => Promise.resolve())).not.toThrow();
    });
  });

  describe('cleanupStaleSessions', () => {
    // Drive cleanup manually with tight timeouts so we don't depend on the
    // 5-minute interval timer. Isolate the temp base so other parallel test
    // suites' SessionManager.shutdown() (which calls cleanupOrphanedTempDirs)
    // can't reap our session dir as an "orphan".
    let sm;
    let tempBasePath;

    beforeEach(() => {
      tempBasePath = path.join(os.tmpdir(), `sm-cleanup-${randomBytes(8).toString('hex')}`);
      sm = new SessionManager({
        maxSessionAge: 50,
        sessionTimeout: 50,
        disableCleanup: true,
        tempBasePath,
      });
    });

    afterEach(() => {
      sm.shutdown();
      try { fs.rmSync(tempBasePath, { recursive: true, force: true }); } catch { /* already gone */ }
    });

    it('leaves fresh sessions alone', async () => {
      const sessionId = sm.createSession(null);
      sm.initializeSession(sessionId, 'cld', {}, [], {}, '');

      await sm.cleanupStaleSessions();

      expect(sm.sessions.has(sessionId)).toBe(true);
    });

    it('removes sessions that have exceeded the inactivity timeout', async () => {
      const sessionId = sm.createSession(null);
      sm.initializeSession(sessionId, 'cld', {}, [], {}, '');
      const tempDir = sm.sessions.get(sessionId).tempDir;

      await new Promise((r) => setTimeout(r, 80));
      await sm.cleanupStaleSessions();

      expect(sm.sessions.has(sessionId)).toBe(false);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('awaits workerTeardown before deleting the session or its temp dir', async () => {
      // This is the bug-fix invariant: when a worker is running, the host must
      // keep the bind-mount source alive until the worker has actually exited.
      const sessionId = sm.createSession(null);
      sm.initializeSession(sessionId, 'cld', {}, [], {}, '');
      const tempDir = sm.sessions.get(sessionId).tempDir;

      let dirExistedWhenTeardownCalled = null;
      let sessionStillRegisteredAtTeardown = null;
      let releaseTeardown;
      const teardownGate = new Promise((resolve) => { releaseTeardown = resolve; });

      sm.setWorkerTeardown(sessionId, () => {
        dirExistedWhenTeardownCalled = fs.existsSync(tempDir);
        sessionStillRegisteredAtTeardown = sm.sessions.has(sessionId);
        return teardownGate;
      });

      await new Promise((r) => setTimeout(r, 80));

      const cleanupPromise = sm.cleanupStaleSessions();

      // Let the cleanup loop reach the await on our teardown gate.
      await new Promise((r) => setImmediate(r));

      // Mid-teardown: dir + session must still be present, otherwise a live
      // worker would observe its `/session` bind mount yanked.
      expect(sm.sessions.has(sessionId)).toBe(true);
      expect(fs.existsSync(tempDir)).toBe(true);

      releaseTeardown();
      await cleanupPromise;

      expect(dirExistedWhenTeardownCalled).toBe(true);
      expect(sessionStillRegisteredAtTeardown).toBe(true);
      expect(sm.sessions.has(sessionId)).toBe(false);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('still deletes the session if workerTeardown rejects', async () => {
      const sessionId = sm.createSession(null);
      sm.initializeSession(sessionId, 'cld', {}, [], {}, '');
      const tempDir = sm.sessions.get(sessionId).tempDir;

      sm.setWorkerTeardown(sessionId, () => Promise.reject(new Error('worker exit failed')));

      await new Promise((r) => setTimeout(r, 80));
      await sm.cleanupStaleSessions();

      expect(sm.sessions.has(sessionId)).toBe(false);
      expect(fs.existsSync(tempDir)).toBe(false);
    });

    it('closes the WebSocket if it is still open', async () => {
      const ws = { readyState: 1, close: jest.fn() };
      const sessionId = sm.createSession(ws);
      sm.initializeSession(sessionId, 'cld', {}, [], {}, '');

      await new Promise((r) => setTimeout(r, 80));
      await sm.cleanupStaleSessions();

      expect(ws.close).toHaveBeenCalledWith(1000, 'Session timeout');
    });

    it('does not call ws.close if the WebSocket is already closed', async () => {
      const ws = { readyState: 3, close: jest.fn() };
      const sessionId = sm.createSession(ws);
      sm.initializeSession(sessionId, 'cld', {}, [], {}, '');

      await new Promise((r) => setTimeout(r, 80));
      await sm.cleanupStaleSessions();

      expect(ws.close).not.toHaveBeenCalled();
      // Session should still be removed.
      expect(sm.sessions.has(sessionId)).toBe(false);
    });

    it('skips sessions removed concurrently while awaiting another teardown', async () => {
      // If a session gets deleted out from under us (e.g. WS close handler
      // fires while we are awaiting a slow teardown for a different session),
      // cleanupStaleSessions must not call deleteSession on it again.
      const sessionA = sm.createSession(null);
      sm.initializeSession(sessionA, 'cld', {}, [], {}, '');
      const sessionB = sm.createSession(null);
      sm.initializeSession(sessionB, 'cld', {}, [], {}, '');
      const tempA = sm.sessions.get(sessionA).tempDir;
      const tempB = sm.sessions.get(sessionB).tempDir;

      let releaseA;
      const aGate = new Promise((resolve) => { releaseA = resolve; });
      sm.setWorkerTeardown(sessionA, () => aGate);

      const deleteSpy = jest.spyOn(sm, 'deleteSession');

      await new Promise((r) => setTimeout(r, 80));
      const cleanupPromise = sm.cleanupStaleSessions();

      // Drop into the await on sessionA's teardown.
      await new Promise((r) => setImmediate(r));

      // Simulate a concurrent WS close removing session B.
      sm.deleteSession(sessionB);
      expect(fs.existsSync(tempB)).toBe(false);

      releaseA();
      await cleanupPromise;

      // sessionB should have only been deleted once (the concurrent removal).
      const bDeletes = deleteSpy.mock.calls.filter(([id]) => id === sessionB).length;
      expect(bDeletes).toBe(1);
      // sessionA still got cleaned up after its teardown resolved.
      expect(sm.sessions.has(sessionA)).toBe(false);
      expect(fs.existsSync(tempA)).toBe(false);

      deleteSpy.mockRestore();
    });
  });
});
