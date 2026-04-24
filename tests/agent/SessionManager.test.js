import { SessionManager } from '../../agent/utilities/SessionManager.js';
import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';

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
      sessionManager.initializeSession(sessionId, mode, model, tools, context);

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
});
