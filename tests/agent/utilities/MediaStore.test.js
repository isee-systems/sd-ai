/**
 * Unit tests for MediaStore. No network and no WebSocket: the store's whole job
 * is bytes on disk behind an opaque handle, so everything here is real I/O into
 * a temp session directory, in the same idiom as RagStore.test.js.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { MediaStore, MediaError, MEDIA_ID_RE } from '../../../agent/utilities/MediaStore.js';
import { SessionManager } from '../../../agent/utilities/SessionManager.js';
import config from '../../../config.js';

// A real 1x1 PNG. Small enough to inline, valid enough that anything downstream
// which actually decodes it will succeed.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

describe('MediaStore', () => {
  let sessionManager;
  let sessionId;
  let tempDir;
  let store;

  beforeEach(() => {
    const base = join(tmpdir(), `mediastore-test-${Date.now()}-${randomBytes(4).toString('hex')}`);
    sessionManager = new SessionManager({ tempBasePath: base, disableCleanup: true });
    sessionId = sessionManager.createSession(null);
    tempDir = sessionManager.getSessionTempDir(sessionId);
    store = new MediaStore(sessionManager, sessionId);
  });

  afterEach(() => {
    sessionManager.shutdown();
  });

  describe('put / read round trip', () => {
    it('stores bytes and returns a well-formed handle', () => {
      const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });

      expect(meta.mediaId).toMatch(MEDIA_ID_RE);
      expect(meta.bytes).toBe(PNG_1x1.length);
      expect(meta.name).toBe('hero.png');
      expect(meta.sha256).toHaveLength(64);
      expect(store.exists(meta.mediaId)).toBe(true);
    });

    it('writes blob.bin and meta.json under the session temp dir', () => {
      const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });
      const dir = join(tempDir, 'media', meta.mediaId);

      expect(existsSync(join(dir, 'blob.bin'))).toBe(true);
      expect(readFileSync(join(dir, 'blob.bin')).equals(PNG_1x1)).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).mediaId).toBe(meta.mediaId);
    });

    it('round trips through base64, which is how bytes arrive from a client', () => {
      const meta = store.captureBase64(PNG_1x1.toString('base64'),
        { name: 'preview.png', mimeType: 'image/png', description: 'a screenshot' });

      expect(store.readBuffer(meta.mediaId).equals(PNG_1x1)).toBe(true);
      expect(store.readBase64(meta.mediaId)).toBe(PNG_1x1.toString('base64'));
      expect(store.meta(meta.mediaId).description).toBe('a screenshot');
    });
  });

  describe('handle validation — this is the path traversal guard', () => {
    it.each([
      ['a traversal attempt', '../../../etc/passwd'],
      ['a traversal inside a valid-looking handle', 'med_../../etc'],
      ['the wrong prefix', 'file_0011223344556677'],
      ['too few hex digits', 'med_001122'],
      ['uppercase hex', 'med_00112233445566AA'],
      ['an empty string', ''],
      ['a non-string', 42],
    ])('rejects %s', (_label, bad) => {
      expect(MediaStore.isValidMediaId(bad)).toBe(false);
      expect(store.exists(bad)).toBe(false);
      expect(() => store.readBuffer(bad)).toThrow(MediaError);
    });

    it('accepts an id it minted itself', () => {
      expect(MediaStore.isValidMediaId(MediaStore.newMediaId())).toBe(true);
    });
  });

  describe('caps', () => {
    it('refuses an image over the per-item byte cap', () => {
      const huge = Buffer.alloc(config.mediaMaxItemBytes + 1);
      expect(() => store.put(huge, { name: 'huge.png', mimeType: 'image/png' }))
        .toThrow(expect.objectContaining({ code: 'MEDIA_TOO_LARGE' }));
    });

    it('refuses a mime type no provider route could render', () => {
      expect(() => store.put(PNG_1x1, { name: 'x.tiff', mimeType: 'image/tiff' }))
        .toThrow(expect.objectContaining({ code: 'MEDIA_TYPE_UNSUPPORTED' }));
    });

    it('refuses empty bytes rather than storing a zero-length image', () => {
      expect(() => store.put(Buffer.alloc(0), { name: 'x.png', mimeType: 'image/png' }))
        .toThrow(expect.objectContaining({ code: 'MEDIA_EMPTY' }));
    });

    it('prunes the oldest once the session cap is reached', () => {
      // Distinct bytes per item, or dedup would collapse them into one.
      const metas = [];
      for (let i = 0; i < config.mediaMaxItemsPerSession + 3; i++) {
        metas.push(store.put(Buffer.concat([PNG_1x1, Buffer.from([i, i >> 8])]),
          { name: `f${i}.png`, mimeType: 'image/png' }));
      }

      expect(store.count()).toBeLessThanOrEqual(config.mediaMaxItemsPerSession);
      // Oldest gone, newest kept.
      expect(store.exists(metas[0].mediaId)).toBe(false);
      expect(store.exists(metas[metas.length - 1].mediaId)).toBe(true);
    });

    it('reports a pruned handle as missing with an actionable message', () => {
      const meta = store.put(PNG_1x1, { name: 'gone.png', mimeType: 'image/png' });
      store.remove(meta.mediaId);

      expect(() => store.readBuffer(meta.mediaId))
        .toThrow(expect.objectContaining({ code: 'MEDIA_MISSING' }));
      expect(() => store.readBuffer(meta.mediaId)).toThrow(/again/i);
    });
  });

  describe('deduplication', () => {
    it('returns the existing handle for byte-identical content', () => {
      const first = store.put(PNG_1x1, { name: 'shot.png', mimeType: 'image/png' });
      const second = store.put(PNG_1x1, { name: 'shot-again.png', mimeType: 'image/png' });

      expect(second.mediaId).toBe(first.mediaId);
      expect(store.count()).toBe(1);
    });

    it('keeps distinct handles for different content', () => {
      const a = store.put(PNG_1x1, { name: 'a.png', mimeType: 'image/png' });
      const b = store.put(Buffer.concat([PNG_1x1, Buffer.from([0])]),
        { name: 'b.png', mimeType: 'image/png' });

      expect(b.mediaId).not.toBe(a.mediaId);
      expect(store.count()).toBe(2);
    });
  });

  describe('the filesystem is the authority, not in-memory state', () => {
    it('sees an image a second store instance wrote', () => {
      // This is the generate_image-in-the-worker case: a different process, a
      // different SessionManager, the same bind-mounted directory.
      const other = new MediaStore(sessionManager, sessionId);
      const meta = other.put(PNG_1x1, { name: 'from-worker.png', mimeType: 'image/png' });

      expect(store.exists(meta.mediaId)).toBe(true);
      expect(store.readBuffer(meta.mediaId).equals(PNG_1x1)).toBe(true);
    });

    it('reports an id whose bytes were deleted underneath it as missing', () => {
      const meta = store.put(PNG_1x1, { name: 'x.png', mimeType: 'image/png' });
      store.remove(meta.mediaId);
      expect(store.exists(meta.mediaId)).toBe(false);
    });

    it('survives a half-written meta.json rather than failing the whole listing', () => {
      const good = store.put(PNG_1x1, { name: 'good.png', mimeType: 'image/png' });
      const brokenDir = join(tempDir, 'media', 'med_ffffffffffffffff');
      mkdirSync(brokenDir, { recursive: true });
      writeFileSync(join(brokenDir, 'meta.json'), '{ not json');

      expect(store.list().map(m => m.mediaId)).toEqual([good.mediaId]);
    });

    it('lists nothing before anything has been stored', () => {
      expect(store.list()).toEqual([]);
      expect(store.count()).toBe(0);
    });
  });

  describe('describeForModel', () => {
    it('names the handle, type and size so a route without vision still has a story', () => {
      const meta = store.put(PNG_1x1, { name: 'hero.png', mimeType: 'image/png' });
      const line = store.describeForModel(store.meta(meta.mediaId));

      expect(line).toContain(meta.mediaId);
      expect(line).toContain('image/png');
      expect(line).toContain('hero.png');
    });

    it('appends the description when there is one', () => {
      const meta = store.put(PNG_1x1,
        { name: 'hero.png', mimeType: 'image/png', description: 'the plant at dusk' });

      expect(store.describeForModel(store.meta(meta.mediaId))).toContain('the plant at dusk');
    });
  });
});
