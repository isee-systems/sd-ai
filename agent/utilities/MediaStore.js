import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import logger from '../../utilities/logger.js';
import config from '../../config.js';

/**
 * MediaStore
 *
 * Where image bytes live while a session is running, and the reason the model
 * never sees any. A picture is put here once and referred to afterwards by an
 * opaque handle — `med_<16 hex>` — which is what travels in tool arguments, in
 * tool results, over the worker IPC channel and into conversation history. The
 * bytes themselves only ever move between this store and the WebSocket frame.
 *
 * On-disk layout, deliberately the same shape as RagStore's:
 *   <sessionTempDir>/media/<mediaId>/blob.bin   raw bytes
 *   <sessionTempDir>/media/<mediaId>/meta.json  { mediaId, name, mimeType, bytes, sha256, ... }
 *
 * Cleanup needs nothing of its own: media/ sits under the session temp dir, so
 * SessionManager's cleanupSessionTempDir removes it with everything else, and it
 * survives an agent switch for free — which is what lets a handle mentioned in a
 * transcript still be viewable after the switch.
 *
 * ## Why the filesystem is the authority
 *
 * RagStore can treat `session.attachedFiles` as the record of what exists,
 * because RAG has one writer (the main process) and one reader (the worker).
 * Media has *two* writers: the main process writes bytes arriving from a client
 * tool result, and the worker writes bytes coming back from generate_image. Two
 * SessionManager instances, one per process, would diverge immediately, and
 * reconciling them would need a new IPC round trip in the hot path.
 *
 * Since <sessionTempDir> is the bwrap bind-mount source, both processes see the
 * same inodes — so `existsSync(blob.bin)` is a cheap oracle that is always right
 * and needs no coordination at all. Ordering is safe in both directions because
 * both writers write synchronously before emitting the message that names the id,
 * which is the same invariant #handleAddFile already relies on.
 */

// Validated on every path-forming call. Handles arrive from both the model and
// the client, so this is the path-traversal guard as much as a format check.
export const MEDIA_ID_RE = /^med_[0-9a-f]{16}$/;

export class MediaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MediaError';
    this.code = code;
  }
}

export class MediaStore {
  constructor(sessionManager, sessionId) {
    this.sessionManager = sessionManager;
    this.sessionId = sessionId;
  }

  static isValidMediaId(mediaId) {
    return typeof mediaId === 'string' && MEDIA_ID_RE.test(mediaId);
  }

  static newMediaId() {
    return `med_${randomBytes(8).toString('hex')}`;
  }

  #root() {
    return join(this.sessionManager.getSessionTempDir(this.sessionId), 'media');
  }

  #dir(mediaId) {
    if (!MediaStore.isValidMediaId(mediaId)) {
      throw new MediaError(`Not a media handle: ${mediaId}`, 'MEDIA_ID_INVALID');
    }
    return join(this.#root(), mediaId);
  }

  /**
   * Put bytes in the store and return their metadata.
   *
   * Deduplicates on sha256, which is not a nicety: an agent that screenshots the
   * interface preview across several turns would otherwise mint a new handle —
   * and a new hydration cost — for byte-identical pixels.
   */
  put(buffer, { name = 'image.png', mimeType = 'image/png', source = 'client', description = '', prompt = '' } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new MediaError('No image bytes to store.', 'MEDIA_EMPTY');
    }

    if (buffer.length > config.mediaMaxItemBytes) {
      throw new MediaError(
        `Image '${name}' is ${buffer.length} bytes, over the ${config.mediaMaxItemBytes}-byte limit.`,
        'MEDIA_TOO_LARGE');
    }

    if (!config.mediaAllowedMimeTypes.includes(mimeType)) {
      throw new MediaError(
        `'${mimeType}' is not an image type this server handles (${config.mediaAllowedMimeTypes.join(', ')}).`,
        'MEDIA_TYPE_UNSUPPORTED');
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = this.list().find(meta => meta.sha256 === sha256);
    if (existing) {
      return existing;
    }

    this.#pruneTo(config.mediaMaxItemsPerSession - 1);

    const mediaId = MediaStore.newMediaId();
    const dir = this.#dir(mediaId);
    mkdirSync(dir, { recursive: true });

    // Bytes before metadata, so a meta.json that exists always has a blob beside it.
    writeFileSync(join(dir, 'blob.bin'), buffer);

    const meta = {
      mediaId,
      name,
      mimeType,
      bytes: buffer.length,
      sha256,
      source,
      description,
      prompt,
      createdAt: new Date().toISOString()
    };
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    return meta;
  }

  /** Decode a base64 payload from the wire and store it. */
  captureBase64(content, { name, mimeType, source = 'client', description = '' } = {}) {
    if (typeof content !== 'string' || content.length === 0) {
      throw new MediaError(`Image '${name}' arrived with no content.`, 'MEDIA_EMPTY');
    }
    return this.put(Buffer.from(content, 'base64'), { name, mimeType, source, description });
  }

  meta(mediaId) {
    const path = join(this.#dir(mediaId), 'meta.json');
    if (!existsSync(path)) {
      throw new MediaError(`No such image: ${mediaId}`, 'MEDIA_MISSING');
    }
    return JSON.parse(readFileSync(path, 'utf8'));
  }

  exists(mediaId) {
    if (!MediaStore.isValidMediaId(mediaId)) return false;
    return existsSync(join(this.#dir(mediaId), 'blob.bin'));
  }

  readBuffer(mediaId) {
    const path = join(this.#dir(mediaId), 'blob.bin');
    if (!existsSync(path)) {
      throw new MediaError(
        `The image ${mediaId} is no longer available. Generate it again if you still need it.`,
        'MEDIA_MISSING');
    }
    return readFileSync(path);
  }

  readBase64(mediaId) {
    return this.readBuffer(mediaId).toString('base64');
  }

  /** Every stored image's metadata, oldest first. */
  list() {
    const root = this.#root();
    if (!existsSync(root)) return [];

    const metas = [];
    for (const entry of readdirSync(root)) {
      if (!MediaStore.isValidMediaId(entry)) continue;
      const path = join(root, entry, 'meta.json');
      if (!existsSync(path)) continue;
      try {
        metas.push(JSON.parse(readFileSync(path, 'utf8')));
      } catch {
        // A half-written meta.json is not worth failing a whole call over.
      }
    }

    return metas.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  count() {
    return this.list().length;
  }

  remove(mediaId) {
    try {
      rmSync(this.#dir(mediaId), { recursive: true, force: true });
    } catch {
      // Already gone.
    }
  }

  /**
   * Drop the oldest images until at most `limit` remain.
   *
   * Deliberately not reference-counted against live conversation history: a
   * handle the model can no longer read reports MEDIA_MISSING as an ordinary
   * tool error telling it to regenerate, which is a far simpler contract than
   * trying to work out which transcript entries still matter.
   */
  #pruneTo(limit) {
    if (limit < 0) return;

    const metas = this.list();
    if (metas.length <= limit) return;

    for (const meta of metas.slice(0, metas.length - limit)) {
      logger.log(`MediaStore: pruning ${meta.mediaId} (${meta.bytes} bytes) — session cap reached`);
      this.remove(meta.mediaId);
    }
  }

  /**
   * How an image is described to the model in text, beside the handle block.
   *
   * Every route gets this line even when it cannot render the picture, so a
   * provider without vision still sees a coherent story rather than a hole.
   */
  describeForModel(meta) {
    const parts = [`image ${meta.mediaId} (${meta.mimeType}`];
    if (meta.bytes) parts.push(`, ${Math.max(1, Math.round(meta.bytes / 1024))} KB`);
    if (meta.name) parts.push(`, "${meta.name}"`);
    parts.push(')');
    const head = parts.join('');
    return meta.description ? `${head} — ${meta.description}` : head;
  }

  /** Total bytes on disk for this session, for logging and diagnostics. */
  totalBytes() {
    return this.list().reduce((sum, meta) => {
      try {
        return sum + statSync(join(this.#root(), meta.mediaId, 'blob.bin')).size;
      } catch {
        return sum;
      }
    }, 0);
  }
}
