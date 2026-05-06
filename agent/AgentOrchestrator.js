import Anthropic from '@anthropic-ai/sdk';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { GoogleGenAI } from '@google/genai';
import { LlmAgent, Runner, InMemorySessionService, isFinalResponse } from '@google/adk';
import { encode } from 'gpt-tokenizer';
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
import { LLMWrapper } from '../utilities/LLMWrapper.js';
import TokenUsageReporter from '../utilities/TokenUsageReporter.js';
import { sanitizeSchemaForGemini } from './tools/builtin/toolHelpers.js';

// Normalize a single message to Gemini format {role:'user'|'model', parts:[{text}]}.
// Handles Anthropic-format messages ({role, content}) that arrive when switching
// from an Anthropic-mode agent or from client-provided historical messages.
function toGeminiMessage(msg) {
  if (Array.isArray(msg.parts)) {
    const role = msg.role === 'assistant' ? 'model' : msg.role;
    return role === msg.role ? msg : { ...msg, role };
  }
  const role = msg.role === 'assistant' ? 'model' : msg.role;
  let text = '';
  if (typeof msg.content === 'string') {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
  }
  return { role, parts: [{ text }] };
}

// Normalize a single message to Anthropic format {role:'user'|'assistant', content}.
// Handles Gemini-format messages ({role:'user'|'model', parts}) that arrive when
// switching from a Gemini-mode agent.
function toAnthropicMessage(msg) {
  if (!Array.isArray(msg.parts)) {
    const role = msg.role === 'model' ? 'assistant' : msg.role;
    return role === msg.role ? msg : { ...msg, role };
  }
  const role = msg.role === 'model' ? 'assistant' : msg.role;
  const text = msg.parts.filter(p => p.text).map(p => p.text).join('\n');
  return { role, content: text };
}

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
  #geminiManualCacheName = null;
  #geminiManualCacheKey = null;

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

    this.gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.adkSessionId = null;
    this.adkSessionService = new InMemorySessionService();

    const clientId = sessionManager.getSession(sessionId)?.clientId ?? null;
    this.llm = new LLMWrapper({ clientId, underlyingModel: config.agentAnthropicSummaryModel });
    this.tokenReporter = new TokenUsageReporter(config.tokenReporterURL, clientId);

    logger.log(`AgentOrchestrator initialized for session ${sessionId} (agent_mode: ${this.configManager.getAgentMode()})`);
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

      const agentMode = this.configManager.getAgentMode();
      logger.log(`Starting conversation for session ${this.sessionId} (agent_mode: ${agentMode})`);

      await this.#fetchCurrentModel();

      const isManual = agentMode === 'anthropic-manual' || agentMode === 'gemini-manual';
      if (isManual && previousAgentContext?.length > 0) {
        // previousAgentContext is a reference to the live context — pop the last message
        // (always the prior agent's unanswered user message) before adding the new one
        previousAgentContext.pop();
        logger.debug(`[Agent switch → manual] Prior context now has ${previousAgentContext.length} messages after pop`);
      }

      switch (agentMode) {
        case 'anthropic-sdk':
          await this.startConversationWithAnthropicSDK(userMessage, previousAgentContext);
          break;
        case 'anthropic-manual':
          await this.startConversationAnthropicManual(userMessage);
          break;
        case 'gemini-adk':
          await this.startConversationWithADK(userMessage, previousAgentContext);
          break;
        case 'gemini-manual':
          await this.startConversationGeminiManual(userMessage);
          break;
        default:
          throw new Error(`Unknown agent_mode: ${agentMode}`);
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
  async startConversationAnthropicManual(userMessage) {
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
    await this.runAgentConversationAnthropicManual(userMessage, systemPrompt, builtInTools, dynamicTools);
  }

  /**
   * Start conversation using Claude Agent SDK
   */
  async startConversationWithAnthropicSDK(userMessage, previousAgentContext = null) {
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
    }

    await this.runAgentConversationWithAnthropicSDK(userMessage, systemPrompt, modelTokenCount, previousAgentContext);
  }

  /**
   * Run agent conversation using Claude Agent SDK
   */
  async runAgentConversationWithAnthropicSDK(userMessage, systemPrompt, modelTokenCount, previousAgentContext = null) {
    // Create abort controller for stop iteration
    this.abortController = new AbortController();
    this.maxTurnsReached = false;

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

      // Prefix tool names in system prompt
      systemPrompt = this.anthropicSDKPrefixToolNamesInSystemPrompt(systemPrompt, builtInToolNames, clientToolNames);

      // Build query options with MCP servers
      const queryOptions = {
        abortController: this.abortController,
        systemPrompt: systemPrompt,
        model: config.agentAnthropicModel,
        maxTokens: 8192,
        maxTurns: maxIterations,
        mcpServers: mcpServers,
        allowedTools: allowedTools,
        permissionMode: 'bypassPermissions',
        thinking: config.agentAnthropicThinking,
        ...(config.agentAnthropicThinking?.type !== 'disabled' && { effort: config.agentAnthropicEffort }),
        compact: true  // Enable automatic compaction
      };

      // If we have an SDK session ID, resume the conversation
      if (this.sdkSessionId) {
        queryOptions.resume = this.sdkSessionId;
        logger.log(`Anthropic SDK: Resuming SDK conversation with session_id: ${this.sdkSessionId}`);
      } else {
        logger.log(`Anthropic SDK: Starting new SDK conversation`);
      }

      // Build prompt - inject prior agent's history as plain string prefix on agent switch
      let prompt = userMessage;
      if (previousAgentContext?.length > 0 && !this.sdkSessionId) {
        const contextToReplay = previousAgentContext.slice(0, -1).map(toAnthropicMessage);
        if (contextToReplay.length > 0) {
          logger.debug(`[Agent switch → SDK] Replaying ${contextToReplay.length} messages from prior agent.`);
          const contextText = await this.buildPriorContextTextAnthropic(contextToReplay);
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
        await this.handleAnthropicSdkMessage(message);
      }

      // Normal completion (or max turns reached)
      if (this.maxTurnsReached) {
        logger.log(`Anthropic SDK: Agent reached max iterations for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(
          this.sessionId,
          'awaiting_user',
          `Reached maximum iterations (${maxIterations})`
        ));
      } else {
        logger.log(`Anthropic SDK: Agent conversation completed successfully for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(
          this.sessionId,
          'success',
          'Task completed successfully'
        ));
      }

    } catch (error) {
      if (error.name === 'AbortError' || this.stopRequested) {
        logger.log(`Anthropic SDK: Agent iteration stopped by user request for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(
          this.sessionId,
          'awaiting_user',
          'Agent stopped by user request'
        ));
      } else if (error.message?.includes('maximum number of turns')) {
        logger.log(`Anthropic SDK: Agent reached max turns for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(
          this.sessionId,
          'awaiting_user',
          `Reached maximum iterations (${maxIterations})`
        ));
      } else {
        logger.error('Anthropic SDK: Error in agent conversation loop:', error);
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
  async handleAnthropicSdkMessage(message) {
    switch (message.type) {
      case 'assistant':
        await this.handleAnthropicSDKAssistantMessage(message);
        break;

      case 'result':
        await this.handleAnthropicSDKResultMessage(message);
        break;

      case 'system':
        if (message.subtype === 'init') {
          if (message.session_id) {
            this.sdkSessionId = message.session_id;
            logger.log(`Anthropic SDK initialized for session ${this.sessionId}, SDK session_id: ${this.sdkSessionId}`);
          }
        } else if (message.subtype === 'error') {
          logger.error(`Anthropic SDK system error for session ${this.sessionId}:`, message.error || message);
          await this.sendToClient(createErrorMessage(
            this.sessionId,
            message.error?.message || 'SDK system error',
            'SDK_SYSTEM_ERROR'
          ));
        } else {
          logger.warn(`Anthropic SDK Unhandled system message subtype: ${message.subtype}`, message);
        }
        break;

      case 'user':
        await this.handleAnthropicSDKUserMessage(message);
        break;

      default:
        logger.warn(`Anthropic SDK: Unhandled message type: ${message.type}`, message);
    }
  }

  /**
   * Handle assistant messages (text from Claude)
   */
  async handleAnthropicSDKAssistantMessage(message) {
    this.#logApiUsage('anthropic', message.message?.usage);
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
        }
        else if (block.type === 'tool_result' && block.tool_use_id) {
          const toolName = this.pendingToolCalls.get(block.tool_use_id) || 'unknown';
          const displayName = this.stripMcpPrefix(toolName);

          if (block.is_error) {
            logger.error(`Anthropic SDK: Tool error for ${toolName} (${block.tool_use_id}):`, block.content);
          } else {
            logger.log(`Anthropic SDK: Tool call completed: ${displayName}`);
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
  async handleAnthropicSDKUserMessage(message) {
    const content = message.message?.content;

    if (content && Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolName = this.pendingToolCalls.get(block.tool_use_id) || 'unknown';
          const displayName = this.stripMcpPrefix(toolName);

          if (block.is_error) {
            logger.error(`Anthropic SDK: Tool error for ${toolName} (${block.tool_use_id}):`, block.content);
          } else {
            logger.log(`Anthropic SDK: Tool call completed: ${displayName}`);
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
  async handleAnthropicSDKResultMessage(message) {
    if (message.subtype === 'success') {
      logger.log(`Anthropic SDK conversation completed successfully for session ${this.sessionId}`);
    } else if (message.subtype === 'error_max_turns') {
      logger.log(`Anthropic SDK conversation reached max iterations for session ${this.sessionId}`);
      this.maxTurnsReached = true;
    } else if (message.subtype === 'error') {
      logger.error(`Anthropic SDK conversation error for session ${this.sessionId}:`, message.error || message);
    } else if (message.subtype === 'tool_error') {
      logger.error(`Anthropic SDK tool error for session ${this.sessionId}:`, message);
    } else {
      logger.warn(`Anthropic SDK Unhandled result message subtype: ${message.subtype}`, message);
    }
  }

  /**
   * Prefix tool names in system prompt for SDK mode
   * Scans the system prompt and adds mcp__ prefixes to tool names
   */
  anthropicSDKPrefixToolNamesInSystemPrompt(systemPrompt, builtInToolNames, clientToolNames) {
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
  async runAgentConversationAnthropicManual(_userMessage, systemPrompt, builtInTools, dynamicTools) {
    // Clean up context (remove stale models, summarize if over limit) before first API call
    await this.sessionManager.cleanupContext(this.sessionId, config.agentMaxContextTokens);

    // Use the live session context as the messages array — no local copy
    const messages = this.sessionManager.getConversationContext(this.sessionId);

    // Normalize in-place: Gemini-format messages ({role:'user'|'model', parts}) from
    // historical session load or a prior Gemini-mode agent switch must become
    // Anthropic-format ({role:'user'|'assistant', content}) before the API call.
    for (let i = 0; i < messages.length; i++) {
      messages[i] = toAnthropicMessage(messages[i]);
    }

    // Check model token count and update session state
    const session = this.sessionManager.getSession(this.sessionId);
    const currentModel = session?.clientModel;
    const mode = session?.mode;
    let modelTokenCount = 0;

    if (currentModel) {
      const modelJson = JSON.stringify(currentModel, null, 2);
      modelTokenCount = countTokens(modelJson);
      this.sessionManager.updateModelTokenCount(this.sessionId, modelTokenCount);
    }

    const systemBlocks = [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral', ttl: '5m' } }
    ];

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
        const thinkingEnabled = config.agentAnthropicThinking?.type !== 'disabled';
        const response = await this.anthropic.messages.create({
          model: config.agentAnthropicModel,
          max_tokens: 8192,
          system: systemBlocks,
          messages: messages,
          thinking: config.agentAnthropicThinking,
          ...(thinkingEnabled && { effort: config.agentAnthropicEffort }),
          tools: tools.length > 0 ? tools : undefined
        });

        this.#logApiUsage('anthropic', response.usage);

        // Check if stop was requested during the API call
        if (this.stopRequested) {
          break;
        }

        // Process response
        continueLoop = await this.processAgentResponseAnthropicManual(response, messages, builtInTools, dynamicTools);

        // Check if stop was requested during response processing
        if (this.stopRequested) {
          break;
        }

      } catch (error) {
        const isOverloaded = error?.status === 529 || error?.error?.type === 'overloaded_error';
        const isNetworkError = error?.cause?.code === 'UND_ERR_SOCKET' || error?.code === 'UND_ERR_SOCKET' ||
          error?.code === 'ECONNRESET' || error?.cause?.code === 'ECONNRESET' ||
          (error instanceof TypeError && error.message === 'terminated');
        if ((isOverloaded || isNetworkError) && overloadedRetries < 3) {
          overloadedRetries++;
          const reason = isOverloaded ? 'overloaded (529)' : 'network error';
          logger.warn(`Anthropic Manual: Anthropic API ${reason}, retry ${overloadedRetries}/3`);
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            isOverloaded ? 'The AI service is temporarily overloaded. Retrying...' : 'Network connection interrupted. Retrying...'
          ));
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else if (isOverloaded) {
          logger.error('Anthropic Manual: Anthropic API overloaded (529) after 3 retries, giving up');
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
          logger.error('Anthropic Manual: Error in agent conversation loop:', error);
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
      logger.log(`Anthropic Manual: Agent iteration stopped by user request for session ${this.sessionId}`);
      this.stopRequested = false; // Reset for next conversation

      // Send agent_complete message to notify client that agent has stopped
      await this.sendToClient(createAgentCompleteMessage(
        this.sessionId,
        'awaiting_user',
        'Agent stopped by user request'
      ));
    } else if (iteration >= maxIterations) {
      logger.warn(`Anthropic Manual: Agent conversation reached max iterations (${maxIterations})`);

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
  async processAgentResponseAnthropicManual(response, messages, builtInTools, dynamicTools) {
    let hasToolCalls = false;

    // Process each content block
    for (const block of response.content) {
      // Check if stop was requested before processing each block
      if (this.stopRequested) {
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
        const toolResult = await this.anthropicManualExecuteToolCall(block, builtInTools, dynamicTools);

        // Check if stop was requested during tool execution
        if (this.stopRequested) {
          return false; // Stop processing immediately
        }

        if (toolResult.isError) {
          logger.error(`Anthropic Manual: Tool error for ${block.name}:`, toolResult.content);
        } else {
          logger.log(`Anthropic Manual: Tool call completed: ${block.name}`);
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
  async buildPriorContextTextAnthropic(history) {
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

      logger.log(`Anthropic: Summarizing prior agent context (${history.length} messages) before injection`);
      const response = await this.anthropic.messages.create({
        model: config.agentAnthropicSummaryModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: `Summarize this conversation history concisely (2-4 paragraphs):\n\n${conversationText}` }]
      });
      if (response.usage) {
        this.#logApiUsage('anthropic', response.usage, config.agentAnthropicSummaryModel);
      }
      return response.content[0].text;
    } catch (error) {
      logger.error('Anthropic: Error summarizing prior context:', error);
      return '[Prior conversation condensed due to size]';
    }
  }

  /**
   * Execute a tool call (built-in or client tool)
   */
  async anthropicManualExecuteToolCall(toolUse, builtInTools, _dynamicTools) {
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
      logger.error(`Anthropic Manual: Error executing tool ${toolUse.name}:`, error);
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
        logger.warn(`Anthropic: Duplicate tool name detected: ${toolName} (from built-in tools)`);
        continue;
      }

      // Skip tools that don't support the current mode
      if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) {
        continue;
      }

      // Skip tools whose model token constraints aren't met
      if (toolDef.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) {
        continue;
      }
      if (toolDef.minModelTokens && modelTokenCount < toolDef.minModelTokens) {
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
          logger.warn(`Anthropic: Duplicate tool name detected: ${toolName} (from client tools) - skipping client version, using built-in`);
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

    // Cache all tool definitions up to the last one — stable within a session
    if (tools.length > 0) {
      tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral', ttl: '5m' } };
    }

    return tools;
  }

  /**
   * Check if a tool is a built-in tool
   */
  isBuiltInTool(toolName, builtInTools) {
    return toolName in builtInTools.tools;
  }

  // ─── Gemini manual pathway ──────────────────────────────────────────────────

  async startConversationGeminiManual(userMessage) {
    this.sessionManager.addToConversationHistory(this.sessionId, {
      role: 'user',
      parts: [{ text: userMessage }]
    });

    const session = this.sessionManager.getSession(this.sessionId);
    const mode = session.mode;
    const systemPrompt = this.configManager.buildSystemPrompt(mode);
    const builtInTools = this.builtInToolProvider.getTools();
    const dynamicTools = this.dynamicToolProvider.getTools();

    await this.sessionManager.cleanupContext(this.sessionId, config.agentMaxContextTokens);

    const messages = this.sessionManager.getConversationContext(this.sessionId);

    // Normalize in-place: Anthropic-format messages ({role,content}) from historical
    // session load or a prior Anthropic-mode agent switch must become Gemini-format
    // ({role:'user'|'model', parts}) before being sent to the Gemini API.
    for (let i = 0; i < messages.length; i++) {
      messages[i] = toGeminiMessage(messages[i]);
    }

    const currentModel = session?.clientModel;

    let modelTokenCount = 0;

    if (currentModel) {
      const modelJson = JSON.stringify(currentModel, null, 2);
      modelTokenCount = encode(modelJson).length;
      this.sessionManager.updateModelTokenCount(this.sessionId, modelTokenCount);
    }

    const toolDeclarations = this.convertToolsToGeminiFormat(builtInTools, dynamicTools, modelTokenCount, mode);

    // Build or reuse per-session Gemini context cache (system prompt + tools)
    const geminiConfig = await this.#getGeminiManualConfig(systemPrompt, toolDeclarations);

    let continueLoop = true;
    let completedNaturally = false;
    const maxIterations = this.configManager.getMaxIterations();
    let iteration = 0;
    let retries = 0;

    while (continueLoop && iteration < maxIterations && !this.stopRequested) {
      iteration++;
      await this.sessionManager.cleanupContext(this.sessionId, config.agentMaxContextTokens);

      try {
        const response = await this.gemini.models.generateContent({
          model: config.agentGeminiModel,
          contents: messages,
          config: geminiConfig
        });

        this.#logApiUsage('gemini', response.usageMetadata);

        if (this.stopRequested) break;

        continueLoop = await this.processGeminiManualResponse(response, messages, builtInTools, dynamicTools);
        if (!continueLoop) completedNaturally = true;

        if (this.stopRequested) break;

      } catch (error) {
        const isQuota = error?.status === 429;
        const isNetworkError = error?.code === 'UND_ERR_SOCKET' || error?.code === 'ECONNRESET' ||
          (error instanceof TypeError && error.message === 'terminated');
        if ((isQuota || isNetworkError) && retries < 3) {
          retries++;
          const reason = isQuota ? 'quota/rate-limited (429)' : 'network error';
          logger.warn(`Gemini Manual: Gemini API ${reason}, retry ${retries}/3`);
          await this.sendToClient(createAgentTextMessage(
            this.sessionId,
            isQuota ? 'The AI service is temporarily rate-limited. Retrying...' : 'Network connection interrupted. Retrying...'
          ));
          await new Promise(resolve => setTimeout(resolve, 5000));
        } else if (isQuota) {
          logger.error('Gemini Manual: Gemini API rate-limited after 3 retries, giving up');
          await this.sendToClient(createErrorMessage(this.sessionId, 'The AI service is rate-limited. Please try again later.', 'AGENT_ERROR'));
          await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', 'Agent stopped due to rate limiting'));
          continueLoop = false;
        } else {
          logger.error('Gemini Manual: Error in Gemini agent conversation loop:', error);
          await this.sendToClient(createErrorMessage(this.sessionId, `Agent error: ${error.message}`, 'AGENT_ERROR'));
          await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', 'Agent stopped due to error'));
          continueLoop = false;
        }
      }
    }

    if (this.stopRequested) {
      this.stopRequested = false;
      await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', 'Agent stopped by user request'));
    } else if (!completedNaturally && iteration >= maxIterations) {
      logger.warn(`Gemini Manual: Agent conversation reached max iterations (${maxIterations})`);
      await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', `Reached maximum iterations (${maxIterations})`));
    }
  }

  async processGeminiManualResponse(response, messages, builtInTools, dynamicTools) {
    const candidate = response.candidates?.[0];
    if (!candidate?.content) return false;

    const parts = candidate.content.parts || [];

    messages.push({ role: 'model', parts });

    const rawTextParts = [];
    for (const part of parts) {
      if (part.thought) continue;
      if (part.text) {
        rawTextParts.push(part.text);
        const html = await marked.parse(part.text);
        await this.sendToClient(createAgentTextMessage(this.sessionId, html, false));
      }
    }

    const functionCallParts = parts.filter(p => p.functionCall);
    if (functionCallParts.length === 0) {
      await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'success', 'Task completed successfully'));
      return false;
    }

    const functionResponseParts = [];
    for (const part of functionCallParts) {
      if (this.stopRequested) return false;

      const { name, args } = part.functionCall;
      const callId = `fc_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
      const isBuiltIn = this.isBuiltInTool(name, builtInTools);

      await this.#sendSlowToolMessageGeminiADK(name, args);
      await this.sendToClient(createToolCallNotificationMessage(this.sessionId, callId, name, args, isBuiltIn));

      const toolResult = await this.executeToolCallGeminiManual({ name, input: args }, builtInTools, dynamicTools);

      if (this.stopRequested) return false;

      if (toolResult.isError) {
        logger.error(`Gemini Manual: Tool error for ${name}:`, toolResult.content);
      } else {
        logger.log(`Gemini Manual: Tool call completed: ${name}`);
      }

      const responseType = this.#getResponseType(name);
      await this.sendToClient(createToolCallCompletedMessage(
        this.sessionId, callId, name, toolResult.content, toolResult.isError, responseType
      ));

      const resultText = Array.isArray(toolResult.content)
        ? toolResult.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        : String(toolResult.content);

      functionResponseParts.push({
        functionResponse: { name, response: { result: resultText } }
      });
    }

    messages.push({ role: 'user', parts: functionResponseParts });
    return true;
  }

  // ─── Gemini ADK pathway ─────────────────────────────────────────────────────

  #adkHasPriorContext = false;

  async startConversationWithADK(userMessage, previousAgentContext = null) {
    const session = this.sessionManager.getSession(this.sessionId);
    const mode = session.mode;

    this.sessionManager.addToConversationHistory(this.sessionId, {
      role: 'user',
      parts: [{ text: userMessage }]
    });

    let systemPrompt = this.configManager.buildSystemPrompt(mode);
    const currentModel = session?.clientModel;
    let modelTokenCount = 0;

    if (currentModel) {
      const modelJson = JSON.stringify(currentModel, null, 2);
      modelTokenCount = encode(modelJson).length;
      this.sessionManager.updateModelTokenCount(this.sessionId, modelTokenCount);
      logger.log(`Model token count: ${modelTokenCount} (limit: ${config.agentMaxTokensForEngines}, exceeds: ${modelTokenCount > config.agentMaxTokensForEngines})`);
    }

    this.abortController = new AbortController();
    const maxIterations = this.configManager.getMaxIterations();
    let maxIterationsHit = false;

    try {
      const builtInAdkTools = this.builtInToolProvider.getAdkTools(mode, modelTokenCount);
      const clientAdkTools = this.dynamicToolProvider.getAdkTools();

      const pendingCallIds = new Map();

      const agent = new LlmAgent({
        name: this.configManager.getAgentName(),
        model: config.agentGeminiModel,
        instruction: systemPrompt,
        tools: [...builtInAdkTools, ...clientAdkTools],
        generateContentConfig: {
          thinkingConfig: config.agentGeminiThinking
        },
        beforeToolCallback: async ({ tool, args }) => {
          const callId = `adk_${Date.now()}_${Math.random().toString(36).substr(2, 7)}`;
          const key = `${tool.name}::${JSON.stringify(args)}`;
          pendingCallIds.set(key, callId);
          const isBuiltIn = builtInAdkTools.some(t => t.name === tool.name);
          await this.#sendSlowToolMessageGeminiADK(tool.name, args);
          await this.sendToClient(createToolCallNotificationMessage(
            this.sessionId, callId, tool.name, args, isBuiltIn
          ));
        },
        afterToolCallback: async ({ tool, args, toolResponse }) => {
          const key = `${tool.name}::${JSON.stringify(args)}`;
          const callId = pendingCallIds.get(key) || `adk_${Date.now()}`;
          pendingCallIds.delete(key);
          logger.log(`Gemini ADK: Tool call completed: ${tool.name}`);
          const responseType = this.#getResponseType(tool.name);
          const content = [{ type: 'text', text: String(toolResponse ?? '') }];
          await this.sendToClient(createToolCallCompletedMessage(
            this.sessionId, callId, tool.name, content, false, responseType
          ));
        }
      });

      const runner = new Runner({
        appName: 'sd-ai',
        agent,
        sessionService: this.adkSessionService
      });

      if (!this.adkSessionId) {
        this.adkSessionId = this.sessionId;
        await this.adkSessionService.createSession({
          appName: 'sd-ai',
          userId: this.sessionId,
          sessionId: this.adkSessionId
        });
        logger.log(`Gemini ADK: session created: ${this.adkSessionId}`);
      } else {
        logger.log(`Gemini ADK: Resuming session: ${this.adkSessionId}`);
      }

      let prompt = userMessage;
      if (previousAgentContext?.length > 0 && !this.#adkHasPriorContext) {
        const contextToReplay = previousAgentContext.slice(0, -1).map(toGeminiMessage);
        if (contextToReplay.length > 0) {
          logger.debug(`[Agent switch → ADK] Replaying ${contextToReplay.length} messages from prior agent.`);
          const contextText = await this.buildPriorContextTextGemini(contextToReplay);
          prompt = `[Prior conversation context]\n${contextText}\n[End of prior context]\n\n${userMessage}`;
        }
        this.#adkHasPriorContext = true;
      }

      const newMessage = { role: 'user', parts: [{ text: prompt }] };

      let turnCount = 0;
      for await (const event of runner.runAsync({
        userId: this.sessionId,
        sessionId: this.adkSessionId,
        newMessage,
        abortSignal: this.abortController.signal
      })) {
        if (event.usageMetadata) this.#logApiUsage('gemini', event.usageMetadata);
        if (this.stopRequested) break;
        await this.handleAdkEvent(event);
        if (isFinalResponse(event)) turnCount++;
        if (turnCount >= maxIterations) {
          logger.warn(`Gemini ADK: agent reached max iterations (${maxIterations})`);
          maxIterationsHit = true;
          this.abortController.abort();
          break;
        }
      }

      if (this.stopRequested) {
        this.stopRequested = false;
        await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', 'Agent stopped by user request'));
      } else if (maxIterationsHit) {
        logger.log(`Gemini ADK: max iterations hit ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', `Reached maximum iterations (${maxIterations})`));
      } else {
        logger.log(`Gemini ADK: conversation completed successfully for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'success', 'Task completed successfully'));
      }

    } catch (error) {
      if (maxIterationsHit) {
        logger.log(`Gemini ADK: agent reached max iterations for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', `Reached maximum iterations (${maxIterations})`));
      } else if (error.name === 'AbortError' || this.stopRequested) {
        this.stopRequested = false;
        logger.log(`Gemini ADK: agent stopped for session ${this.sessionId}`);
        await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', 'Agent stopped by user request'));
      } else {
        logger.error('Gemini ADK: in ADK conversation loop:', error);
        await this.sendToClient(createErrorMessage(this.sessionId, `Agent error: ${error.message}`, 'AGENT_ERROR'));
        await this.sendToClient(createAgentCompleteMessage(this.sessionId, 'awaiting_user', `Agent error: ${error.message}`));
      }
    } finally {
      this.abortController = null;
    }
  }

  async handleAdkEvent(event) {
    if (event.errorCode) {
      throw new Error(event.errorMessage || `ADK error: ${event.errorCode}`);
    }

    const content = event.content;
    if (!content?.parts) return;

    const rawTextParts = [];
    for (const part of content.parts) {
      if (part.thought) continue;
      if (part.text && !event.partial) {
        rawTextParts.push(part.text);
        const html = await marked.parse(part.text);
        await this.sendToClient(createAgentTextMessage(this.sessionId, html, false));
      }
    }

    if (rawTextParts.length > 0) {
      this.sessionManager.addToConversationHistory(this.sessionId, {
        role: 'model',
        parts: [{ text: rawTextParts.join('\n') }]
      });
    }
  }

  // ─── Shared Gemini helpers ──────────────────────────────────────────────────

  async #sendSlowToolMessageGeminiADK(toolName, args) {
    if (toolName === 'create_visualization') {
      const vizType = args?.useAICustom ? 'AI-generated custom' : (args?.type || 'standard');
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Creating ${vizType} visualization: "${args?.title || 'visualization'}"... This may take a moment.`, false));
    } else if (toolName === 'get_variable_data') {
      const varCount = args?.variableNames?.length || 0;
      const runCount = args?.runIds?.length || 0;
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Retrieving data for ${varCount} variable${varCount !== 1 ? 's' : ''} from ${runCount} run${runCount !== 1 ? 's' : ''}...`, false));
    } else if (toolName === 'get_feedback_information') {
      const runCount = args?.runIds?.length || 0;
      const runText = runCount === 0 ? 'all runs' : `${runCount} run${runCount !== 1 ? 's' : ''}`;
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Analyzing feedback loops for ${runText}... This may take a moment.`, false));
    } else if (toolName === 'run_model') {
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Running model simulation...`, false));
    } else if (toolName === 'discuss_model_with_seldon') {
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Consulting Seldon for expert analysis...`, false));
    } else if (toolName === 'discuss_model_across_runs') {
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Analyzing model behavior across runs...`, false));
    } else if (toolName === 'discuss_with_mentor') {
      await this.sendToClient(createAgentTextMessage(this.sessionId, `Consulting Seldon mentor for guidance...`, false));
    }
  }

  executeToolCallGeminiManual(toolUse, builtInTools, _dynamicTools) {
    try {
      if (builtInTools.tools[toolUse.name]) {
        return builtInTools.tools[toolUse.name].handler(toolUse.input);
      }
      if (this.dynamicToolProvider.isClientTool(toolUse.name)) {
        const unprefixedName = toolUse.name.replace(/^client_/, '');
        return this.dynamicToolProvider.requestClientExecution(unprefixedName, toolUse.input)
          .then(result => ({ content: result, isError: false }));
      }
      return Promise.resolve({ content: [{ type: 'text', text: `Tool not found: ${toolUse.name}` }], isError: true });
    } catch (error) {
      logger.error(`Gemini Manual: Error executing tool ${toolUse.name}:`, error);
      return Promise.resolve({ content: [{ type: 'text', text: error.message }], isError: true });
    }
  }

  convertToolsToGeminiFormat(builtInTools, dynamicTools, modelTokenCount = 0, mode = null) {
    const declarations = [];
    const toolNames = new Set();

    for (const [toolName, toolDef] of Object.entries(builtInTools.tools)) {
      if (toolNames.has(toolName)) continue;
      if (mode && toolDef.supportedModes && !toolDef.supportedModes.includes(mode)) continue;
      if (toolDef.maxModelTokens && modelTokenCount > toolDef.maxModelTokens) continue;
      if (toolDef.minModelTokens && modelTokenCount < toolDef.minModelTokens) continue;

      toolNames.add(toolName);
      declarations.push({
        name: toolName,
        description: toolDef.description,
        parameters: sanitizeSchemaForGemini(toolDef.inputSchema.toJSONSchema())
      });
    }

    if (dynamicTools?.tools) {
      for (const [toolName, toolDef] of Object.entries(dynamicTools.tools)) {
        if (toolNames.has(toolName)) continue;
        toolNames.add(toolName);
        declarations.push({
          name: toolName,
          description: toolDef.description,
          parameters: sanitizeSchemaForGemini(toolDef.inputSchema.toJSONSchema())
        });
      }
    }

    return declarations;
  }

  async buildPriorContextTextGemini(history) {
    try {
      const conversationText = history.map((msg) => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        if (!Array.isArray(msg.parts)) return '';
        const text = msg.parts.filter(p => p.text).map(p => p.text).join('\n');
        return text ? `${role}: ${text}` : '';
      }).filter(line => line).join('\n\n');

      logger.log(`Gemini: Summarizing prior agent context (${history.length} messages) before injection`);
      const response = await this.gemini.models.generateContent({
        model: config.agentGeminiSummaryModel,
        contents: [{
          role: 'user',
          parts: [{ text: `Summarize this conversation history concisely (2-4 paragraphs):\n\n${conversationText}` }]
        }]
      });
      if (response.usageMetadata) {
        this.#logApiUsage('gemini', response.usageMetadata, config.agentGeminiSummaryModel);
      }
      return response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch (error) {
      logger.error('Gemini: Error summarizing prior context:', error);
      return '[Prior conversation condensed due to size]';
    }
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

  async #getGeminiManualConfig(systemPrompt, toolDeclarations) {
    // Build a cache key from the stable inputs — recreate if they change (e.g. tool set changes on model resize)
    const cacheKey = systemPrompt + JSON.stringify(toolDeclarations.map(t => t.name));

    if (this.#geminiManualCacheName && this.#geminiManualCacheKey === cacheKey) {
      return {
        cachedContent: this.#geminiManualCacheName,
        thinkingConfig: config.agentGeminiThinking
      };
    }

    // Delete the old cache if the key changed
    if (this.#geminiManualCacheName) {
      try {
        await this.gemini.caches.delete({ name: this.#geminiManualCacheName });
      } catch (e) {
        logger.warn('[gemini-cache] failed to delete stale cache:', e.message);
      }
      this.#geminiManualCacheName = null;
      this.#geminiManualCacheKey = null;
    }

    try {
      const cacheConfig = {
        ttl: '300s',
        systemInstruction: systemPrompt
      };
      if (toolDeclarations.length > 0) {
        cacheConfig.tools = [{ functionDeclarations: toolDeclarations }];
      }

      const cache = await this.gemini.caches.create({
        model: config.agentGeminiModel,
        config: cacheConfig
      });

      this.#geminiManualCacheName = cache.name;
      this.#geminiManualCacheKey = cacheKey;

      return {
        cachedContent: cache.name,
        thinkingConfig: config.agentGeminiThinking
      };
    } catch (e) {
      logger.warn('[gemini-cache] failed to create cache, falling back to uncached:', e.message);
      const cfg = {
        systemInstruction: systemPrompt,
        thinkingConfig: config.agentGeminiThinking
      };
      if (toolDeclarations.length > 0) {
        cfg.tools = [{ functionDeclarations: toolDeclarations }];
      }
      return cfg;
    }
  }

  async #fetchCurrentModel() {
    const tool = this.builtInToolProvider.getTools().tools.get_current_model;
    if (!tool) return;
    const result = await tool.handler({});
    if (result.isError) {
      logger.warn(`Failed to fetch current model before processing request: ${result.content?.[0]?.text ?? 'unknown error'}`);
    }
  }

  #logApiUsage(provider, usage, model = null) {
    if (!usage) return;
    const resolvedModel = model ?? (
      provider === 'anthropic' ? config.agentAnthropicModel : config.agentGeminiModel
    );
    this.tokenReporter.report({ provider, model: resolvedModel, usage }).catch(() => {});
  }

  destroy() {
    logger.log(`AgentOrchestrator destroyed for session ${this.sessionId}`);

    if (this.#geminiManualCacheName && this.gemini) {
      this.gemini.caches.delete({ name: this.#geminiManualCacheName }).catch(() => {});
    }

    // Clear any references
    this.sessionManager = null;
    this.sendToClient = null;
    this.builtInToolProvider = null;
    this.dynamicToolProvider = null;
    this.anthropic = null;
    this.gemini = null;
    this.adkSessionService = null;
    this.configManager = null;
  }
}
