import Anthropic from '@anthropic-ai/sdk';
import { marked } from 'marked';
import { countTokens } from '@anthropic-ai/tokenizer';
import { writeFileSync } from 'fs';
import { join } from 'path';
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

    // Load configuration
    this.configManager = new AgentConfigurationManager(configPath);

    // Create tool providers
    this.builtInToolProvider = new BuiltInToolProvider(sessionManager, sessionId, sendToClient);
    this.dynamicToolProvider = new DynamicToolProvider(sessionManager, sessionId, sendToClient);

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
    this.dynamicToolProvider.updateTools(clientTools);
  }

  /**
   * Start a conversation with the agent
   */
  async startConversation(userMessage) {
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
      const modelType = session.modelType;
      const systemPrompt = this.configManager.buildSystemPrompt(modelType);

      // Get tool collections
      const builtInTools = this.builtInToolProvider.getTools();
      const dynamicTools = this.dynamicToolProvider.getTools();

      logger.log(`Starting conversation for session ${this.sessionId}`);
      logger.log(`Built-in tools: ${this.builtInToolProvider.getToolNames().join(', ')}`);
      logger.log(`Client tools: ${this.dynamicToolProvider.getToolNames().join(', ')}`);

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

    // Clean up message history at session start: remove old models and enforce token limits
    this.cleanupMessageHistory(messages);

    // Check model token count and update session state (only for SFD models)
    const session = this.sessionManager.getSession(this.sessionId);
    const currentModel = session?.clientModel;
    const modelType = session?.modelType;
    let modelExceedsLimit = false;

    if (currentModel && modelType === 'sfd') {
      const modelJson = JSON.stringify(currentModel, null, 2);
      const tokenCount = countTokens(modelJson);
      this.sessionManager.updateModelTokenCount(this.sessionId, tokenCount);
      modelExceedsLimit = this.sessionManager.modelExceedsTokenLimit(this.sessionId);

      logger.log(`SFD Model token count: ${tokenCount} (limit: ${config.maxTokensForEngines}, exceeds: ${modelExceedsLimit})`);

      // If this is the first time exceeding the limit, write model to disk
      if (modelExceedsLimit && tokenCount > 0) {
        const sessionTempDir = this.sessionManager.getSessionTempDir(this.sessionId);
        const modelPath = join(sessionTempDir, 'model.sdjson');

        try {
          writeFileSync(modelPath, modelJson);
          logger.log(`Model exceeds token limit. Written to: ${modelPath}`);

          // Add system message to inform Claude about the switch
          const systemMessage = `\n\n**IMPORTANT: Model Size Notice**\n\nThe current model has exceeded ${config.maxTokensForEngines} tokens (${tokenCount} tokens). The \`generate_quantitative_model\` tool has been disabled.\n\nThe model has been saved to: \`${modelPath}\`\n\nYou can now work with the model using these tools:\n- \`read_model_section\`: Read specific sections of the model (metadata, specs, variables, relationships, modules) with optional filtering\n- \`edit_model_section\`: Edit specific sections by adding, updating, or removing items\n\nThese tools allow you to work with large models efficiently without loading the entire model into memory. Use read_model_section first to inspect the parts you need, then use edit_model_section to make targeted changes.`;

          systemPrompt += systemMessage;
        } catch (err) {
          logger.error(`Failed to write model to disk: ${err.message}`);
        }
      }
    }

    // Convert tool servers to Anthropic tool format (with conditional filtering)
    const tools = this.convertToolsToAnthropicFormat(builtInTools, dynamicTools, modelExceedsLimit);

    let continueLoop = true;
    const maxIterations = this.configManager.getMaxIterations();
    let iteration = 0;

    while (continueLoop && iteration < maxIterations && !this.stopRequested) {
      iteration++;

      // Limit message history to prevent context overflow using LLM summarization
      const MAX_CONTEXT_TOKENS = config.maxContextTokens;

      // Calculate current message history token count
      const messagesJson = JSON.stringify(messages);
      const currentTokens = countTokens(messagesJson);

      if (currentTokens > MAX_CONTEXT_TOKENS) {
        logger.log(`Message history exceeds token limit: ${currentTokens} tokens (limit: ${MAX_CONTEXT_TOKENS})`);

        // Keep the first message (user's initial request) for context
        const firstMessage = messages[0];
        const firstMessageTokens = countTokens(JSON.stringify(firstMessage));

        // Reserve space for first message and summary (estimate ~1000 tokens for summary)
        const SUMMARY_TOKEN_ESTIMATE = 1000;
        let remainingTokenBudget = MAX_CONTEXT_TOKENS - firstMessageTokens - SUMMARY_TOKEN_ESTIMATE;
        const keptRecentMessages = [];

        // Collect recent messages that fit in the remaining budget
        for (let i = messages.length - 1; i >= 1; i--) {
          const messageTokens = countTokens(JSON.stringify(messages[i]));

          if (remainingTokenBudget - messageTokens >= 0) {
            keptRecentMessages.unshift(messages[i]);
            remainingTokenBudget -= messageTokens;
          } else {
            break;
          }
        }

        // If we kept all messages except first, no need to summarize
        if (keptRecentMessages.length < messages.length - 1) {
          // Get messages to summarize (everything between first and recent)
          const messagesToSummarize = messages.slice(1, messages.length - keptRecentMessages.length);

          if (messagesToSummarize.length > 0) {
            // Create summary of old messages
            const summaryMessage = await this.summarizeMessageHistory(messagesToSummarize);

            // Replace messages: [first, summary, ...recent]
            messages.splice(0, messages.length, firstMessage, summaryMessage, ...keptRecentMessages);

            const newTokenCount = countTokens(JSON.stringify(messages));
            logger.log(`Summarized message history: ${messages.length} messages (including summary), ${newTokenCount} tokens (saved ${currentTokens - newTokenCount} tokens)`);
          }
        }
      }

      try {
        // Call Claude API
        const response = await this.anthropic.messages.create({
          model: 'claude-sonnet-4-6',
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

        // Determine response type based on tool name
        let responseType = 'other';
        if (['generate_ltm_narrative'].includes(block.name)) {
          responseType = 'ltm-discuss';
        } else if (['discuss_model_with_seldon', 'discuss_model_across_runs', 'discuss_with_mentor'].includes(block.name)) {
          responseType = 'discuss';
        } else if (['generate_quantitative_model', 'generate_qualitative_model', 'generate_documentation'].includes(block.name)) {
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

        // Add tool_result following Claude's API requirements
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: block.id,
            content: typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content),
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
   * Summarize message history using LLM when it exceeds token limits
   * @param {Array} messages - The messages array to summarize
   * @returns {Promise<Object>} The summary message object
   */
  async summarizeMessageHistory(messages) {
    try {
      // Create a concise representation of the conversation history for summarization
      const conversationText = messages.map((msg) => {
        if (msg.role === 'user') {
          return `User: ${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`;
        } else if (msg.role === 'assistant') {
          // For assistant messages, extract text content and skip tool_use blocks
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

      // Use a fast, cheap model to create the summary
      const summaryPrompt = `Please create a concise summary of the following conversation history. Focus on:
- The main task or goal the user requested
- Key decisions, findings, or results achieved
- Important context needed for continuing the conversation
- Current state of the work

Keep the summary brief but informative (2-4 paragraphs maximum).

Conversation history:
${conversationText}`;

      const summaryMessages = [
        {
          role: 'user',
          content: summaryPrompt
        }
      ];

      // Use Anthropic API directly with a fast model
      const response = await this.anthropic.messages.create({
        model: 'claude-haiku-4-5', // Fast, cheap model for summarization
        max_tokens: 1024,
        messages: summaryMessages
      });

      const summaryText = response.content[0].text;

      logger.log(`Created message history summary: ${summaryText.substring(0, 100)}...`);

      return {
        role: 'user',
        content: `[Previous conversation summary]\n${summaryText}\n[End of summary - continuing conversation]`
      };

    } catch (error) {
      logger.error('Error summarizing message history:', error);
      // If summarization fails, return a basic summary
      return {
        role: 'user',
        content: '[Previous conversation summary: Earlier messages were condensed to save context. The conversation is continuing from this point.]'
      };
    }
  }

  /**
   * Clean up message history at session initialization
   * Removes all but the most recent model and enforces token limits
   * @param {Array} messages - The messages array to clean
   */
  async cleanupMessageHistory(messages) {
    if (messages.length === 0) {
      return;
    }

    logger.log(`Cleaning up message history (${messages.length} messages)`);

    // Find all model results in the messages
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
                break; // Only count this message once
              }
            } catch (e) {
              // Not parseable or not a model result, skip
            }
          }
        }
      }
    }

    // Remove all but the most recent model
    if (modelIndices.length > 1) {
      // Keep only the last model index, remove all others
      const indicesToRemove = modelIndices.slice(0, -1).sort((a, b) => b - a);
      for (const index of indicesToRemove) {
        messages.splice(index, 1);
        logger.log(`Removed old model result from message history at index ${index}`);
      }
      logger.log(`Kept most recent model, removed ${indicesToRemove.length} older model(s)`);
    }

    // Now enforce token limits using LLM summarization
    const MAX_CONTEXT_TOKENS = config.maxContextTokens;
    const messagesJson = JSON.stringify(messages);
    const currentTokens = countTokens(messagesJson);

    if (currentTokens > MAX_CONTEXT_TOKENS) {
      logger.log(`Message history after cleanup exceeds token limit: ${currentTokens} tokens (limit: ${MAX_CONTEXT_TOKENS})`);

      // Keep the first message (user's initial request) for context
      const firstMessage = messages[0];
      const firstMessageTokens = countTokens(JSON.stringify(firstMessage));

      // Reserve space for first message and summary (estimate ~1000 tokens for summary)
      const SUMMARY_TOKEN_ESTIMATE = 1000;
      let remainingTokenBudget = MAX_CONTEXT_TOKENS - firstMessageTokens - SUMMARY_TOKEN_ESTIMATE;
      const keptRecentMessages = [];

      // Collect recent messages that fit in the remaining budget
      for (let i = messages.length - 1; i >= 1; i--) {
        const messageTokens = countTokens(JSON.stringify(messages[i]));

        if (remainingTokenBudget - messageTokens >= 0) {
          keptRecentMessages.unshift(messages[i]);
          remainingTokenBudget -= messageTokens;
        } else {
          break;
        }
      }

      // If we kept all messages except first, no need to summarize
      if (keptRecentMessages.length >= messages.length - 1) {
        return;
      }

      // Get messages to summarize (everything between first and recent)
      const messagesToSummarize = messages.slice(1, messages.length - keptRecentMessages.length);

      if (messagesToSummarize.length > 0) {
        // Create summary of old messages
        const summaryMessage = await this.summarizeMessageHistory(messagesToSummarize);

        // Replace messages: [first, summary, ...recent]
        messages.splice(0, messages.length, firstMessage, summaryMessage, ...keptRecentMessages);

        const newTokenCount = countTokens(JSON.stringify(messages));
        logger.log(`Summarized message history: ${messages.length} messages (including summary), ${newTokenCount} tokens (saved ${currentTokens - newTokenCount} tokens)`);
      }
    }
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
        const result = await this.dynamicToolProvider.requestClientExecution(
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
   * Convert tool servers to Anthropic tool format
   */
  convertToolsToAnthropicFormat(builtInTools, dynamicTools, modelExceedsLimit = false) {
    const tools = [];
    const toolNames = new Set();

    // Tools to exclude when model exceeds token limit (only quantitative model generation)
    const excludedToolsWhenOverLimit = new Set([
      'generate_quantitative_model'
    ]);

    // Convert built-in tools
    for (const [toolName, toolDef] of Object.entries(builtInTools.tools)) {
      if (toolNames.has(toolName)) {
        logger.warn(`Duplicate tool name detected: ${toolName} (from built-in tools)`);
        continue;
      }

      // Skip model generation tools if model exceeds token limit
      if (modelExceedsLimit && excludedToolsWhenOverLimit.has(toolName)) {
        logger.log(`Excluding tool ${toolName} - model exceeds token limit`);
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
