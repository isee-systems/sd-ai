import { StructuredOutputToZodConverter } from '../../utilities/StructuredOutputToZodConverter.js';
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
    this.toolCollection = null;

    // Initialize schema converter
    this.schemaConverter = new StructuredOutputToZodConverter();
  }

  /**
   * Update tools based on client registration
   */
  updateTools(clientTools) {
    const session = this.sessionManager.getSession(this.sessionId);
    if (!session) {
      throw new Error(`Session not found: ${this.sessionId}`);
    }

    // Store registered tools
    session.registeredTools = clientTools;

    // Create tool collection from client tools
    this.toolCollection = this.createToolCollectionFromClientTools(clientTools);

    logger.log(`Updated dynamic tools for session ${this.sessionId}: ${clientTools.map(t => `client_${t.name}`).join(', ')}`);
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
        handler: this.createToolHandler(toolDef)
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

        // Special handling for specific tools
        if (clientToolName === 'get_current_model') {
          return await this.handleGetCurrentModel(args);
        } else if (clientToolName === 'update_model') {
          return await this.handleUpdateModel(args);
        } else {
          return await this.requestClientExecution(clientToolName, args);
        }
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
   * Handle get_current_model (returns and caches model)
   */
  async handleGetCurrentModel(args) {
    const result = await this.requestClientExecution('get_current_model', args);

    // Update session with latest model
    if (result.model) {
      this.sessionManager.updateClientModel(this.sessionId, result.model);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  /**
   * Handle update_model (sets/updates the model and caches it)
   * Note: No distinction between creating and updating - always returns the full model
   */
  async handleUpdateModel(args) {
    const result = await this.requestClientExecution('update_model', args);

    // Update session with the new model state
    if (result.model) {
      this.sessionManager.updateClientModel(this.sessionId, result.model);
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  /**
   * Request client to execute a tool
   */
  async requestClientExecution(toolName, args, timeout = 30000) {
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
      return result;
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
    const session = this.sessionManager.getSession(this.sessionId);
    return session?.registeredTools.map(t => `client_${t.name}`) || [];
  }

  /**
   * Check if a tool is a client tool (expects prefixed name)
   */
  isClientTool(toolName) {
    return this.getClientToolNames().includes(toolName);
  }
}
