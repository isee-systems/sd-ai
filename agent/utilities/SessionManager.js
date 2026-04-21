import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'fs';
import logger from '../../utilities/logger.js';
import config from '../../config.js';

/**
 * SessionManager
 * Manages in-memory WebSocket sessions with session-specific temp folders
 *
 * Key Features:
 * - Pure in-memory state (no persistence)
 * - Session-specific temp folders for Python visualizations
 * - Automatic cleanup on disconnect
 * - Stale session cleanup
 * - Orphaned temp directory cleanup
 */
export class SessionManager {
  constructor(options = {}) {
    this.sessions = new Map();

    // Use configured temp directory or default to OS tmpdir
    const baseTempDir = config.sessionTempDir || tmpdir();
    this.tempBasePath = join(baseTempDir, 'sd-agent');

    // Configuration
    this.maxSessions = options.maxSessions || 1000;
    this.maxConversationHistory = options.maxConversationHistory || 100;
    this.maxSessionAge = options.maxSessionAge || 8 * 60 * 60 * 1000; // 8 hours
    this.sessionTimeout = options.sessionTimeout || 30 * 60 * 1000; // 30 minutes
    this.cleanupInterval = options.cleanupInterval || 5 * 60 * 1000; // 5 minutes

    // Ensure base temp directory exists
    if (!existsSync(this.tempBasePath)) {
      mkdirSync(this.tempBasePath, { recursive: true });
    }

    // Start cleanup timer
    this.startCleanupTimer();

    logger.log(`SessionManager initialized. Temp base: ${this.tempBasePath}`);
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId() {
    return `sess_${randomBytes(16).toString('hex')}`;
  }

  /**
   * Create a new session
   */
  createSession(ws) {
    // Enforce max sessions
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('Server at capacity. Please try again later.');
    }

    const sessionId = this.generateSessionId();
    const sessionTempDir = join(this.tempBasePath, sessionId);

    // Create session-specific temp folder
    try {
      mkdirSync(sessionTempDir, { recursive: true });
    } catch (err) {
      logger.error(`Failed to create temp directory for session ${sessionId}:`, err);
      throw new Error('Failed to initialize session temp directory');
    }

    const session = {
      sessionId,
      ws,
      tempDir: sessionTempDir,
      createdAt: Date.now(),
      lastActivity: Date.now(),

      // Client-provided data
      modelType: null,  // 'cld' or 'sfd' - set once at initialization, never changes
      clientModel: null,
      registeredTools: [],
      sessionConfig: null,
      context: {},

      // Model token tracking
      modelTokenCount: 0,
      modelExceedsTokenLimit: false,

      // Active tool calls awaiting client response
      pendingToolCalls: new Map(),

      // Agent conversation context (for Claude Agent SDK)
      conversationContext: [],

      // Usage metrics (anonymous)
      messageCount: 0,
      toolCallCount: 0
    };

    this.sessions.set(sessionId, session);

    logger.log(`Session created: ${sessionId} (total: ${this.sessions.size})`);

    return sessionId;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
    return session;
  }

  /**
   * Initialize a session with model and tools
   */
  initializeSession(sessionId, modelType, model, tools, context) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Validate model type
    if (modelType !== 'cld' && modelType !== 'sfd') {
      throw new Error(`Invalid modelType: ${modelType}. Must be 'cld' or 'sfd'`);
    }

    // Set model type (can only be set once)
    if (session.modelType && session.modelType !== modelType) {
      throw new Error(`Cannot change model type from ${session.modelType} to ${modelType} during session`);
    }
    session.modelType = modelType;

    session.clientModel = model;
    session.registeredTools = tools;
    session.context = context || {};

    logger.log(`Session initialized: ${sessionId} with modelType=${modelType} and ${tools.length} client tools`);
  }

  /**
   * Update the client model reference
   */
  updateClientModel(sessionId, model) {
    const session = this.getSession(sessionId);
    if (session) {
      session.clientModel = model;
    }
  }

  /**
   * Update model token count and check if it exceeds limit
   */
  updateModelTokenCount(sessionId, tokenCount) {
    const session = this.getSession(sessionId);
    if (session) {
      session.modelTokenCount = tokenCount;
      session.modelExceedsTokenLimit = tokenCount > config.maxTokensForEngines;
    }
  }

  /**
   * Check if model exceeds token limit
   */
  modelExceedsTokenLimit(sessionId) {
    const session = this.getSession(sessionId);
    return session?.modelExceedsTokenLimit || false;
  }

  /**
   * Get model token count
   */
  getModelTokenCount(sessionId) {
    const session = this.getSession(sessionId);
    return session?.modelTokenCount || 0;
  }

  /**
   * Get the current client model
   */
  getClientModel(sessionId) {
    const session = this.getSession(sessionId);
    return session?.clientModel;
  }

  /**
   * Get session temp directory
   */
  getSessionTempDir(sessionId) {
    const session = this.getSession(sessionId);
    return session?.tempDir;
  }

  /**
   * Add to conversation context
   */
  addToConversationHistory(sessionId, message) {
    const session = this.getSession(sessionId);
    if (session) {
      session.conversationContext.push(message);
      session.messageCount++;

      // Limit conversation history size to prevent memory bloat
      if (session.conversationContext.length > this.maxConversationHistory) {
        session.conversationContext = session.conversationContext.slice(-this.maxConversationHistory);
      }
    }
  }

  /**
   * Get conversation context
   */
  getConversationContext(sessionId) {
    const session = this.getSession(sessionId);
    return session?.conversationContext || [];
  }

  /**
   * Add a pending tool call
   */
  addPendingToolCall(sessionId, callId, toolName, args) {
    const session = this.getSession(sessionId);
    if (session) {
      let resolver, rejecter;
      const promise = new Promise((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
      });

      session.pendingToolCalls.set(callId, {
        toolName,
        arguments: args,
        timestamp: Date.now(),
        promise,
        resolve: resolver,
        reject: rejecter
      });

      session.toolCallCount++;

      return promise;
    }
    return Promise.reject(new Error('Session not found'));
  }

  /**
   * Resolve a pending tool call
   */
  resolvePendingToolCall(sessionId, callId, result, isError = false) {
    const session = this.getSession(sessionId);
    if (session) {
      const pendingCall = session.pendingToolCalls.get(callId);
      if (pendingCall) {
        if (isError) {
          pendingCall.reject(new Error(result.error || 'Tool call failed'));
        } else {
          pendingCall.resolve(result);
        }
        session.pendingToolCalls.delete(callId);
        return true;
      }
    }
    return false;
  }

  /**
   * Get pending tool call
   */
  getPendingToolCall(sessionId, callId) {
    const session = this.getSession(sessionId);
    return session?.pendingToolCalls.get(callId);
  }

  /**
   * Delete a session and cleanup resources
   */
  deleteSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Reject any pending tool calls
      for (const [callId, pendingCall] of session.pendingToolCalls.entries()) {
        pendingCall.reject(new Error('Session closed'));
      }
      session.pendingToolCalls.clear();

      // Clean up session temp folder
      this.cleanupSessionTempDir(session.tempDir);

      // Clean up references
      session.ws = null;
      session.clientModel = null;
      session.conversationContext = [];
      session.registeredTools = [];

      this.sessions.delete(sessionId);

      logger.log(`Session deleted: ${sessionId} (remaining: ${this.sessions.size})`);
    }
  }

  /**
   * Clean up a session temp directory
   */
  cleanupSessionTempDir(tempDir) {
    try {
      if (existsSync(tempDir)) {
        // Remove directory and all its contents recursively
        rmSync(tempDir, { recursive: true, force: true });
        logger.log(`Cleaned up temp directory: ${tempDir}`);
      }
    } catch (err) {
      logger.error(`Failed to cleanup temp directory ${tempDir}:`, err);
    }
  }

  /**
   * Start cleanup timer for stale sessions and orphaned temp dirs
   */
  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleSessions();
      this.cleanupOrphanedTempDirs();
    }, this.cleanupInterval);
  }

  /**
   * Clean up stale sessions
   */
  cleanupStaleSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      const age = now - session.createdAt;
      const inactivity = now - session.lastActivity;

      if (age > this.maxSessionAge || inactivity > this.sessionTimeout) {
        logger.log(`Cleaning up stale session: ${sessionId} (age: ${Math.round(age/1000/60)}m, inactive: ${Math.round(inactivity/1000/60)}m)`);

        // Close WebSocket if still open
        if (session.ws && session.ws.readyState === 1) {
          session.ws.close(1000, 'Session timeout');
        }

        this.deleteSession(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.log(`Cleaned up ${cleanedCount} stale session(s)`);
    }
  }

  /**
   * Clean up orphaned temp directories
   */
  cleanupOrphanedTempDirs() {
    try {
      if (!existsSync(this.tempBasePath)) {
        return;
      }

      const tempDirs = readdirSync(this.tempBasePath);
      const activeSessionIds = new Set(this.sessions.keys());
      let cleanedCount = 0;

      for (const dir of tempDirs) {
        // Check if this temp dir belongs to an active session
        if (!activeSessionIds.has(dir)) {
          const fullPath = join(this.tempBasePath, dir);

          // Additional safety check: only delete dirs that match session pattern
          if (dir.startsWith('sess_')) {
            this.cleanupSessionTempDir(fullPath);
            cleanedCount++;
            logger.log(`Cleaned up orphaned temp directory: ${dir}`);
          }
        }
      }

      if (cleanedCount > 0) {
        logger.log(`Cleaned up ${cleanedCount} orphaned temp director(ies)`);
      }
    } catch (err) {
      logger.error('Failed to cleanup orphaned temp dirs:', err);
    }
  }

  /**
   * Get temp directory sizes for monitoring
   */
  getTempDirSizes() {
    const sizes = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      const size = this.getDirectorySize(session.tempDir);
      const fileCount = this.getFileCount(session.tempDir);

      sizes.push({
        sessionId,
        tempDir: session.tempDir,
        size,
        fileCount,
        age: Date.now() - session.createdAt,
        lastActivity: Date.now() - session.lastActivity
      });
    }

    return sizes;
  }

  /**
   * Get directory size in bytes
   */
  getDirectorySize(dirPath) {
    let totalSize = 0;

    try {
      if (existsSync(dirPath)) {
        const files = readdirSync(dirPath);
        for (const file of files) {
          const stats = statSync(join(dirPath, file));
          totalSize += stats.size;
        }
      }
    } catch (err) {
      // Directory doesn't exist or can't be read
    }

    return totalSize;
  }

  /**
   * Get file count in directory
   */
  getFileCount(dirPath) {
    try {
      if (existsSync(dirPath)) {
        return readdirSync(dirPath).length;
      }
    } catch (err) {
      // Directory doesn't exist or can't be read
    }
    return 0;
  }

  /**
   * Get stats (for monitoring endpoint)
   */
  getStats() {
    const totalMessages = Array.from(this.sessions.values())
      .reduce((sum, s) => sum + s.messageCount, 0);
    const totalToolCalls = Array.from(this.sessions.values())
      .reduce((sum, s) => sum + s.toolCallCount, 0);
    const totalPendingCalls = Array.from(this.sessions.values())
      .reduce((sum, s) => sum + s.pendingToolCalls.size, 0);

    return {
      activeSessions: this.sessions.size,
      totalMessages,
      totalToolCalls,
      totalPendingCalls,
      tempDirInfo: this.getTempDirSizes()
    };
  }

  /**
   * Shutdown - cleanup all sessions
   */
  shutdown() {
    logger.log('SessionManager shutting down...');

    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // Close all sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.ws && session.ws.readyState === 1) {
        session.ws.close(1000, 'Server shutting down');
      }
      this.deleteSession(sessionId);
    }

    // Final cleanup of any remaining temp directories
    this.cleanupOrphanedTempDirs();

    logger.log('SessionManager shutdown complete');
  }
}
