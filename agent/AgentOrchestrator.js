import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { marked } from 'marked';
import { countTokens } from '@anthropic-ai/tokenizer';
import { AgentConfigurationManager } from './utilities/AgentConfigurationManager.js';
import { BuiltInToolProvider } from './tools/BuiltInToolProvider.js';
import { DynamicToolProvider } from './tools/DynamicToolProvider.js';
import {
  createAgentTextMessage,
  createToolCallNotificationMessage,
  createToolCallCompletedMessage,
  createAgentCompleteMessage,
  createErrorMessage
} from './utilities/MessageProtocol.js';
import logger from '../utilities/logger.js';
import config from '../config.js';

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
    this.stopRequested = false;

    // SDK-specific properties (for SDK mode)
    this.abortController = null;
    this.sdkSessionId = null; // SDK session ID for conversation continuity
    this.pendingToolCalls = new Map(); // Track tool_use_id -> tool_name mapping

    // Load configuration
    this.configManager = new AgentConfigurationManager(configPath);

    // Create tool providers
    this.builtInToolProvider = new BuiltInToolProvider(sessionManager, sessionId, sendToClient);
    this.dynamicToolProvider = new DynamicToolProvider(sessionManager, sessionId, sendToClient);

    // Initialize Anthropic client (for non-SDK mode)
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });

    logger.log(`AgentOrchestrator initialized for session ${sessionId} (useAgentSDK: ${this.configManager.getUseAgentSDK()})`);
  }

  /**
   * Start a conversation with the agent
   */
  async startConversation(userMessage, previousAgentContext = null) {
    try {
      const session = this.sessionManager.getSession(this.sessionId);
      if (!session) {
        throw new Error(`Session not found: ${this.sessionId}`);
      }

      const useAgentSDK = this.configManager.getUseAgentSDK();
      logger.log(`Starting conversation for session ${this.sessionId} (mode: ${useAgentSDK ? 'SDK' : 'manual'})`);
      logger.log(`Built-in tools: ${this.builtInToolProvider.getToolNames().join(', ')}`);
      logger.log(`Client tools: ${this.dynamicToolProvider.getToolNames().join(', ')}`);

      // Branch based on agent configuration
      if (useAgentSDK) {
        await this.startConversationWithSDK(userMessage, previousAgentContext);
      } else {
        if (previousAgentContext?.length > 0) {
          // previousAgentContext is a reference to the live context — pop the last message
          // (always the prior agent's unanswered user message) before adding the new one
          previousAgentContext.pop();
          logger.debug(`[Agent switch → manual] Prior context now has ${previousAgentContext.length} messages after pop`);
        }
        await this.startConversationManual(userMessage);
      }

    } catch (error) {
      logger.error(`Error in agent conversation for session ${this.sessionId}:`, error);

      await this.sendToClient(createErrorMessage(
        this.sessionId,
        error.message,
        'CONVERSATION_ERROR'
      ));
    }
  }

  /**
   * Start conversation using manual agent loop (original implementation)
   */
  async startConversationManual(userMessage) {
    const session = this.sessionManager.getSession(this.sessionId);

    // Add user message to conversation history
    this.sessionManager.addToConversationHistory(this.sessionId, {
      role: 'user',
      content: userMessage
    });

    // Build system prompt from config
    const mode = session.mode;
    const systemPrompt = this.configManager.buildSystemPrompt(mode);

    // Get tool collections
    const builtInTools = this.builtInToolProvider.getTools();
    const dynamicTools = this.dynamicToolProvider.getTools();

    // Start agent conversation loop
    await this.runAgentConversation(userMessage, systemPrompt, builtInTools, dynamicTools);
  }

  /**
   * Start conversation using Claude Agent SDK
   */
  async startConversationWithSDK(userMessage, previousAgentContext = null) {
    const session = this.sessionManager.getSession(this.sessionId);
    const mode = session.mode;

    // Track user message for cross-mode replay (SDK → manual on future switch)
    this.sessionManager.addToConversationHistory(this.sessionId, {
      role: 'user',
      content: userMessage
    });

    let systemPrompt = this.configManager.buildSystemPrompt(mode);

    // Check model token count and handle large models (for SDK mode)
    const currentModel = session?.clientModel;
    let modelTokenCount = 0;

    if (currentModel) {
      const modelJson = JSON.stringify(currentModel, null, 2);
      modelTokenCount = countTokens(modelJson);
      this.sessionManager.updateModelTokenCount(this.sessionId, modelTokenCount);
      const modelExceedsLimit = modelTokenCount > config.agentMaxTokensForEngines;

      logger.log(`Model token count: ${modelTokenCount} (limit: ${config.agentMaxTokensForEngines}, exceeds: ${modelExceedsLimit})`);

      if (modelExceedsLimit) {
        const generateTool = mode === 'sfd' ? 'generate_quantitative_model' : 'generate_qualitative_model';
        systemPrompt += `\n\n**IMPORTANT: Model Size Notice**\n\nThe current model has exceeded ${config.agentMaxTokensForEngines} tokens (${modelTokenCount} tokens). The \`${generateTool}\` tool has been disabled. Call \`get_current_model\` to load the model to disk, then use \`read_model_section\` and \`edit_model_section\` to inspect and modify it.`;
      }
    }

    await this.runAgentConversationWithSDK(userMessage, systemPrompt, modelTokenCount, previousAgentContext);
  }

  /**
   * Run agent conversation using Claude Agent SDK
   */
  async runAgentConversationWithSDK(userMessage, systemPrompt, modelTokenCount, previousAgentContext = null) {
    // Create abort controller for stop iteration
    this.abortController = new AbortController();

    const mode = this.sessionManager.getSession(this.sessionId)?.mode;

    const maxIterations = this.configManager.getMaxIterations();

    try {
      // Build tools list - combine SDK filesystem tools with MCP servers
      const builtInSdkTools = ['Read', 'Edit', 'Write', 'Glob', 'Grep'];

      let mcpServers = {
        builtin: this.builtInToolProvider.getMcpServer()
      };

      // Get client MCP server and derive allowed tool names from the same source
      const clientMcpServer = this.dynamicToolProvider.getMcpServer();
      const clientToolNames = this.dynamicToolProvider.getToolNames(); // client_* prefixed, used for system prompt
      const prefixedClientToolNames = clientToolNames.map(name => `mcp__client__${name.replace(/^client_/, '')}`);
      if (clientMcpServer) {
        mcpServers.client = clientMcpServer;
      }

      // Build allowed tools list with MCP prefixes, filtered by mode and model token count
      const allBuiltInTools = this.builtInToolProvider.getTools();
      const builtInToolNames = this.builtInToolProvider.getToolNames()
        .filter(name => {
          const toolDef = allBuiltInTools.tools[name];
          if (toolDef?.nonSdkOnly) return false;
          if (toolDef?.supportedModes && !toolDef.supportedModes.includes(mode)) return false;
          if (toolDef?.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) return false;
          if (toolDef?.minModelTokens && modelTokenCount < toolDef.minModelTokens) return false;
          return true;
        })
        .map(name => `mcp__builtin__${name}`);
      let allowedTools = [
        ...builtInSdkTools,      // SDK filesystem tools (no prefix)
        ...builtInToolNames,     // Built-in tools with mcp__builtin__ prefix
        ...prefixedClientToolNames // Client tools with mcp__client__ prefix
      ];

      logger.debug("Allowed tools are: " + allowedTools.join(', '));

      // Prefix tool names in system prompt
      systemPrompt = this.prefixToolNamesInSystemPrompt(systemPrompt, builtInToolNames, clientToolNames);

      // Build query options with MCP servers
      const queryOptions = {
        abortController: this.abortController,
        systemPrompt: systemPrompt,
        model: config.agentModel,
        maxTokens: 8192,
        maxTurns: maxIterations,
        mcpServers: mcpServers,
        allowedTools: allowedTools,
        permissionMode: 'bypassPermissions',
        compact: true  // Enable automatic compaction
      };

      // If we have an SDK session ID, resume the conversation
      if (this.sdkSessionId) {
        queryOptions.resume = this.sdkSessionId;
        logger.log(`Resuming SDK conversation with session_id: ${this.sdkSessionId}`);
      } else {
        logger.log(`Starting new SDK conversation`);
      }

      // Build prompt - inject prior agent's history as plain string prefix on agent switch
      let prompt = userMessage;
      if (previousAgentContext?.length > 0 && !this.sdkSessionId) {
        const contextToReplay = previousAgentContext.slice(0, -1);
        if (contextToReplay.length > 0) {
          logger.debug(`[Agent switch → SDK] Replaying ${contextToReplay.length} messages from prior agent.`);
          const contextText = await this.buildPriorContextText(contextToReplay);
          prompt = `[Prior conversation context]\n${contextText}\n[End of prior context]\n\n${userMessage}`;
        }
      }

      // Create query iterator with Agent SDK
      const queryIterator = query({
        prompt,
        options: queryOptions
      });

      // Process messages from SDK
      for await (const message of queryIterator) {
        await this.handleSdkMessage(message);
      }

      // Normal completion
      logger.log(`Agent conversation completed successfully for session ${this.sessionId}`);
      await this.sendToClient(createAgentCompleteMessage(
        this.sessionId,
        'success',
        'Task completed successfully'
      ));

    } catch (error) {
      if (error.name === 'AbortError' || this.stopRequested) {
        logger.log(`Agent iteration stopped by user request for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(
          this.sessionId,
          'awaiting_user',
          'Agent stopped by user request'
        ));
      } else {
        logger.error('Error in agent conversation loop:', error);
        await this.sendToClient(createErrorMessage(
          this.sessionId,
          `Agent error: ${error.message}`,
          'AGENT_ERROR'
        ));
        await this.sendToClient(createAgentCompleteMessage(
          this.sessionId,
          'awaiting_user',
          `Agent error: ${error.message}`
        ));
      }
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Determine the response type for a completed tool call (using stripped tool name)
   */
  #getResponseType(displayName) {
    if (['generate_ltm_narrative'].includes(displayName)) return 'ltm-discuss';
    if (['discuss_model_with_seldon', 'discuss_model_across_runs', 'discuss_with_mentor'].includes(displayName)) return 'discuss';
    if (['generate_quantitative_model', 'generate_qualitative_model', 'generate_documentation'].includes(displayName)) return 'model';
    return 'other';
  }

  /**
   * Remove MCP prefix from tool names for client display
   */
  stripMcpPrefix(toolName) {
    if (toolName.startsWith('mcp__builtin__')) {
      return toolName.substring('mcp__builtin__'.length);
    }
    if (toolName.startsWith('mcp__client__')) {
      return toolName.substring('mcp__client__'.length);
    }
    return toolName;
  }

  /**
   * Handle messages from Agent SDK
   */
  async handleSdkMessage(message) {
    switch (message.type) {
      case 'assistant':
        await this.handleAssistantMessage(message);
        break;

      case 'result':
        await this.handleResultMessage(message);
        break;

      case 'system':
        if (message.subtype === 'init') {
          if (message.session_id) {
            this.sdkSessionId = message.session_id;
            logger.log(`SDK initialized for session ${this.sessionId}, SDK session_id: ${this.sdkSessionId}`);
          }
        } else if (message.subtype === 'error') {
          logger.error(`SDK system error for session ${this.sessionId}:`, message.error || message);
          await this.sendToClient(createErrorMessage(
            this.sessionId,
            message.error?.message || 'SDK system error',
            'SDK_SYSTEM_ERROR'
          ));
        } else {
          logger.log(`Unhandled system message subtype: ${message.subtype}`, message);
        }
        break;

      case 'user':
        await this.handleUserMessage(message);
        break;

      default:
        logger.log(`Unhandled SDK message type: ${message.type}`, message);
    }
  }

  /**
   * Handle assistant messages (text from Claude)
   */
  async handleAssistantMessage(message) {
    const content = message.message?.content;
    const rawTextParts = [];

    if (content && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          rawTextParts.push(block.text);
          const html = await marked.parse(block.text);
          await this.sendToClient(createAgentTextMessage(this.sessionId, html, false));
        }
        else if (block.type === 'thinking' && block.thinking) {
          //claude code is too chatty -- don't send these!
          /*const html = await marked.parse(block.thinking);
          await this.sendToClient(createAgentTextMessage(this.sessionId, html, true));*/
        }
        else if (block.type === 'tool_use' && block.name) {
          this.pendingToolCalls.set(block.id, block.name);

          const isFilesystemTool = ['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(block.name);
          const isBuiltInMcpTool = block.name.startsWith('mcp__builtin__');
          const isBuiltIn = isFilesystemTool || isBuiltInMcpTool;

          const displayName = this.stripMcpPrefix(block.name);

          await this.sendToClient(createToolCallNotificationMessage(
            this.sessionId,
            block.id,
            displayName,
            block.input || {},
            isBuiltIn
          ));

          logger.log(`Tool use notification sent: ${block.name} (${block.id}) - isBuiltIn: ${isBuiltIn}`);
        }
        else if (block.type === 'tool_result' && block.tool_use_id) {
          const toolName = this.pendingToolCalls.get(block.tool_use_id) || 'unknown';
          const displayName = this.stripMcpPrefix(toolName);

          // Log errors more prominently
          if (block.is_error) {
            logger.error(`Tool error for ${toolName} (${block.tool_use_id}):`, block.content);
          } else {
            logger.log(`Tool result received in assistant message for ${toolName} (${block.tool_use_id})`);
          }

          const responseType = this.#getResponseType(displayName);

          await this.sendToClient(createToolCallCompletedMessage(
            this.sessionId,
            block.tool_use_id,
            displayName,
            block.content,
            block.is_error || false,
            responseType
          ));

          this.pendingToolCalls.delete(block.tool_use_id);
        }
      }
    }

    // Track client-facing text for cross-mode replay (SDK → manual)
    if (rawTextParts.length > 0) {
      this.sessionManager.addToConversationHistory(this.sessionId, {
        role: 'assistant',
        content: rawTextParts.join('\n')
      });
    }
  }

  /**
   * Handle user messages (tool results being sent back to Claude)
   */
  async handleUserMessage(message) {
    const content = message.message?.content;

    if (content && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolName = this.pendingToolCalls.get(block.tool_use_id) || 'unknown';
          const displayName = this.stripMcpPrefix(toolName);

          // Log errors more prominently
          if (block.is_error) {
            logger.error(`Tool error for ${toolName} (${block.tool_use_id}):`, block.content);
          } else {
            if (toolName === 'ToolSearch') {
              logger.log(`Tool result received for ${toolName} (${block.tool_use_id}):`, JSON.stringify(block.content));
            } else {
              logger.log(`Tool result received for ${toolName} (${block.tool_use_id})`);
            }
          }

          const responseType = this.#getResponseType(displayName);

          await this.sendToClient(createToolCallCompletedMessage(
            this.sessionId,
            block.tool_use_id,
            displayName,
            block.content,
            block.is_error || false,
            responseType
          ));

          this.pendingToolCalls.delete(block.tool_use_id);
        }
      }
    }
  }

  /**
   * Handle result messages (conversation completion)
   */
  async handleResultMessage(message) {
    if (message.subtype === 'success') {
      logger.log(`SDK conversation completed successfully for session ${this.sessionId}`);
    } else if (message.subtype === 'error') {
      logger.error(`SDK conversation error for session ${this.sessionId}:`, message.error || message);
    } else if (message.subtype === 'tool_error') {
      logger.error(`SDK tool error for session ${this.sessionId}:`, message);
    } else {
      logger.log(`Unhandled result message subtype: ${message.subtype}`, message);
    }
  }

  /**
   * Prefix tool names in system prompt for SDK mode
   * Scans the system prompt and adds mcp__ prefixes to tool names
   */
  prefixToolNamesInSystemPrompt(systemPrompt, builtInToolNames, clientToolNames) {
    let modifiedPrompt = systemPrompt;

    // Create mapping of unprefixed tool names to prefixed versions
    const toolNameMapping = {};

    // Built-in tools: tool_name -> mcp__builtin__tool_name
    for (const prefixedName of builtInToolNames) {
      const unprefixedName = prefixedName.replace(/^mcp__builtin__/, '');
      toolNameMapping[unprefixedName] = prefixedName;
    }

    // Client tools: client_tool_name -> mcp__client__tool_name
    for (const clientToolName of clientToolNames) {
      const unprefixedName = clientToolName.replace(/^client_/, '');
      const prefixedName = `mcp__client__${unprefixedName}`;
      toolNameMapping[clientToolName] = prefixedName;
      // Also map the unprefixed name
      toolNameMapping[unprefixedName] = prefixedName;
    }

    // Replace tool names in the system prompt
    // Look for patterns like `tool_name` or **tool_name** or tool_name (surrounded by word boundaries)
    for (const [unprefixed, prefixed] of Object.entries(toolNameMapping)) {
      // Match tool names in backticks, bold, or standalone
      const patterns = [
        new RegExp(`\`${unprefixed}\``, 'g'),           // `tool_name`
        new RegExp(`\\*\\*${unprefixed}\\*\\*`, 'g'),   // **tool_name**
        new RegExp(`\\b${unprefixed}\\b`, 'g')          // tool_name (word boundary)
      ];

      for (const pattern of patterns) {
        modifiedPrompt = modifiedPrompt.replace(pattern, (match) => {
          // Preserve the formatting around the tool name
          return match.replace(unprefixed, prefixed);
        });
      }
    }

    return modifiedPrompt;
  }

  /**
   * Run agent conversation with tool calling support
   * Uses Anthropic SDK directly with agentic loop
   */
  async runAgentConversation(_userMessage, systemPrompt, builtInTools, dynamicTools) {
    // Clean up context (remove stale models, summarize if over limit) before first API call
    await this.sessionManager.cleanupContext(this.sessionId, config.agentMaxContextTokens);

    // Use the live session context as the messages array — no local copy
    const messages = this.sessionManager.getConversationContext(this.sessionId);

    // Check model token count and update session state
    const session = this.sessionManager.getSession(this.sessionId);
    const currentModel = session?.clientModel;
    const mode = session?.mode;
    let modelTokenCount = 0;

    if (currentModel) {
      const modelJson = JSON.stringify(currentModel, null, 2);
      modelTokenCount = countTokens(modelJson);
      this.sessionManager.updateModelTokenCount(this.sessionId, modelTokenCount);
      const modelExceedsLimit = modelTokenCount > config.agentMaxTokensForEngines;

      logger.log(`Model token count: ${modelTokenCount} (limit: ${config.agentMaxTokensForEngines}, exceeds: ${modelExceedsLimit})`);

      if (modelExceedsLimit) {
        const generateTool = mode === 'sfd' ? 'generate_quantitative_model' : 'generate_qualitative_model';
        systemPrompt += `\n\n**IMPORTANT: Model Size Notice**\n\nThe current model has exceeded ${config.agentMaxTokensForEngines} tokens (${modelTokenCount} tokens). The \`${generateTool}\` tool has been disabled. Call \`get_current_model\` to load the model to disk, then use \`read_model_section\` and \`edit_model_section\` to inspect and modify it.`;
      }
    }

    // Convert tool servers to Anthropic tool format (with conditional filtering)
    const tools = this.convertToolsToAnthropicFormat(builtInTools, dynamicTools, modelTokenCount, mode);

    let continueLoop = true;
    const maxIterations = this.configManager.getMaxIterations();
    let iteration = 0;
    let overloadedRetries = 0; // max 3 total per conversation turn

    while (continueLoop && iteration < maxIterations && !this.stopRequested) {
      iteration++;

      // Summarize context in-place if it has grown over the token limit
      await this.sessionManager.cleanupContext(this.sessionId, config.agentMaxContextTokens);

      try {
        // Call Claude API
        const response = await this.anthropic.messages.create({
          model: config.agentModel,
          max_tokens: 8192,
          system: systemPrompt,
          messages: messages,
          tools: tools.length > 0 ? tools : undefined
        });

        // Check if stop was requested during the API call
        if (this.stopRequested) {
          logger.log(`Stop requested during API call for session ${this.sessionId}`);
          break;
        }

        // Process response
        continueLoop = await this.processAgentResponse(response, messages, builtInTools, dynamicTools);

        // Check if stop was requested during response processing
        if (this.stopRequested) {
          logger.log(`Stop requested during response processing for session ${this.sessionId}`);
          break;
        }

      } catch (error) {
        const isOverloaded = error?.status === 529 || error?.error?.type === 'overloaded_error';
        if (isOverloaded && overloadedRetries < 3) {
          overloadedRetries++;
          logger.warn(`Anthropic API overloaded (529), retry ${overloadedRetries}/3`);
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            'The AI service is temporarily overloaded. Retrying...'
          ));
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else if (isOverloaded) {
          logger.error('Anthropic API overloaded (529) after 3 retries, giving up');
          await this.sendToClient(createErrorMessage(
            this.sessionId,
            'The AI service is overloaded. Please try again later.',
            'AGENT_ERROR'
          ));
          await this.sendToClient(createAgentCompleteMessage(
            this.sessionId,
            'awaiting_user',
            'Agent stopped due to overloaded API'
          ));
          continueLoop = false;
        } else {
          logger.error('Error in agent conversation loop:', error);
          await this.sendToClient(createErrorMessage(
            this.sessionId,
            `Agent error: ${error.message}`,
            'AGENT_ERROR'
          ));
          await this.sendToClient(createAgentCompleteMessage(
            this.sessionId,
            'awaiting_user',
            'Agent stopped due to error'
          ));
          continueLoop = false;
        }
      }
    }

    if (this.stopRequested) {
      logger.log(`Agent iteration stopped by user request for session ${this.sessionId}`);
      this.stopRequested = false; // Reset for next conversation

      // Send agent_complete message to notify client that agent has stopped
      await this.sendToClient(createAgentCompleteMessage(
        this.sessionId,
        'awaiting_user',
        'Agent stopped by user request'
      ));
    } else if (iteration >= maxIterations) {
      logger.warn(`Agent conversation reached max iterations (${maxIterations})`);

      // Send agent_complete message when max iterations reached
      await this.sendToClient(createAgentCompleteMessage(
        this.sessionId,
        'awaiting_user',
        `Reached maximum iterations (${maxIterations})`
      ));
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
      // Check if stop was requested before processing each block
      if (this.stopRequested) {
        logger.log(`Stop requested during content block processing for session ${this.sessionId}`);
        return false; // Stop processing immediately
      }

      if (block.type === 'text') {
        // Send text content to client
        const text = await marked.parse(block.text);

        await this.sendToClient(createAgentTextMessage(
          this.sessionId,
          text,
          false
        ));

        // Append to the live session context (messages IS the session context)
        if (!messages[messages.length - 1] || messages[messages.length - 1].role !== 'assistant') {
          messages.push({ role: 'assistant', content: [] });
        }
        messages[messages.length - 1].content.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        hasToolCalls = true;

        logger.debug(`Tool call: ${block.name} (${block.id}) input: ${JSON.stringify(block.input)}`);

        // Notify client that tool call is happening (for UI display)
        const isBuiltIn = this.isBuiltInTool(block.name, builtInTools);
        await this.sendToClient(createToolCallNotificationMessage(
          this.sessionId,
          block.id,
          block.name,
          block.input,
          isBuiltIn
        ));

        // Send additional text notification for slow tools
        if (block.name === 'create_visualization') {
          const vizType = block.input.useAICustom ? 'AI-generated custom' : (block.input.type || 'standard');
          const title = block.input.title || 'visualization';
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Creating ${vizType} visualization: "${title}"... This may take a moment.`,
            false
          ));
        } else if (block.name === 'get_variable_data') {
          const varCount = block.input.variableNames?.length || 0;
          const runCount = block.input.runIds?.length || 0;
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Retrieving data for ${varCount} variable${varCount !== 1 ? 's' : ''} from ${runCount} run${runCount !== 1 ? 's' : ''}...`,
            false
          ));
        } else if (block.name === 'get_feedback_information') {
          const runCount = block.input.runIds?.length || 0;
          const runText = runCount === 0 ? 'all runs' : `${runCount} run${runCount !== 1 ? 's' : ''}`;
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Analyzing feedback loops for ${runText}... This may take a moment.`,
            false
          ));
        } else if (block.name === 'run_model') {
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Running model simulation...`,
            false
          ));
        } else if (block.name === 'discuss_model_with_seldon') {
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Consulting Seldon for expert analysis...`,
            false
          ));
        } else if (block.name === 'discuss_model_across_runs') {
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Analyzing model behavior across runs...`,
            false
          ));
        } else if (block.name === 'discuss_with_mentor') {
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            `Consulting Seldon mentor for guidance...`,
            false
          ));
        }

        // Execute tool
        const toolResult = await this.executeToolCall(block, builtInTools, dynamicTools);

        // Check if stop was requested during tool execution
        if (this.stopRequested) {
          logger.log(`Stop requested during tool execution for session ${this.sessionId}`);
          return false; // Stop processing immediately
        }

        const responseType = this.#getResponseType(block.name);

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

        // Add tool_result following Claude's API requirements
        const resultText = Array.isArray(toolResult.content)
          ? toolResult.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
          : toolResult.content;
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultText,
            is_error: toolResult.isError || false
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
   * Build prior-history context text, summarizing if it exceeds the token budget.
   * Used when injecting prior agent context into an SDK session.
   */
  async buildPriorContextText(history) {
    const PRIOR_CONTEXT_TOKEN_LIMIT = 10_000;
    const tokenCount = countTokens(JSON.stringify(history));

    if (tokenCount > PRIOR_CONTEXT_TOKEN_LIMIT) {
      logger.log(`Prior agent context too large (${tokenCount} tokens), summarizing before SDK injection`);
      try {
        const conversationText = history.map((msg) => {
          if (msg.role === 'user') {
            return `User: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`;
          } else if (msg.role === 'assistant') {
            if (Array.isArray(msg.content)) {
              const textContent = msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
              return textContent ? `Assistant: ${textContent}` : '';
            }
            return `Assistant: ${msg.content}`;
          }
          return '';
        }).filter(line => line).join('\n\n');

        const response = await this.anthropic.messages.create({
          model: config.agentSummaryModel,
          max_tokens: 2048,
          messages: [{
            role: 'user',
            content: `Summarize this conversation history concisely (2-4 paragraphs):\n\n${conversationText}`
          }]
        });
        return response.content[0].text;
      } catch (error) {
        logger.error('Error summarizing prior context:', error);
        return '[Prior conversation condensed due to size]';
      }
    }

    return history.map(msg => {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      return `${role}: ${text}`;
    }).join('\n\n');
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
        // Handler already returns { content: [...], isError: bool }
        return result;
      }

      // Check if it's a client tool
      if (this.dynamicToolProvider.isClientTool(toolUse.name)) {
        const unprefixedName = toolUse.name.replace(/^client_/, '');
        const result = await this.dynamicToolProvider.requestClientExecution(
          unprefixedName,
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
   * Convert tool servers to Anthropic tool format
   */
  convertToolsToAnthropicFormat(builtInTools, dynamicTools, modelTokenCount = 0, mode = null) {
    const tools = [];
    const toolNames = new Set();

    // Convert built-in tools
    for (const [toolName, toolDef] of Object.entries(builtInTools.tools)) {
      if (toolNames.has(toolName)) {
        logger.warn(`Duplicate tool name detected: ${toolName} (from built-in tools)`);
        continue;
      }

      // Skip tools that don't support the current mode
      if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) {
        logger.log(`Excluding tool ${toolName} - not supported in mode: ${mode}`);
        continue;
      }

      // Skip tools whose model token constraints aren't met
      if (toolDef.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) {
        logger.log(`Excluding tool ${toolName} - model token count ${modelTokenCount} exceeds max ${toolDef.maxModelTokens}`);
        continue;
      }
      if (toolDef.minModelTokens && modelTokenCount < toolDef.minModelTokens) {
        logger.log(`Excluding tool ${toolName} - model token count ${modelTokenCount} below min ${toolDef.minModelTokens}`);
        continue;
      }

      toolNames.add(toolName);

      tools.push({
        name: toolName,
        description: toolDef.description,
        input_schema: toolDef.inputSchema.toJSONSchema()
      });
    }

    // Convert dynamic tools (client tools)
    if (dynamicTools && dynamicTools.tools) {
      for (const [toolName, toolDef] of Object.entries(dynamicTools.tools)) {
        if (toolNames.has(toolName)) {
          logger.warn(`Duplicate tool name detected: ${toolName} (from client tools) - skipping client version, using built-in`);
          continue;
        }
        toolNames.add(toolName);

        tools.push({
          name: toolName,
          description: toolDef.description,
          input_schema: toolDef.inputSchema.toJSONSchema()
        });
      }
    }

    return tools;
  }

  /**
   * Check if a tool is a built-in tool
   */
  isBuiltInTool(toolName, builtInTools) {
    return toolName in builtInTools.tools;
  }
  /**
   * Get agent capabilities for session_ready message
   */
  getAgentCapabilities() {
    return {
      builtInTools: this.builtInToolProvider.getToolNames(),
      clientTools: this.dynamicToolProvider.getToolNames()
    };
  }

  /**
   * Destroy the orchestrator and cleanup resources
   */
  /**
   * Request the agent to stop iterating
   */
  stopIteration() {
    logger.log(`Stop iteration requested for session ${this.sessionId}`);
    this.stopRequested = true;
    this.abortController?.abort();
  }

  destroy() {
    logger.log(`AgentOrchestrator destroyed for session ${this.sessionId}`);

    // Clear any references
    this.sessionManager = null;
    this.sendToClient = null;
    this.builtInToolProvider = null;
    this.dynamicToolProvider = null;
    this.anthropic = null;
    this.configManager = null;
  }
}
