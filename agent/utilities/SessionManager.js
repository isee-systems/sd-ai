import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { countTokens } from '@anthropic-ai/tokenizer';
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
  static MAX_COMPRESSION_TOKENS_PER_PASS = 200_000;

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
      mode: null,  // 'cld' or 'sfd' - set once at initialization, never changes
      clientModel: null,
      clientTools: [],
      context: {},

      // Model token tracking
      modelTokenCount: 0,

      // Active tool calls awaiting client response
      pendingToolCalls: new Map(),

      // Agent conversation context (for Claude Agent SDK)
      conversationContext: []
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
  initializeSession(sessionId, mode, model, tools, context) {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Validate model type
    if (mode !== 'cld' && mode !== 'sfd') {
      throw new Error(`Invalid mode: ${mode}. Must be 'cld' or 'sfd'`);
    }

    // Set model type (can only be set once)
    if (session.mode && session.mode !== mode) {
      throw new Error(`Cannot change model type from ${session.mode} to ${mode} during session`);
    }
    session.mode = mode;

    session.clientTools = tools || [];
    session.context = context || {};
    this.updateClientModel(sessionId, model);

    logger.log(`Session initialized: ${sessionId} with mode=${mode} and ${tools.length} client tools`);
  }

  /**
   * Update the client model reference and persist to disk.
   * Returns { modelPath, message } when the model is written.
   */
  updateClientModel(sessionId, model) {
    const session = this.getSession(sessionId);
    if (session) {
      session.clientModel = model;
      if (model) {
        return this.#writeModelToDisk(sessionId, model);
      }
    }
  }

  /**
   * Get the current client model
   */
  getClientModel(sessionId) {
    const session = this.getSession(sessionId);
    return session?.clientModel;
  }

  /**
   * Update model token count and check if it exceeds limit
   */
  updateModelTokenCount(sessionId, tokenCount) {
    const session = this.getSession(sessionId);
    if (session) {
      session.modelTokenCount = tokenCount;
    }
  }

  /**
   * Get model token count
   */
  getModelTokenCount(sessionId) {
    const session = this.getSession(sessionId);
    return session?.modelTokenCount || 0;
  }

  /**
   * Get session temp directory
   */
  getSessionTempDir(sessionId) {
    const session = this.getSession(sessionId);
    return session?.tempDir;
  }

  /**
   * Write a model to disk and return the LLM message describing where to find it.
   * Returns { modelPath, message }.
   */
  #writeModelToDisk(sessionId, model) {
    const sessionTempDir = this.getSessionTempDir(sessionId);
    const modelPath = join(sessionTempDir, 'model.sdjson');
    mkdirSync(sessionTempDir, { recursive: true });
    writeFileSync(modelPath, JSON.stringify(model, null, 2));
    logger.log(`Model written to: ${modelPath}`);
    const message = `The model has been written to disk at: ${modelPath}. Other tools will load it automatically — you do not need to read this file. Use the read_model_section tool if you need to inspect specific sections.`;
    return { modelPath, message };
  }

  /**
   * Write arbitrary data to a named file in the session temp directory.
   * Returns { filePath, message }.
   */
  writeDataToDisk(sessionId, filename, data) {
    const sessionTempDir = this.getSessionTempDir(sessionId);
    const filePath = join(sessionTempDir, filename);
    mkdirSync(sessionTempDir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(data, null, 2));
    logger.log(`Data written to: ${filePath}`);
    const message = `The data has been written to disk at: ${filePath}. Use the Read filesystem tool to load it into context.`;
    return { filePath, message };
  }

  /**
   * Add to conversation context
   */
  addToConversationHistory(sessionId, message) {
    const session = this.getSession(sessionId);
    if (session) {
      session.conversationContext.push(message);

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
   * Summarize an array of messages using the LLM and return a single summary message object.
   * Private — only called by summarizeContextIfNeeded and cleanupContext.
   */
  async #summarizeMessages(messages) {
    try {
      const conversationText = messages.map((msg) => {
        if (msg.role === 'user') {
          return `User: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`;
        } else if (msg.role === 'assistant') {
          if (Array.isArray(msg.content)) {
            const textContent = msg.content
              .filter(block => block.type === 'text')
              .map(block => block.text || block)
              .join('\n');
            return textContent ? `Assistant: ${textContent}` : '';
          }
          return `Assistant: ${msg.content}`;
        }
        return '';
      }).filter(line => line).join('\n\n');

      if (!this.anthropic) {
        this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      }

      const response = await this.anthropic.messages.create({
        model: config.agentSummaryModel,
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Please create a concise summary of the following conversation history. Focus on:
- The main task or goal the user requested
- Key decisions, findings, or results achieved
- Important context needed for continuing the conversation
- Current state of the work

Keep the summary brief but informative (2-4 paragraphs maximum).

Conversation history:
${conversationText}`
        }]
      });

      const summaryText = response.content[0].text;
      logger.log(`Created message history summary: ${summaryText.substring(0, 100)}...`);

      return {
        role: 'assistant',
        content: `[Previous conversation summary]\n${summaryText}\n[End of summary - continuing conversation]`
      };

    } catch (error) {
      logger.error('Error summarizing message history:', error);
      return {
        role: 'assistant',
        content: '[Previous conversation summary: Earlier messages were condensed to save context. The conversation is continuing from this point.]'
      };
    }
  }

  /**
   * If the session's conversation context exceeds maxContextTokens, summarize the oldest messages
   * in-place so the context stays within budget. Updates session state directly.
   */
  async summarizeContextIfNeeded(sessionId, maxContextTokens) {
    const session = this.getSession(sessionId);
    if (!session) return;

    const messages = session.conversationContext;
    const MAX_PASSES = 10;

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const currentTokens = countTokens(JSON.stringify(messages));
      if (currentTokens <= maxContextTokens) break;

      logger.log(`Message history exceeds token limit: ${currentTokens} tokens (limit: ${maxContextTokens})`);

      const firstMessage = messages[0];
      const firstMessageTokens = countTokens(JSON.stringify(firstMessage));
      const SUMMARY_TOKEN_ESTIMATE = 1000;
      let remainingTokenBudget = maxContextTokens - firstMessageTokens - SUMMARY_TOKEN_ESTIMATE;
      const keptRecentMessages = [];

      for (let i = messages.length - 1; i >= 1; i--) {
        const messageTokens = countTokens(JSON.stringify(messages[i]));
        if (remainingTokenBudget - messageTokens >= 0) {
          keptRecentMessages.unshift(messages[i]);
          remainingTokenBudget -= messageTokens;
        } else {
          break;
        }
      }

      if (keptRecentMessages.length >= messages.length - 1) break;

      const messagesToSummarize = messages.slice(1, messages.length - keptRecentMessages.length);
      if (messagesToSummarize.length === 0) break;

      // Cap how many tokens go to the LLM in one compression call
      let batchToSummarize = messagesToSummarize;
      if (countTokens(JSON.stringify(batchToSummarize)) > SessionManager.MAX_COMPRESSION_TOKENS_PER_PASS) {
        batchToSummarize = [];
        let tokenBudget = SessionManager.MAX_COMPRESSION_TOKENS_PER_PASS;
        for (const msg of messagesToSummarize) {
          const msgTokens = countTokens(JSON.stringify(msg));
          if (tokenBudget - msgTokens < 0) break;
          batchToSummarize.push(msg);
          tokenBudget -= msgTokens;
        }
      }

      if (batchToSummarize.length === 0) break;

      const summaryMessage = await this.#summarizeMessages(batchToSummarize);
      // Replace only the batch — remaining messages stay for subsequent passes
      messages.splice(1, batchToSummarize.length, summaryMessage);
      const newTokenCount = countTokens(JSON.stringify(messages));
      logger.log(`Summarized context: ${messages.length} messages, ${newTokenCount} tokens (saved ${currentTokens - newTokenCount})`);
    }
  }

  /**
   * Clean up the session's conversation context: remove stale model results, then summarize if over limit.
   */
  async cleanupContext(sessionId, maxContextTokens) {
    const session = this.getSession(sessionId);
    if (!session) return;

    const messages = session.conversationContext;
    if (messages.length === 0) return;

    logger.log(`Cleaning up conversation context (${messages.length} messages)`);

    const modelIndices = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === 'user' && message.content && Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'tool_result' && content.content) {
            try {
              const parsed = JSON.parse(content.content);
              if (parsed.model || parsed.variables) {
                modelIndices.push(i);
                break;
              }
            } catch (e) {
              // not a model result
            }
          }
        }
      }
    }

    if (modelIndices.length > 1) {
      const indicesToRemove = modelIndices.slice(0, -1).sort((a, b) => b - a);
      for (const index of indicesToRemove) {
        messages.splice(index, 1);
      }
      logger.log(`Removed ${indicesToRemove.length} stale model result(s) from context`);
    }

    await this.summarizeContextIfNeeded(sessionId, maxContextTokens);
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
          pendingCall.reject(new Error(typeof result === 'string' ? result : (result?.error || 'Tool call failed')));
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
