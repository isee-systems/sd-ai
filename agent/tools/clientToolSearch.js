/**
 * Deferred client tools — the search/dispatch pair.
 *
 * A client that registers a dozen tools spends the opening request on their
 * schemas, and the model re-reads all of them on every turn afterwards. Past
 * config.agentClientToolSearchThreshold the schemas are withheld: the model is
 * shown the names, a tool that hands back one tool's schema on request, and a
 * tool that runs one by name. Two or three small tools cost less to advertise
 * than the search round trip costs to pay, which is why the threshold exists.
 *
 * A dispatcher rather than a "register these now" mechanism because two of the
 * provider routes fix their tool list for the whole run: the Claude Agent SDK
 * builds its MCP servers when query() is called, and @openrouter/agent takes
 * `tools` per callModel and drives every step of the loop itself. Nothing can be
 * added mid-run on either, so the only way to reach a withheld tool on every
 * route is to call something already advertised.
 *
 * Names only in the catalogue. A one-line summary per tool would pick the right
 * tool more often, but it is also the half of a schema that grows without bound
 * — a client is free to write a paragraph — and the whole point here is that the
 * advertised cost stays proportional to the number of tools rather than to what
 * the client chose to write about them.
 */
import { z } from 'zod';
import { createSuccessResponse, createErrorResponse } from './builtin/toolHelpers.js';

// Unprefixed names. The collection keys carry the `client_` prefix every other
// client tool gets, and the SDK/ADK routes strip it back off — so the model sees
// `client_search_tools` on the manual routes, `mcp__client__search_tools` under
// the Agent SDK, and `search_tools` under ADK, exactly as it does for a real
// client tool.
export const SEARCH_TOOL_NAME = 'search_tools';
export const CALL_TOOL_NAME = 'call_tool';

const SELECT_PREFIX = 'select:';
const DEFAULT_MAX_RESULTS = 5;

/**
 * Split a query into required terms (`+term`) and ranking terms.
 */
function parseTerms(text) {
  const required = [];
  const optional = [];

  for (const token of text.toLowerCase().split(/\s+/)) {
    const isRequired = token.startsWith('+');
    const term = token.replace(/^\+/, '').replace(/[^a-z0-9_]/g, '');
    if (!term) continue;
    (isRequired ? required : optional).push(term);
  }

  return { required, optional };
}

function matchesTerm(tool, term) {
  return tool.name.toLowerCase().includes(term)
    || (tool.description ?? '').toLowerCase().includes(term);
}

// A name hit outranks a description hit: a client tool's name is the thing the
// client chose deliberately, and a description that happens to mention "export"
// in passing should not outrank the tool actually called export_model.
function scoreTool(tool, terms) {
  const name = tool.name.toLowerCase();
  const description = (tool.description ?? '').toLowerCase();

  let total = 0;
  for (const term of terms) {
    if (name.includes(term)) total += 3;
    if (description.includes(term)) total += 1;
  }
  return total;
}

/**
 * Match client tool definitions against a query.
 *
 * Three query forms, mirroring the tool's own description:
 *   `select:a,b`  exact names — no ranking, no limit, the model already knows
 *   `+term rest`  `term` must appear; the rest only ranks
 *   `term term`   plain keyword search over names and descriptions
 *
 * An empty query returns everything up to the limit, so a model that opens with
 * a bare call still gets something usable rather than an empty result it has to
 * interpret.
 *
 * @returns {{matches: Object[], unknown: string[]}}
 */
export function searchClientTools(clientTools, query, maxResults) {
  const limit = Number.isInteger(maxResults) && maxResults > 0 ? maxResults : DEFAULT_MAX_RESULTS;
  const text = (typeof query === 'string' ? query : '').trim();

  if (text.toLowerCase().startsWith(SELECT_PREFIX)) {
    const names = text.slice(SELECT_PREFIX.length).split(',').map(name => name.trim()).filter(Boolean);
    const matches = [];
    const unknown = [];

    for (const name of names) {
      const tool = clientTools.find(candidate => candidate.name === name)
        ?? clientTools.find(candidate => candidate.name.toLowerCase() === name.toLowerCase());
      if (tool) matches.push(tool); else unknown.push(name);
    }

    return { matches, unknown };
  }

  const { required, optional } = parseTerms(text);
  const terms = [...required, ...optional];

  const ranked = clientTools
    .filter(tool => required.every(term => matchesTerm(tool, term)))
    .map(tool => ({ tool, score: terms.length === 0 ? 1 : scoreTool(tool, terms) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));

  return { matches: ranked.slice(0, limit).map(entry => entry.tool), unknown: [] };
}

/**
 * What the model gets back for one match: the client's own JSON Schema, verbatim.
 *
 * The media contract comes with it. A tool whose `image` argument takes a handle
 * is unusable without knowing that, and the model has no other way to find out —
 * the JSON Schema says `string`.
 */
function describeMatch(tool) {
  const mediaInputs = tool.media?.inputs ?? [];

  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.timeout ? { timeoutMs: tool.timeout } : {}),
    ...(mediaInputs.length ? {
      note: `${mediaInputs.map(argument => `'${argument}'`).join(' and ')} `
          + `take${mediaInputs.length === 1 ? 's' : ''} a media handle (as returned by generate_image), not a file name.`
    } : {}),
    ...(tool.media?.returnsMedia ? { returnsImages: true } : {})
  };
}

/**
 * Turn the model's `arguments` value into an object to send to the client.
 *
 * Declared as a string in the schema and accepted as either. A free-form object
 * argument is the natural shape, but it has no properties to declare, and
 * Gemini's function-declaration schema rejects an object type with none —
 * so the declared form has to be a string. Providers that hand the value
 * through as an object anyway are still right, and are accepted as-is.
 */
export function parseToolArguments(raw) {
  if (raw === undefined || raw === null || raw === '') return { args: {} };

  if (typeof raw === 'object' && !Array.isArray(raw)) return { args: raw };

  if (typeof raw !== 'string') {
    return { error: `'arguments' must be a JSON object encoded as a string, e.g. {"variableName":"population"}.` };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      error: `'arguments' is not valid JSON (${error.message}). Send the tool's arguments as a JSON `
           + `object encoded in a string, e.g. {"variableName":"population"}.`
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: `'arguments' must decode to a JSON object, not ${Array.isArray(parsed) ? 'an array' : typeof parsed}.` };
  }

  return { args: parsed };
}

/**
 * The real call behind a `call_tool` tool_use, for anything that displays or logs
 * tool calls. Returns null when the call is not a dispatch, so the caller keeps
 * whatever it already had.
 *
 * Accepts the name in any of the forms the routes produce — bare, `client_`
 * prefixed, or MCP prefixed — because each route displays a different one.
 */
export function unwrapDispatchCall(toolName, input) {
  const bare = String(toolName ?? '')
    .replace(/^mcp__client__/, '')
    .replace(/^client_/, '');

  if (bare !== CALL_TOOL_NAME) return null;

  const name = typeof input?.name === 'string' && input.name.trim() ? input.name.trim() : null;
  if (!name) return null;

  return { name, input: parseToolArguments(input?.arguments).args ?? {} };
}

/**
 * The tool that hands back schemas.
 *
 * @param {Function} listClientTools Returns the client's tool definitions, live
 */
export function createSearchClientToolsTool(listClientTools) {
  const names = listClientTools().map(tool => tool.name);

  return {
    description: `Look up the input schema for one of this application's own tools. Only their names are `
      + `listed here — the schemas are withheld until asked for, to keep them out of the conversation. `
      + `Search returns each match's description and full input schema; run the tool itself with `
      + `${CALL_TOOL_NAME}.\n\n`
      + `Query forms:\n`
      + `- "${SELECT_PREFIX}name_a,name_b" — fetch these exact tools\n`
      + `- "export image" — keyword search over names and descriptions\n`
      + `- "+media save" — require "media" to appear, rank the rest by the other terms\n\n`
      + `Available tools: ${names.join(', ')}`,
    inputSchema: z.object({
      query: z.string().describe(`What you want to do, or "${SELECT_PREFIX}" followed by comma-separated tool names.`),
      maxResults: z.number().int().optional().describe(`Maximum number of tools to return (default ${DEFAULT_MAX_RESULTS}). Ignored for "${SELECT_PREFIX}" queries.`)
    }),
    handler: async (input) => {
      const clientTools = listClientTools();
      const { matches, unknown } = searchClientTools(clientTools, input?.query, input?.maxResults);

      return createSuccessResponse({
        matches: matches.map(describeMatch),
        ...(unknown.length ? { unknown } : {}),
        // Only when the search found nothing: the model needs somewhere to go
        // next, and re-listing the catalogue on every hit would put back exactly
        // the per-turn cost this mechanism exists to remove.
        ...(matches.length === 0 ? { available: clientTools.map(tool => tool.name) } : {}),
        usage: `Run one of these with ${CALL_TOOL_NAME}: { "name": "<tool>", "arguments": "<JSON object as a string>" }`
      });
    }
  };
}

/**
 * The tool that runs one.
 *
 * @param {Function} listClientTools Returns the client's tool definitions, live
 * @param {Function} zodSchemaFor    Tool name -> the zod schema built from its JSON Schema
 * @param {Function} invokeClientTool (name, args) -> the tool result envelope
 */
export function createCallClientToolTool(listClientTools, zodSchemaFor, invokeClientTool) {
  return {
    description: `Run one of this application's own tools by name. Fetch its input schema with `
      + `${SEARCH_TOOL_NAME} first — the arguments are checked against that schema here, and a call `
      + `that does not match is rejected before the application ever sees it.`,
    inputSchema: z.object({
      name: z.string().describe(`Name of the tool to run, exactly as ${SEARCH_TOOL_NAME} gave it.`),
      arguments: z.string().optional().describe(
        `The tool's arguments as a JSON object encoded in a string, e.g. {"variableName":"population"}. `
        + `Omit it for a tool that takes no arguments.`)
    }),
    handler: async (input) => {
      const clientTools = listClientTools();
      const name = typeof input?.name === 'string' ? input.name.trim() : '';

      if (!name) {
        return createErrorResponse(`'name' is required — the name of the tool to run, as ${SEARCH_TOOL_NAME} gave it.`);
      }

      const tool = clientTools.find(candidate => candidate.name === name);
      if (!tool) {
        return createErrorResponse(
          `No tool named '${name}'. This application provides: ${clientTools.map(candidate => candidate.name).join(', ')}.`);
      }

      const parsed = parseToolArguments(input?.arguments);
      if (parsed.error) return createErrorResponse(parsed.error);

      // Validated here because nothing downstream will: the direct-registration
      // path gets its checking from MCP, and the manual routes hand the model's
      // arguments to the client untouched. The schema goes back with the failure
      // so the retry is informed rather than another guess.
      const schema = zodSchemaFor(name);
      const validation = schema?.safeParse ? schema.safeParse(parsed.args) : null;
      if (validation && !validation.success) {
        const issues = validation.error.issues
          .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
        return createErrorResponse(
          `Those arguments do not match ${name}'s schema — ${issues}. The schema is: ${JSON.stringify(tool.inputSchema)}`);
      }

      // parsed.args, not validation.data: zod strips keys the client did not
      // declare, and a client whose schema is looser than its implementation
      // would lose them silently. The manual routes pass the model's arguments
      // through unchanged for a directly-registered tool; this matches.
      return invokeClientTool(name, parsed.args);
    }
  };
}
