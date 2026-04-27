import { StructuredOutputToZodConverter } from '../../utilities/StructuredOutputToZodConverter.js';
import { tool } from './builtin/toolHelpers.js';
import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import logger from '../../utilities/logger.js';

/**
 * DynamicToolProvider
 * Provides tools from client-registered tool definitions
 *
 * Handles:
 * - Converting client tool definitions to tool collection format
 * - Proxying tool calls to client via WebSocket
 * - Waiting for client responses with timeout
 * - Special handling for get_current_model and update_model
 */
export class DynamicToolProvider {
  constructor(sessionManager, sessionId, sendToClient) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.schemaConverter = new StructuredOutputToZodConverter();

    const session = sessionManager.getSession(sessionId);
    const clientTools = session?.clientTools || [];
    this.toolCollection = this.createToolCollectionFromClientTools(clientTools);
    logger.log(`DynamicToolProvider initialized for session ${sessionId} with ${clientTools.length} client tools`);
  }

  /**
   * Create tool collection from client tool definitions
   */
  createToolCollectionFromClientTools(clientTools) {
    const tools = {};

    for (const toolDef of clientTools) {
      const toolName = `client_${toolDef.name}`;
      tools[toolName] = {
        description: toolDef.description,
        inputSchema: this.schemaConverter.convert(toolDef.inputSchema),
        handler: this.createToolHandler(toolDef),
        timeout: toolDef.timeout ?? 30000
      };
    }

    return {
      name: 'client_tools',
      tools
    };
  }

  /**
   * Create a tool handler that proxies to the client
   * Note: toolDef.name is the UNPREFIXED name (e.g., 'get_current_model')
   */
  createToolHandler(toolDef) {
    return async (args) => {
      try {
        // Use unprefixed name when communicating with client
        const clientToolName = toolDef.name;
        const timeout = toolDef.timeout;
        return await this.requestClientExecution(clientToolName, args, timeout);

      } catch (error) {
        logger.error(`Error executing client tool ${toolDef.name}:`, error);
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true
        };
      }
    };
  }

  /**
   * Request client to execute a tool
   */
  async requestClientExecution(toolName, args, timeout) {
    timeout = timeout ?? 30000;
    const callId = this.generateCallId();

    // Create pending call that will be resolved when client responds
    const resultPromise = this.sessionManager.addPendingToolCall(
      this.sessionId,
      callId,
      toolName,
      args
    );

    // Send tool_call_request to client (separate from tool_call_notification)
    // This actually requests the client to execute the tool and send back results
    await this.sendToClient({
      type: 'tool_call_request',
      sessionId: this.sessionId,
      callId,
      toolName,
      arguments: args,
      timeout
    });

    // Wait for client response with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tool call timeout: ${toolName} did not respond within ${timeout}ms`));
      }, timeout);
    });

    try {
      const result = await Promise.race([resultPromise, timeoutPromise]);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: 'text', text}],
        isError: false
      };
    } catch (error) {
      // Clean up pending call
      const pendingCall = this.sessionManager.getPendingToolCall(this.sessionId, callId);
      if (pendingCall) {
        this.sessionManager.resolvePendingToolCall(this.sessionId, callId, { error: error.message }, true);
      }
      throw error;
    }
  }

  /**
   * Generate a unique call ID
   */
  generateCallId() {
    return `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get the tool collection
   */
  getTools() {
    return this.toolCollection;
  }

  /**
   * Get list of registered client tool names (with client_ prefix)
   */
  getToolNames() {
    return Object.keys(this.toolCollection?.tools || {});
  }

  /**
   * Check if a tool is a client tool (expects prefixed name)
   */
  isClientTool(toolName) {
    return this.getToolNames().includes(toolName);
  }

  /**
   * Create MCP server from client tool definitions (for SDK mode)
   * Wraps existing tool collection into SDK MCP server format
   * @returns {Object|null} MCP server instance or null if no tools
   */
  getMcpServer() {
    if (!this.toolCollection) {
      return null;
    }

    const tools = [];

    // Convert tool collection to SDK tool instances
    for (const [toolName, toolDef] of Object.entries(this.toolCollection.tools)) {
      // Remove 'client_' prefix for SDK (SDK will add 'mcp__client__' prefix)
      const unprefixedName = toolName.replace(/^client_/, '');

      tools.push(tool({
        name: unprefixedName,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
        execute: toolDef.handler
      }));
    }

    if (tools.length === 0) {
      return null;
    }

    logger.log(`Creating client MCP server with ${tools.length} tools`);

    return createSdkMcpServer({
      name: 'client',
      version: '1.0.0',
      tools
    });
  }
}
