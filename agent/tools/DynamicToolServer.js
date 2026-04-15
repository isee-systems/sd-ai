import { z } from 'zod';

/**
 * DynamicToolServer
 * Creates an MCP server from client-registered tools
 *
 * Handles:
 * - Converting client tool definitions to MCP format
 * - Proxying tool calls to client via WebSocket
 * - Waiting for client responses with timeout
 * - Special handling for get_current_model and update_model
 */
export class DynamicToolServer {
  constructor(sessionManager, sessionId, sendToClient) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.mcpServer = null;
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

    // Create MCP server from client tools
    this.mcpServer = this.createMcpServerFromClientTools(clientTools);

    console.log(`Updated dynamic tools for session ${this.sessionId}: ${clientTools.map(t => t.name).join(', ')}`);
  }

  /**
   * Create MCP server from client tool definitions
   */
  createMcpServerFromClientTools(clientTools) {
    const tools = {};

    for (const toolDef of clientTools) {
      tools[toolDef.name] = {
        description: toolDef.description,
        inputSchema: this.convertInputSchema(toolDef.inputSchema),
        handler: this.createToolHandler(toolDef)
      };
    }

    return {
      name: 'client_tools',
      tools
    };
  }

  /**
   * Convert client input schema to Zod schema
   */
  convertInputSchema(inputSchema) {
    // inputSchema is in JSON Schema format from client
    // Convert to Zod schema
    const properties = inputSchema.properties || {};
    const required = inputSchema.required || [];

    const zodSchema = {};

    for (const [propName, propDef] of Object.entries(properties)) {
      let zodField = this.jsonSchemaTypeToZod(propDef);

      // Make optional if not required
      if (!required.includes(propName)) {
        zodField = zodField.optional();
      }

      // Add description if present
      if (propDef.description) {
        zodField = zodField.describe(propDef.description);
      }

      zodSchema[propName] = zodField;
    }

    return z.object(zodSchema);
  }

  /**
   * Convert JSON Schema type to Zod type
   */
  jsonSchemaTypeToZod(propDef) {
    switch (propDef.type) {
      case 'string':
        return z.string();
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'array':
        if (propDef.items) {
          return z.array(this.jsonSchemaTypeToZod(propDef.items));
        }
        return z.array(z.any());
      case 'object':
        if (propDef.properties) {
          return this.convertInputSchema(propDef);
        }
        return z.object({}).passthrough();
      default:
        return z.any();
    }
  }

  /**
   * Create a tool handler that proxies to the client
   */
  createToolHandler(toolDef) {
    return async (args) => {
      try {
        // Special handling for specific tools
        if (toolDef.name === 'get_current_model') {
          return await this.handleGetCurrentModel(args);
        } else if (toolDef.name === 'update_model') {
          return await this.handleUpdateModel(args);
        } else {
          return await this.requestClientExecution(toolDef.name, args);
        }
      } catch (error) {
        console.error(`Error executing client tool ${toolDef.name}:`, error);
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

    // Send tool call request to client
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
   * Get the MCP server
   */
  getMcpServer() {
    return this.mcpServer;
  }

  /**
   * Get list of registered client tool names
   */
  getClientToolNames() {
    const session = this.sessionManager.getSession(this.sessionId);
    return session?.registeredTools.map(t => t.name) || [];
  }

  /**
   * Check if a tool is a client tool
   */
  isClientTool(toolName) {
    return this.getClientToolNames().includes(toolName);
  }
}
