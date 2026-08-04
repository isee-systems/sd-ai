import config from '../../config.js';
import logger from '../../utilities/logger.js';

/**
 * ToolResultFormatter
 *
 * The single owner of "a tool result envelope -> what a provider is handed".
 *
 * Every tool, built-in or client, answers with the same envelope:
 * `{ content: [{ type: 'text', text }, ...], isError }`. Each of the six
 * provider x loop routes then has to turn that into whatever its own API wants,
 * and each used to do it inline -- seven near-identical copies of one
 * filter/map/join, differing only in how they handled a `content` that was not
 * an array, which is precisely where they disagreed.
 *
 * One flattener means a route cannot disagree with another about what a result
 * says, and means the next content block type has exactly one place to be
 * taught about.
 */

/**
 * The internal representation of "there is a picture here": a handle and its
 * metadata, and deliberately no base64.
 *
 * That single choice is what keeps image bytes out of the content array, out of
 * `tool_call_completed`, out of stored conversation history, out of
 * `countTokens(JSON.stringify(messages))`, out of the summariser and off the
 * worker IPC channel — all at once, rather than needing a guard in each. Bytes
 * are fetched from the MediaStore only at the moment a provider call is built,
 * into a copy that is thrown away afterwards.
 */
export function mediaBlock(meta) {
  return {
    type: 'media',
    mediaId: meta.mediaId,
    mimeType: meta.mimeType,
    bytes: meta.bytes,
    name: meta.name,
    ...(meta.description ? { description: meta.description } : {})
  };
}

export function isMediaBlock(block) {
  return !!block && typeof block === 'object' && block.type === 'media';
}

/** The media blocks in a tool result, in order. */
export function mediaBlocksOf(result) {
  const content = contentOf(result);
  return Array.isArray(content) ? content.filter(isMediaBlock) : [];
}

export function hasMedia(result) {
  return mediaBlocksOf(result).length > 0;
}

/**
 * Replace any base64-bearing block with a handle block.
 *
 * Applied inside createToolCallCompletedMessage rather than at its call sites:
 * that function forwards tool-result content verbatim from eight places,
 * including raw Agent-SDK blocks, so guarding it centrally covers every current
 * caller and every future one. Without it, the moment an MCP tool answers with
 * `{type:'image', data:<base64>}` those bytes go straight back down the
 * WebSocket in the tool log.
 */
export function scrubMediaForClient(content) {
  if (!Array.isArray(content)) return content;

  return content.map(block => {
    if (!block || typeof block !== 'object') return block;

    // MCP/Anthropic image blocks carry base64 in `data` or `source.data`.
    const base64 = typeof block.data === 'string' ? block.data
                 : typeof block.source?.data === 'string' ? block.source.data
                 : null;
    if (base64 === null) return block;

    return {
      type: 'media',
      mimeType: block.mimeType || block.media_type || block.source?.media_type || 'image/png',
      bytes: Math.floor(base64.length * 3 / 4),
      ...(block.name ? { name: block.name } : {})
    };
  });
}

/**
 * A result's content blocks, unwrapped one level.
 *
 * Handlers return the envelope, a couple of call sites hold its `content`
 * directly, and the not-found/error paths have historically returned a bare
 * string. Accepting all three here is cheaper than making every caller
 * normalise, and it is what lets the routes pass whatever they are holding.
 */
function contentOf(result) {
  if (result && typeof result === 'object' && !Array.isArray(result) && 'content' in result) {
    return result.content;
  }
  return result;
}

/**
 * One block as text, or null for a block that has no text of its own.
 *
 * Media blocks are dropped rather than described here, and that is safe rather
 * than lossy: whoever attaches a picture also names its handle in the
 * accompanying text block, so a route that can only carry text still tells the
 * model the image exists and what to call it. Describing the block here as well
 * would say it twice.
 */
function blockToText(block) {
  if (typeof block === 'string') return block;
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'text') return block.text ?? '';
  return null;
}

/**
 * THE flattener. Everything a provider is told in words comes through here.
 *
 * @param {object|string|Array} result - a tool result envelope, its content array, or a bare string
 * @returns {string}
 */
export function toolResultToText(result) {
  const content = contentOf(result);

  if (typeof content === 'string') return content;
  if (content === null || content === undefined) return '';

  if (Array.isArray(content)) {
    return content
      .map(blockToText)
      .filter(text => text !== null)
      .join('\n');
  }

  // An object that is not a block array: a tool returned something structured
  // without wrapping it. Stringify rather than drop it -- the model reading
  // "[object Object]" learns nothing, and this is the shape a few older
  // built-ins still answer with.
  return JSON.stringify(content);
}

/**
 * Tool result content for a route that carries blocks in its tool message.
 *
 * A plain string when there is no picture, which is what every route sent before
 * media existed -- so the common case is byte-identical and costs no extra tokens.
 * Block form only when there is something to attach.
 */
export function toolResultToBlocks(result) {
  const media = mediaBlocksOf(result);
  const text = toolResultToText(result);
  if (media.length === 0) return text;
  return [{ type: 'text', text }, ...media];
}

/**
 * How many images one provider call may carry, and how many bytes of them.
 *
 * Consumed newest-first: an older picture hydrates to its text description
 * instead. Nothing is mutated, so the policy is entirely reversible -- a fresh
 * view_media call moves an image back to the newest position and it renders again.
 */
export class MediaBudget {
  constructor({ maxImages = config.mediaMaxImagesInContext, maxBytes = config.mediaMaxHydratedBytes } = {}) {
    this.maxImages = maxImages;
    this.maxBytes = maxBytes;
    this.images = 0;
    this.bytes = 0;
    this.skipped = 0;
  }

  take(block) {
    const bytes = block?.bytes || 0;
    if (this.images >= this.maxImages || this.bytes + bytes > this.maxBytes) {
      this.skipped++;
      return false;
    }
    this.images++;
    this.bytes += bytes;
    return true;
  }
}

// Reads a handle block's bytes, or null when they have been pruned. A missing
// image degrades to its text description rather than failing the call: the model
// can still see it was there, and view_media will tell it the bytes are gone.
function readBase64(store, block) {
  try {
    return store.readBase64(block.mediaId);
  } catch (error) {
    logger.log(`ToolResultFormatter: ${block.mediaId} unavailable for hydration (${error.message})`);
    return null;
  }
}

function describe(block) {
  const size = block.bytes ? `, ${Math.max(1, Math.round(block.bytes / 1024))} KB` : '';
  const name = block.name ? `, "${block.name}"` : '';
  const desc = block.description ? ` — ${block.description}` : '';
  return `[image ${block.mediaId} (${block.mimeType}${size}${name})${desc}]`;
}

// ── Per-turn converters, for the SDK routes that own their own history ─────────

/**
 * MCP content for the anthropic-sdk route.
 *
 * The one route where bytes are attached at the tool-return boundary rather than
 * at request-build time, because the Agent SDK constructs the request itself. The
 * consequence is that base64 traverses worker -> claude CLI stdio; unavoidable
 * here, and the reason the budget is applied per turn instead of over history.
 */
export function toMcpContentResult(result, store, budget = new MediaBudget()) {
  const content = [{ type: 'text', text: toolResultToText(result) }];

  for (const block of mediaBlocksOf(result)) {
    const data = budget.take(block) ? readBase64(store, block) : null;
    if (data) {
      content.push({ type: 'image', data, mimeType: block.mimeType });
    } else {
      content[0].text += `\n${describe(block)}`;
    }
  }

  return { content, isError: !!result?.isError };
}

/**
 * Output for the openrouter-sdk route, which supports multimodal tool results
 * natively: an array whose elements are all input_text/input_image is preserved
 * verbatim by @openrouter/agent. A plain string when there is no picture, which
 * is also what this route sent before.
 */
export function toOpenRouterAgentOutput(result, store, budget = new MediaBudget()) {
  const media = mediaBlocksOf(result);
  const text = toolResultToText(result);
  if (media.length === 0) return text;

  const parts = [{ type: 'input_text', text }];

  for (const block of media) {
    const data = budget.take(block) ? readBase64(store, block) : null;
    if (data) {
      parts.push({
        type: 'input_image',
        detail: 'auto',
        imageUrl: `data:${block.mimeType};base64,${data}`
      });
    } else {
      parts[0].text += `\n${describe(block)}`;
    }
  }

  return parts;
}

// ── History hydrators, for the manual routes ──────────────────────────────────
//
// Each returns a NEW array and clones only the messages that carry a picture:
// `messages` in the manual routes IS the live session context, passed by reference
// into the provider call, so anything written into it lands in stored history, in
// countTokens(JSON.stringify(messages)) and in the agent-switch payload. Hydration
// has to be a transient copy or the bytes become permanent.
//
// Walked backwards so the budget is spent on the newest images.

function hydrateBlocks(blocks, store, budget, toProviderBlock) {
  let changed = false;
  const out = [];

  for (const block of blocks) {
    if (!isMediaBlock(block)) {
      out.push(block);
      continue;
    }

    changed = true;
    const data = budget.take(block) ? readBase64(store, block) : null;
    out.push(data ? toProviderBlock(block, data) : { type: 'text', text: describe(block) });
  }

  return changed ? out : blocks;
}

export function hydrateMessagesForAnthropic(messages, store, budget = new MediaBudget()) {
  const out = [...messages];

  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i];
    if (!Array.isArray(message?.content)) continue;

    let touched = false;
    const content = message.content.map(block => {
      // Images live inside a tool_result's own content array.
      if (block?.type === 'tool_result' && Array.isArray(block.content)) {
        const hydrated = hydrateBlocks(block.content, store, budget, (b, data) => ({
          type: 'image',
          source: { type: 'base64', media_type: b.mimeType, data }
        }));
        if (hydrated !== block.content) {
          touched = true;
          return { ...block, content: hydrated };
        }
        return block;
      }

      if (isMediaBlock(block)) {
        touched = true;
        const data = budget.take(block) ? readBase64(store, block) : null;
        return data
          ? { type: 'image', source: { type: 'base64', media_type: block.mimeType, data } }
          : { type: 'text', text: describe(block) };
      }

      return block;
    });

    if (touched) out[i] = { ...message, content };
  }

  return out;
}

export function hydrateContentsForGemini(contents, store, budget = new MediaBudget()) {
  const out = [...contents];

  for (let i = out.length - 1; i >= 0; i--) {
    const turn = out[i];
    if (!Array.isArray(turn?.parts)) continue;

    let touched = false;
    const parts = turn.parts.map(part => {
      if (!isMediaBlock(part?.media)) return part;

      touched = true;
      const data = budget.take(part.media) ? readBase64(store, part.media) : null;
      return data
        ? { inlineData: { mimeType: part.media.mimeType, data } }
        : { text: describe(part.media) };
    });

    if (touched) out[i] = { ...turn, parts };
  }

  return out;
}

// `imageUrl`, not `image_url`, even though `type` is the wire name. @openrouter/sdk
// validates the whole request through ChatRequest$outboundSchema before it goes out
// and only then remaps the key, so the camelCase form is the one it accepts and the
// snake_case form fails the content-part union — "Input validation failed", with no
// request sent at all. The response side is camelCase too (`finishReason`,
// `imageUrl`), which is the tell that this SDK speaks camelCase throughout.
//
// The official `openai` client is the exact mirror — see hydrateMessagesForOpenAi — so
// the two routes hydrate separately rather than sharing a shape and translating.
export function hydrateMessagesForOpenRouter(messages, store, budget = new MediaBudget()) {
  const out = [...messages];

  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i];
    if (!Array.isArray(message?.content)) continue;

    const content = hydrateBlocks(message.content, store, budget, (block, data) => ({
      type: 'image_url',
      imageUrl: { url: `data:${block.mimeType};base64,${data}` }
    }));

    if (content !== message.content) out[i] = { ...message, content };
  }

  return out;
}

// `image_url`, the wire name, for the vendors reached through the official `openai`
// client. That client sends the object as given and the API rejects an unrecognized
// property outright, so the camelCase form @openrouter/sdk demands is a 400 here.
export function hydrateMessagesForOpenAi(messages, store, budget = new MediaBudget()) {
  const out = [...messages];

  for (let i = out.length - 1; i >= 0; i--) {
    const message = out[i];
    if (!Array.isArray(message?.content)) continue;

    const content = hydrateBlocks(message.content, store, budget, (block, data) => ({
      type: 'image_url',
      image_url: { url: `data:${block.mimeType};base64,${data}` }
    }));

    if (content !== message.content) out[i] = { ...message, content };
  }

  return out;
}
