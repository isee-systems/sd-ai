import Anthropic from '@anthropic-ai/sdk';
import { marked } from 'marked';
import { ConfigManager } from './utilities/ConfigManager.js';
import { createBuiltInToolsServer, getBuiltInToolNames } from './tools/BuiltInTools.js';
import { DynamicToolServer } from './tools/DynamicToolServer.js';
import {
  createAgentTextMessage,
  createToolCallInitiatedMessage,
  createToolCallCompletedMessage,
  createAgentCompleteMessage,
  createErrorMessage
} from './utilities/MessageProtocol.js';
import logger from '../utilities/logger.js';

/**
 * AgentOrchestrator
 * Manages the Claude Agent SDK lifecycle and message translation
 *
 * Responsibilities:
 * - Load and apply agent configuration
 * - Integrate built-in and dynamic tools
 * - Start conversations with Claude Agent SDK
 * - Translate SDK messages to WebSocket messages
 * - Handle tool execution (built-in vs client tools)
 * - Send messages to client via WebSocket
 */
export class AgentOrchestrator {
  constructor(sessionManager, sessionId, sendToClient, configPath) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;

    // Load configuration
    this.configManager = new ConfigManager(configPath);

    // Create dynamic tool server
    this.dynamicToolServer = new DynamicToolServer(sessionManager, sessionId, sendToClient);

    // Initialize Anthropic client
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    logger.log(`AgentOrchestrator initialized for session ${sessionId}`);
  }

  /**
   * Initialize with client tools
   */
  initializeTools(clientTools) {
    this.dynamicToolServer.updateTools(clientTools);
  }

  /**
   * Start a conversation with the agent
   */
  async startConversation(userMessage, sessionConfig = {}) {
    try {
      const session = this.sessionManager.getSession(this.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${this.sessionId}`);
      }

      // Add user message to conversation history
      this.sessionManager.addToConversationHistory(this.sessionId, {
        role: 'user',
        content: userMessage
      });

      // Build system prompt from config
      const runtimeDirectives = this.sessionManager.getRuntimeDirectives(this.sessionId);
      const modelType = session.modelType;
      const systemPrompt = this.configManager.buildSystemPrompt(
        sessionConfig,
        runtimeDirectives,
        modelType
      );

      // Get tool servers
      const builtInTools = createBuiltInToolsServer(
        this.sessionManager,
        this.sessionId,
        this.sendToClient
      );
      const dynamicTools = this.dynamicToolServer.getMcpServer();

      logger.log(`Starting conversation for session ${this.sessionId}`);
      logger.log(`Built-in tools: ${getBuiltInToolNames().join(', ')}`);
      logger.log(`Client tools: ${this.dynamicToolServer.getClientToolNames().join(', ')}`);

      // Start agent conversation loop
      await this.runAgentConversation(userMessage, systemPrompt, builtInTools, dynamicTools);

    } catch (error) {
      logger.error(`Error in agent conversation for session ${this.sessionId}:`, error);

      await this.sendToClient(createErrorMessage(
        this.sessionId,
        error.message,
        'CONVERSATION_ERROR',
        true
      ));
    }
  }

  /**
   * Run agent conversation with tool calling support
   * Uses Anthropic SDK directly with agentic loop
   */
  async runAgentConversation(_userMessage, systemPrompt, builtInTools, dynamicTools) {
    const conversationHistory = this.sessionManager.getConversationContext(this.sessionId);

    // Prepare messages for Claude (conversation history already includes the user message)
    const messages = conversationHistory.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Convert tool servers to Anthropic tool format
    const tools = this.convertToolsToAnthropicFormat(builtInTools, dynamicTools);

    let continueLoop = true;
    const maxIterations = 20; // Prevent infinite loops
    let iteration = 0;

    while (continueLoop && iteration < maxIterations) {
      iteration++;

      try {
        // Call Claude API
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8192,
          system: systemPrompt,
          messages: messages,
          tools: tools.length > 0 ? tools : undefined
        });

        // Process response
        continueLoop = await this.processAgentResponse(response, messages, builtInTools, dynamicTools);

      } catch (error) {
        logger.error('Error in agent conversation loop:', error);
        await this.sendToClient(createErrorMessage(
          this.sessionId,
          `Agent error: ${error.message}`,
          'AGENT_ERROR',
          true
        ));
        continueLoop = false;
      }
    }

    if (iteration >= maxIterations) {
      logger.warn(`Agent conversation reached max iterations (${maxIterations})`);
    }
  }

  /**
   * Process agent response and handle tool calls
   * Returns true if the conversation should continue
   */
  async processAgentResponse(response, messages, builtInTools, dynamicTools) {
    let hasToolCalls = false;

    // Process each content block
    for (const block of response.content) {
      if (block.type === 'text') {
        // Send text content to client
        const text =  await marked.parse(block.text);

        await this.sendToClient(createAgentTextMessage(
          this.sessionId,
          text,
          false
        ));

        // Add to conversation history
        this.sessionManager.addToConversationHistory(this.sessionId, {
          role: 'assistant',
          content: text
        });
      } else if (block.type === 'tool_use') {
        hasToolCalls = true;

        // Notify client that tool call is initiated
        const isBuiltIn = this.isBuiltInTool(block.name, builtInTools);
        await this.sendToClient(createToolCallInitiatedMessage(
          this.sessionId,
          block.id,
          block.name,
          block.input,
          isBuiltIn
        ));

        // Execute tool
        const toolResult = await this.executeToolCall(block, builtInTools, dynamicTools);

        // Determine response type based on tool name
        let responseType = 'other';
        if (['generate_ltm_narrative'].includes(block.name)) {
          responseType = 'ltm-discuss';
        } else if (['discuss_model_with_seldon', 'discuss_model_across_runs', 'discuss_with_mentor'].includes(block.name)) {
          responseType = 'discuss';
        } else if (['generate_quantitative_model', 'generate_qualitative_model', 'generate_documentation', 'update_model', 'get_current_model'].includes(block.name)) {
          responseType = 'model';
        }

        // Notify client of completion
        await this.sendToClient(createToolCallCompletedMessage(
          this.sessionId,
          block.id,
          block.name,
          toolResult.content,
          toolResult.isError,
          responseType
        ));

        // Add tool use and result to messages
        if (!messages[messages.length - 1] || messages[messages.length - 1].role !== 'assistant') {
          messages.push({
            role: 'assistant',
            content: []
          });
        }

        // Add tool_use block
        messages[messages.length - 1].content.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input
        });

        // Add tool_result
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(toolResult.content)
          }]
        });
      }
    }

    // If we had tool calls, continue the loop to let Claude process results
    if (hasToolCalls) {
      return true;
    }

    // If stop_reason is end_turn, we're done
    if (response.stop_reason === 'end_turn') {
      await this.sendToClient(createAgentCompleteMessage(
        this.sessionId,
        'success',
        'Task completed successfully'
      ));
      return false;
    }

    // Continue if stop_reason is max_tokens or other reasons
    return response.stop_reason === 'max_tokens';
  }

  /**
   * Execute a tool call (built-in or client tool)
   */
  async executeToolCall(toolUse, builtInTools, _dynamicTools) {
    try {
      // Check if it's a built-in tool
      if (builtInTools.tools[toolUse.name]) {
        const handler = builtInTools.tools[toolUse.name].handler;
        const result = await handler(toolUse.input);
        return {
          content: result,
          isError: result.isError || false
        };
      }

      // Check if it's a client tool
      if (this.dynamicToolServer.isClientTool(toolUse.name)) {
        const result = await this.dynamicToolServer.requestClientExecution(
          toolUse.name,
          toolUse.input
        );
        return {
          content: result,
          isError: false
        };
      }

      // Tool not found
      return {
        content: { error: `Tool not found: ${toolUse.name}` },
        isError: true
      };

    } catch (error) {
      logger.error(`Error executing tool ${toolUse.name}:`, error);
      return {
        content: { error: error.message },
        isError: true
      };
    }
  }

  /**
   * Convert MCP tool servers to Anthropic tool format
   */
  convertToolsToAnthropicFormat(builtInTools, dynamicTools) {
    const tools = [];

    // Convert built-in tools
    for (const [toolName, toolDef] of Object.entries(builtInTools.tools)) {
      tools.push({
        name: toolName,
        description: toolDef.description,
        input_schema: this.zodToJsonSchema(toolDef.inputSchema)
      });
    }

    // Convert dynamic tools
    if (dynamicTools && dynamicTools.tools) {
      for (const [toolName, toolDef] of Object.entries(dynamicTools.tools)) {
        tools.push({
          name: toolName,
          description: toolDef.description,
          input_schema: this.zodToJsonSchema(toolDef.inputSchema)
        });
      }
    }

    return tools;
  }

  /**
   * Convert Zod schema to JSON schema for Anthropic
   */
  zodToJsonSchema(zodSchema) {
    // Simple conversion - in production, use a library like zod-to-json-schema
    // For now, we'll use a basic approach
    if (zodSchema._def && zodSchema._def.typeName === 'ZodObject') {
      const properties = {};
      const required = [];
      const shape = zodSchema._def.shape();

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = this.zodTypeToJsonSchema(value);
        if (!value.isOptional()) {
          required.push(key);
        }
      }

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      };
    }

    return { type: 'object' };
  }

  //TODO: try to remove this since its duplicate with the ZodToStructuredOutputConverter.js
  /**
   * Convert individual Zod type to JSON schema type
   */
  zodTypeToJsonSchema(zodType) {
    const typeName = zodType._def?.typeName;

    switch (typeName) {
      case 'ZodString':
        return {
          type: 'string',
          description: zodType._def.description
        };
      case 'ZodNumber':
        return {
          type: 'number',
          description: zodType._def.description
        };
      case 'ZodBoolean':
        return {
          type: 'boolean',
          description: zodType._def.description
        };
      case 'ZodArray':
        return {
          type: 'array',
          items: this.zodTypeToJsonSchema(zodType._def.type),
          description: zodType._def.description
        };
      case 'ZodObject':
        return this.zodToJsonSchema(zodType);
      case 'ZodEnum':
        return {
          type: 'string',
          enum: zodType._def.values,
          description: zodType._def.description
        };
      case 'ZodOptional':
        return this.zodTypeToJsonSchema(zodType._def.innerType);
      default:
        return {
          type: 'string',
          description: zodType._def?.description
        };
    }
  }

  /**
   * Check if a tool is a built-in tool
   */
  isBuiltInTool(toolName, builtInTools) {
    return toolName in builtInTools.tools;
  }

  /**
   * Set runtime directives
   */
  setRuntimeDirectives(directives) {
    this.sessionManager.setRuntimeDirectives(this.sessionId, directives);
  }

  /**
   * Get agent capabilities for session_ready message
   */
  getAgentCapabilities() {
    const session = this.sessionManager.getSession(this.sessionId);
    const model = session?.clientModel;

    return {
      builtInTools: getBuiltInToolNames(),
      clientTools: this.dynamicToolServer.getClientToolNames(),
      modelSummary: model ? this.summarizeModel(model) : undefined
    };
  }

  /**
   * Summarize model for capabilities
   */
  summarizeModel(model) {
    const variables = model.variables || [];

    return {
      variableCount: variables.length,
      stockCount: variables.filter(v => v.type === 'stock').length,
      flowCount: variables.filter(v => v.type === 'flow').length,
      hasModules: (model.modules && model.modules.length > 0) || false
    };
  }
}
