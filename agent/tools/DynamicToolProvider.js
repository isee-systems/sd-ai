import { StructuredOutputToZodConverter } from '../../utilities/StructuredOutputToZodConverter.js';
import { toolResultToText, mediaBlock, mediaBlocksOf, toMcpContentResult } from '../utilities/ToolResultFormatter.js';
import { MediaStore } from '../utilities/MediaStore.js';
import { sanitizeSchemaForGemini } from './builtin/toolHelpers.js';
import {
  SEARCH_TOOL_NAME,
  CALL_TOOL_NAME,
  createSearchClientToolsTool,
  createCallClientToolTool,
  unwrapDispatchCall
} from './clientToolSearch.js';
import logger from '../../utilities/logger.js';
import config from '../../config.js';

// Provider SDK symbols are lazy-loaded — see BuiltInToolProvider for the same pattern.
// Use MCP's own McpServer instead of the Claude Agent SDK's tool()/createSdkMcpServer:
// the agent SDK bundles an older MCP whose converter strips field descriptions from
// advertised tool schemas. See BuiltInToolProvider for the full rationale.
let _McpServer;
const loadMcpServer = async () =>
  _McpServer ??= (await import('@modelcontextprotocol/sdk/server/mcp.js')).McpServer;
let _FunctionTool;
const loadFunctionTool = async () =>
  _FunctionTool ??= (await import('@google/adk')).FunctionTool;

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
  // Zod schemas for every client tool, by unprefixed name — built once here
  // whether or not the tools are advertised directly, because the deferred route
  // validates against them too.
  #zodSchemas = new Map();

  // mediaStore is required, and injected by AgentOrchestrator, which shares one
  // instance across every consumer in the worker. Required rather than defaulted so
  // there is exactly one construction site to reason about: the store is a handle
  // over a directory and a second instance would work, but "who owns this" having a
  // single answer is worth more than the convenience of not passing it.
  constructor(sessionManager, sessionId, sendToClient, mediaStore) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
    this.sendToClient = sendToClient;
    this.schemaConverter = new StructuredOutputToZodConverter();
    this.mediaStore = mediaStore;

    // Images a client tool returned on the google-sdk (ADK) route, waiting to be
    // pushed onto the next request. See getAdkTools for why they cannot simply be
    // returned. Drained by the orchestrator's beforeModelCallback.
    this.pendingAdkMedia = [];

    const session = sessionManager.getSession(sessionId);
    const clientTools = session?.clientTools || [];

    for (const toolDef of clientTools) {
      this.#zodSchemas.set(toolDef.name, this.schemaConverter.convert(toolDef.inputSchema));
    }

    // Past the threshold the schemas are withheld and the model gets the
    // search/dispatch pair instead — see clientToolSearch.js. Decided once, here:
    // the client declares its tools at session init and they do not change, so a
    // per-pass decision would only be the same answer computed repeatedly.
    this.deferred = clientTools.length > config.agentClientToolSearchThreshold;
    this.toolCollection = this.deferred
      ? this.#createDeferredToolCollection()
      : this.#createToolCollectionFromClientTools(clientTools);

    logger.log(`DynamicToolProvider initialized for session ${sessionId} with ${clientTools.length} client tools`
      + `${this.deferred ? ` (deferred behind ${SEARCH_TOOL_NAME}/${CALL_TOOL_NAME}, threshold ${config.agentClientToolSearchThreshold})` : ''}`);
  }

  /**
   * Create tool collection from client tool definitions
   */
  #createToolCollectionFromClientTools(clientTools) {
    const tools = {};

    for (const toolDef of clientTools) {
      const toolName = `client_${toolDef.name}`;
      tools[toolName] = {
        description: toolDef.description,
        inputSchema: this.#zodSchemas.get(toolDef.name),
        handler: this.#createToolHandler(toolDef),
        timeout: toolDef.timeout ?? 30000
      };
    }

    return {
      name: 'client_tools',
      tools
    };
  }

  /**
   * The two-tool stand-in for a large client catalogue: one tool that returns a
   * schema, one that runs a tool by name.
   *
   * Prefixed like any other client tool so every route treats them the same way —
   * the manual routes advertise them as `client_*`, the SDK and ADK routes strip
   * the prefix back off, and execution reaches them through the same
   * isClientTool/handler path as a directly-registered tool.
   */
  #createDeferredToolCollection() {
    const listClientTools = () => this.sessionManager.getSession(this.sessionId)?.clientTools || [];

    return {
      name: 'client_tools',
      tools: {
        [`client_${SEARCH_TOOL_NAME}`]: createSearchClientToolsTool(listClientTools),
        [`client_${CALL_TOOL_NAME}`]: createCallClientToolTool(
          listClientTools,
          name => this.#zodSchemas.get(name),
          (name, args) => this.#invokeClientTool(name, args)
        )
      }
    };
  }

  /**
   * Create a tool handler that proxies to the client
   * Note: toolDef.name is the UNPREFIXED name (e.g., 'get_current_model')
   */
  #createToolHandler(toolDef) {
    return async (args) => this.#invokeClientTool(toolDef.name, args);
  }

  /**
   * Run a client tool by its unprefixed name and answer with an envelope.
   *
   * The one place a thrown timeout becomes a tool error, shared by the directly
   * registered handlers and by the dispatcher, so both fail the same way. The
   * timeout and the media contract are read from the client's own definition
   * inside requestClientExecution, so there is nothing to pass and nothing to drop.
   */
  async #invokeClientTool(toolName, args) {
    try {
      return await this.requestClientExecution(toolName, args);
    } catch (error) {
      logger.log(`Error executing client tool ${toolName}:`, error);
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true
      };
    }
  }

  /**
   * Request client to execute a tool
   */
  /**
   * Resolve this tool's declared media handles to the metadata the client needs.
   *
   * Metadata only — no `content`. The base64 is injected by the main-process relay
   * on the way out, not here, because the worker IPC channel is newline-delimited
   * JSON accumulated with `buf += chunk`: a 27 MiB line is quadratic to reassemble
   * *and* head-of-line-blocks every streaming agent_text queued behind it.
   *
   * An unknown handle fails the call here, with no client round trip at all, so the
   * model gets a useful error instead of the client getting a meaningless string.
   */
  #resolveMediaArguments(toolDef, args) {
    const declared = toolDef?.media?.inputs;
    if (!declared?.length) return { media: [] };

    const media = [];

    for (const argument of declared) {
      const mediaId = args?.[argument];
      if (mediaId === undefined || mediaId === null || mediaId === '') continue;

      if (!MediaStore.isValidMediaId(mediaId) || !this.mediaStore.exists(mediaId)) {
        return {
          error: `'${mediaId}' is not an image I have. The '${argument}' argument takes a media `
               + `handle like med_0123456789abcdef, as returned by generate_image — not a file name `
               + `or a description. Generate the image first, then pass the handle it gives you.`
        };
      }

      const meta = this.mediaStore.meta(mediaId);
      media.push({
        mediaId: meta.mediaId,
        argument,
        name: meta.name,
        mimeType: meta.mimeType,
        bytes: meta.bytes
      });
    }

    if (media.length > config.mediaMaxItemsPerCall) {
      return { error: `That call carries ${media.length} images, over the limit of ${config.mediaMaxItemsPerCall}.` };
    }

    return { media };
  }

  /**
   * The client's own definition of a tool, by its unprefixed name.
   *
   * Looked up rather than passed in, because passing it was got wrong three times:
   * once on each manual route, and once on the openrouter-sdk route where the value
   * to hand was a *collection entry* that looks near-identical but carries no media
   * contract. Every one of those failed silently — a tool expecting bytes was sent a
   * bare handle, and a tool asking for an eight-hour timeout got thirty seconds.
   * There is now no parameter to forget.
   */
  #clientToolDef(toolName) {
    const session = this.sessionManager.getSession(this.sessionId);
    return (session?.clientTools || []).find(tool => tool.name === toolName) ?? null;
  }

  async requestClientExecution(toolName, args, timeout) {
    const toolDef = this.#clientToolDef(toolName);
    timeout = timeout ?? toolDef?.timeout ?? 30000;
    const callId = this.#generateCallId();

    const resolved = this.#resolveMediaArguments(toolDef, args);
    if (resolved.error) {
      return { content: [{ type: 'text', text: resolved.error }], isError: true };
    }

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
      // The handle stays in `arguments` exactly as the model wrote it — the model's
      // view of its own call is never rewritten — and the bytes arrive beside it,
      // keyed by the argument they are the real value of.
      arguments: args,
      ...(resolved.media.length ? { media: resolved.media } : {}),
      timeout
    });

    // Wait for client response with timeout. The timer is cleared in the finally
    // below: left uncleared it held itself and its closure alive for the full
    // timeout after every fast resolution, which is cheap at 30s and much less so
    // for a media tool asking for minutes.
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Tool call timeout: ${toolName} did not respond within ${timeout}ms`));
      }, timeout);
    });

    try {
      const { result, media = [] } = await Promise.race([resultPromise, timeoutPromise]);
      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      // The handles go in the text as well as in their own blocks, for two
      // reasons: the model learns what to call the picture so it can pass it to
      // another tool, and a provider route that cannot render an image still gets
      // a coherent account of what came back instead of a silent hole.
      const notes = media.map(meta => this.mediaStore.describeForModel(meta));

      return {
        content: [
          { type: 'text', text: notes.length ? `${text}\n\nAttached: ${notes.join('; ')}` : text },
          ...media.map(mediaBlock)
        ],
        isError: false
      };
    } catch (error) {
      // Clean up pending call
      const pendingCall = this.sessionManager.getPendingToolCall(this.sessionId, callId);
      if (pendingCall) {
        this.sessionManager.resolvePendingToolCall(this.sessionId, callId, { error: error.message }, true);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate a unique call ID
   */
  #generateCallId() {
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
   * The call to show the user for a tool_use the model just emitted.
   *
   * A dispatched call is `call_tool` on the wire and (say) write_interface_media
   * in fact, and the client's UI cares about the second one: it labels the entry
   * with the name and reads the arguments. Without this every client tool in a
   * deferred session would appear as the same anonymous `call_tool`.
   *
   * Anything that is not a dispatch comes back untouched.
   */
  describeCall(toolName, input) {
    return unwrapDispatchCall(toolName, input) ?? { name: toolName, input };
  }

  /**
   * What to tell the model when it calls a tool nothing has registered.
   *
   * In a deferred session the likeliest miss is a real client tool called
   * directly by name — the model read the name out of a search result and used
   * it as though it were advertised. That deserves the route to it rather than a
   * flat "not found" it can only respond to by guessing again.
   */
  toolNotFoundMessage(toolName) {
    const bare = String(toolName ?? '').replace(/^mcp__client__/, '').replace(/^client_/, '');
    const isWithheld = this.deferred
      && (this.sessionManager.getSession(this.sessionId)?.clientTools || []).some(tool => tool.name === bare);

    if (isWithheld) {
      return `Tool not found: ${toolName}. '${bare}' is one of this application's own tools — run it with `
        + `${CALL_TOOL_NAME}: { "name": "${bare}", "arguments": "<JSON object as a string>" }.`;
    }

    return `Tool not found: ${toolName}`;
  }

  /**
   * Create MCP server from client tool definitions (for SDK mode)
   * Wraps existing tool collection into SDK MCP server format
   * @returns {Object|null} MCP server instance or null if no tools
   */
  async getMcpServer() {
    if (!this.toolCollection) {
      return null;
    }

    const McpServer = await loadMcpServer();
    const server = new McpServer({ name: 'client', version: '1.0.0' });
    let count = 0;

    // Register client tools via MCP's own registerTool (preserves descriptions)
    for (const [toolName, toolDef] of Object.entries(this.toolCollection.tools)) {
      // Remove 'client_' prefix for SDK (SDK will add 'mcp__client__' prefix)
      const unprefixedName = toolName.replace(/^client_/, '');

      // inputSchema is a zod object (built by StructuredOutputToZodConverter);
      // registerTool takes the raw shape. Fall back to an empty shape for a
      // parameterless tool whose schema isn't a zod object.
      // Wrapped rather than registered raw: MCP must be handed its own image
      // content block, not our internal handle block. This is the one route where
      // bytes are attached at the tool-return boundary instead of at
      // request-build time, because the Agent SDK constructs the request itself --
      // so the base64 travels worker -> claude CLI stdio here. Unavoidable on this
      // route.
      server.registerTool(unprefixedName, {
        description: toolDef.description,
        inputSchema: toolDef.inputSchema?.shape ?? {}
      }, async (args) => toMcpContentResult(await toolDef.handler(args), this.mediaStore));
      count++;
    }

    if (count === 0) {
      return null;
    }

    logger.log(`Creating client MCP server with ${count} tools`);

    return { type: 'sdk', name: 'client', instance: server };
  }

  async getAdkTools() {
    if (!this.toolCollection) return [];

    const FunctionTool = await loadFunctionTool();
    const adkTools = [];

    for (const [toolName, toolDef] of Object.entries(this.toolCollection.tools)) {
      const unprefixedName = toolName.replace(/^client_/, '');

      adkTools.push(new FunctionTool({
        name: unprefixedName,
        description: toolDef.description,
        parameters: sanitizeSchemaForGemini(toolDef.inputSchema.toJSONSchema()),
        execute: async (args) => {
          const result = await toolDef.handler(args);
          if (result.isError) throw new Error(toolResultToText(result));

          // ADK has no way to return an image from a tool at all: its
          // buildResponseEvent puts the returned value in functionResponse.response
          // and never populates parts, and LOAD_ARTIFACTS is not exported from the
          // package. So pictures are queued here and pushed onto the request by the
          // orchestrator's beforeModelCallback instead.
          //
          // `.map(b => b.text)` here used to emit the literal string "undefined"
          // for any block that was not text.
          for (const media of mediaBlocksOf(result)) {
            this.pendingAdkMedia.push(media);
          }

          return toolResultToText(result);
        }
      }));
    }

    logger.log(`Built ${adkTools.length} ADK client tools`);
    return adkTools;
  }
}
