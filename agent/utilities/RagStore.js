import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { countTokens } from '@anthropic-ai/tokenizer';
import logger from '../../utilities/logger.js';
import TokenUsageReporter, { Provider } from '../../utilities/TokenUsageReporter.js';
import config from '../../config.js';

/**
 * RagStore
 *
 * Universal Retrieval-Augmented Generation for the agent worker. One instance
 * per worker process (a worker serves a single session). Responsibilities:
 *   - extract text from uploaded files (text / PDF / DOCX / XLSX)
 *   - classify each file into a tier:
 *       * manifest tier (<= ragManifestMaxTokens) — read in full on demand
 *       * vector tier   (>  ragManifestMaxTokens) — chunked + embedded for search
 *   - persist artifacts under <sessionTempDir>/rag/<fileId>/ so a worker spawned
 *     on an agent switch reloads them instead of re-embedding
 *   - serve semantic search (brute-force cosine over in-memory vectors)
 *
 * The embedder is injected (see createGeminiEmbedder) so the embedding provider
 * is decoupled from the chat provider and so tests can supply a deterministic
 * fake without a network call.
 *
 * On-disk layout:
 *   <tempDir>/rag/manifest.json                       — array of file metadata
 *   <tempDir>/rag/<fileId>/original.bin               — raw bytes (written by main process)
 *   <tempDir>/rag/<fileId>/extracted.txt              — extracted plain text
 *   <tempDir>/rag/<fileId>/chunks.json                — [{chunkIndex,text,startChar,endChar,page?}]  (vector tier)
 *   <tempDir>/rag/<fileId>/embeddings.json            — [[float,...]] aligned to chunks.json          (vector tier)
 */

// Heavy extraction / embedding libraries are lazy-loaded — most sessions never
// attach a binary doc, and @google/genai + pdfjs cost real import time.
let _pdfjs;
const loadPdfjs = async () => _pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
let _mammoth;
const loadMammoth = async () => _mammoth ??= (await import('mammoth')).default;
let _xlsx;
const loadXlsx = async () => _xlsx ??= await import('xlsx');
let _GoogleGenAI;
const loadGoogleGenai = async () => _GoogleGenAI ??= (await import('@google/genai')).GoogleGenAI;

// Each chunk is embedded with its OWN embedContent call: passing an array of
// `contents` to gemini-embedding-2 aggregates them into a SINGLE embedding
// (its multimodal behavior) rather than returning one per item, which would
// silently collapse every chunk to one vector. We instead issue single-string
// calls and cap how many run concurrently to stay friendly to rate limits.
const EMBED_CONCURRENCY = 8;

function l2normalize(vector) {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector.slice();
  return vector.map(v => v / norm);
}

function dot(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Build the production embedder backed by a Gemini embedding model. Reuses the
 * GEMINI_API_KEY already present in the worker; reports token usage best-effort
 * through the shared TokenUsageReporter.
 */
export function createGeminiEmbedder(clientId) {
  let client = null;
  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      if (!client) {
        const GoogleGenAI = await loadGoogleGenai();
        client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      }
      const reporter = new TokenUsageReporter(config.tokenReporterURL, clientId);
      const out = new Array(texts.length);
      // One embedContent call per text (single-string `contents` cannot aggregate),
      // run in bounded-concurrency waves; results written back by index.
      for (let i = 0; i < texts.length; i += EMBED_CONCURRENCY) {
        const slice = texts.slice(i, i + EMBED_CONCURRENCY);
        await Promise.all(slice.map(async (text, j) => {
          const response = await client.models.embedContent({
            model: config.ragEmbeddingModel,
            contents: text,
            config: { outputDimensionality: config.ragEmbeddingDimensions }
          });
          if (response.usageMetadata) {
            reporter.report({ provider: Provider.GOOGLE, model: config.ragEmbeddingModel, usage: response.usageMetadata, clientKey: false }).catch(() => {});
          }
          out[i + j] = l2normalize(response.embeddings[0].values);
        }));
      }
      return out;
    }
  };
}

/**
 * Extract plain text from raw file bytes based on mimeType (falling back to the
 * filename extension). Returns { text, pageBoundaries } where pageBoundaries is
 * an array of cumulative character offsets at the end of each page (PDF only).
 */
async function extractText(buffer, mimeType, name) {
  const type = (mimeType || '').toLowerCase();
  const ext = (name.split('.').pop() || '').toLowerCase();

  if (type.includes('pdf') || ext === 'pdf') {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0
    }).promise;
    let text = '';
    const pageBoundaries = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
      pageBoundaries.push(text.length);
    }
    return { text, pageBoundaries };
  }

  if (type.includes('wordprocessingml') || ext === 'docx') {
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, pageBoundaries: [] };
  }

  if (type.includes('spreadsheetml') || type.includes('ms-excel') || ext === 'xlsx' || ext === 'xls') {
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts = workbook.SheetNames.map(sheetName => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      return `# Sheet: ${sheetName}\n${csv}`;
    });
    return { text: parts.join('\n\n'), pageBoundaries: [] };
  }

  // Everything else (txt, md, csv, json, source code, ...) is treated as UTF-8 text.
  return { text: buffer.toString('utf8'), pageBoundaries: [] };
}

// Split text into paragraph-ish segments, preserving each segment's char offsets.
function splitSegments(text) {
  const segments = [];
  const re = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    segments.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return segments;
}

// Hard-split a single oversized segment into fixed character windows (used when
// one paragraph alone exceeds the chunk budget). ~4 chars/token is a coarse but
// adequate heuristic for sizing the window.
function hardSplit(segment, chunkTokens) {
  const windowChars = chunkTokens * 4;
  const pieces = [];
  for (let offset = 0; offset < segment.text.length; offset += windowChars) {
    const slice = segment.text.slice(offset, offset + windowChars);
    pieces.push({ text: slice, startChar: segment.start + offset, endChar: segment.start + offset + slice.length });
  }
  return pieces;
}

function pageForOffset(pageBoundaries, charOffset) {
  if (!pageBoundaries || pageBoundaries.length === 0) return null;
  for (let i = 0; i < pageBoundaries.length; i++) {
    if (charOffset < pageBoundaries[i]) return i + 1;
  }
  return pageBoundaries.length;
}

/**
 * Chunk extracted text into ~chunkTokens-sized pieces with overlapTokens of
 * carry-over between adjacent chunks, recording char offsets (and page when
 * available) for source attribution.
 */
function chunkText(text, chunkTokens, overlapTokens, pageBoundaries) {
  const segments = splitSegments(text);
  const chunks = [];
  let current = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const startChar = current[0].start;
    const endChar = current[current.length - 1].end;
    chunks.push({
      text: text.slice(startChar, endChar),
      startChar,
      endChar,
      page: pageForOffset(pageBoundaries, startChar)
    });
    // Seed the next chunk with trailing segments up to the overlap budget.
    const overlap = [];
    let overlapTokensUsed = 0;
    for (let i = current.length - 1; i >= 0; i--) {
      const segTokens = countTokens(current[i].text);
      if (overlapTokensUsed + segTokens > overlapTokens) break;
      overlap.unshift(current[i]);
      overlapTokensUsed += segTokens;
    }
    current = overlap;
    currentTokens = overlapTokensUsed;
  };

  for (const segment of segments) {
    const segTokens = countTokens(segment.text);

    if (segTokens > chunkTokens) {
      // A single paragraph bigger than the budget: flush what we have, drop the
      // overlap (it would mix unrelated context), then window-split this one.
      flush();
      current = [];
      currentTokens = 0;
      for (const piece of hardSplit(segment, chunkTokens)) {
        chunks.push({ ...piece, text: text.slice(piece.startChar, piece.endChar), page: pageForOffset(pageBoundaries, piece.startChar) });
      }
      continue;
    }

    if (currentTokens + segTokens > chunkTokens && current.length > 0) {
      flush();
    }
    current.push(segment);
    currentTokens += segTokens;
  }
  flush();

  return chunks.filter(c => c.text.trim().length > 0);
}

export class RagStore {
  constructor(embedder) {
    this.embedder = embedder;
    // fileId -> { chunks: [...], vectors: number[][] }. Lazily populated from
    // disk on first search; survives for the life of this worker.
    this.cache = new Map();
  }

  #ragDir(tempDir) { return join(tempDir, 'rag'); }
  #fileDir(tempDir, fileId) { return join(this.#ragDir(tempDir), fileId); }
  #manifestPath(tempDir) { return join(this.#ragDir(tempDir), 'manifest.json'); }

  // The shared rag/<fileId> dir was deleted by a remove_file (the main process
  // rmSync's it in #handleRemoveFile; our own removeFile would too) while a
  // processFile was suspended on a slow await — so a write below it now fails
  // with ENOENT on a vanished parent. Surface it as a typed, benign error so
  // callers log it quietly, the same treatment the original.bin read gets above.
  #removedDuringProcessing(fileId) {
    const err = new Error(`rag dir for file ${fileId} removed during processing`);
    err.code = 'FILE_REMOVED_DURING_PROCESSING';
    return err;
  }

  readManifest(tempDir) {
    const path = this.#manifestPath(tempDir);
    if (!existsSync(path)) return [];
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      logger.warn(`RagStore: failed to read manifest ${path}: ${err.message}`);
      return [];
    }
  }

  #writeManifest(tempDir, list) {
    mkdirSync(this.#ragDir(tempDir), { recursive: true });
    writeFileSync(this.#manifestPath(tempDir), JSON.stringify(list, null, 2));
  }

  /**
   * Extract, classify, (chunk + embed if large), and persist a single file whose
   * raw bytes already live at <tempDir>/rag/<fileId>/original.bin. Updates the
   * on-disk manifest and the session's attachedFiles metadata. Returns the meta.
   */
  async processFile(sessionManager, sessionId, fileMeta) {
    const tempDir = sessionManager.getSessionTempDir(sessionId);
    const dir = this.#fileDir(tempDir, fileMeta.fileId);
    const originalPath = join(dir, 'original.bin');
    if (!existsSync(originalPath)) {
      // The main process writes original.bin (synchronously) before signalling
      // us, and we read it back through the shared /session bind mount — so a
      // missing file here is never a simple timing race. Capture a compact view
      // of what this worker can actually see so the caller can tell a benign
      // mid-flight removal (the file's whole dir is gone — remove_file rmSync'd
      // the shared rag/<id> out from under a still-queued add_file) apart from an
      // unexpected loss / stale bind-mount inode (the dir is present, or the rag
      // root is unexpectedly empty though the main wrote here).
      const ragDir = this.#ragDir(tempDir);
      const fileDirExists = existsSync(dir);
      let ragRootExists = false;
      let ragRootEntries = [];
      try {
        ragRootExists = existsSync(ragDir);
        if (ragRootExists) ragRootEntries = readdirSync(ragDir);
      } catch { /* best-effort diagnostic only */ }
      const err = new Error(`original.bin missing for file ${fileMeta.fileId}`);
      err.code = 'ORIGINAL_BIN_MISSING';
      err.fileDirExists = fileDirExists;
      err.diagnostic = `tempDir=${tempDir} fileDirExists=${fileDirExists} ragRootExists=${ragRootExists} ragRootEntries=[${ragRootEntries.join(', ')}]`;
      throw err;
    }

    const buffer = readFileSync(originalPath);
    const { text, pageBoundaries } = await extractText(buffer, fileMeta.mimeType, fileMeta.name);

    // Everything below writes artifacts into `dir`. Between the original.bin read
    // above and these writes we cross slow awaits (extractText, and embedder.embed
    // below). A remove_file arriving in that window deletes the shared rag/<fileId>
    // dir out from under us, so a write here throws ENOENT on a parent that no
    // longer exists. That's the same benign mid-flight removal the original.bin
    // read already handles — detect a vanished dir and surface it as such instead
    // of letting it escape as a loud, unexpected ENOENT.
    try {
      writeFileSync(join(dir, 'extracted.txt'), text);

      const tokenCount = countTokens(text);
      let tier = 'manifest';
      let chunkCount = 0;

      if (tokenCount > config.ragManifestMaxTokens) {
        tier = 'vector';
        const chunks = chunkText(text, config.ragChunkTokens, config.ragChunkOverlap, pageBoundaries);
        // Don't pay for (network) embedding if the file was already removed while
        // we extracted — the dir is gone and the writes below would fail anyway.
        // Only short-circuit on the benign remove_file race (file dir gone, rag
        // root intact); a vanished rag root is a teardown bug left for the writes
        // to surface loudly below.
        if (!existsSync(dir) && existsSync(this.#ragDir(tempDir))) throw this.#removedDuringProcessing(fileMeta.fileId);
        const vectors = await this.embedder.embed(chunks.map(c => c.text));
        // Guard the chunk↔vector alignment search() relies on. A mismatch means the
        // embedder collapsed inputs (e.g. an embedding API aggregating a batch) and
        // would silently strand most chunks as unsearchable.
        if (vectors.length !== chunks.length) {
          throw new Error(`Embedding count (${vectors.length}) does not match chunk count (${chunks.length}) for ${fileMeta.name}`);
        }
        const chunkRecords = chunks.map((c, i) => ({
          chunkIndex: i,
          text: c.text,
          startChar: c.startChar,
          endChar: c.endChar,
          ...(c.page != null ? { page: c.page } : {})
        }));
        writeFileSync(join(dir, 'chunks.json'), JSON.stringify(chunkRecords));
        writeFileSync(join(dir, 'embeddings.json'), JSON.stringify(vectors));
        chunkCount = chunkRecords.length;
        this.cache.set(fileMeta.fileId, { chunks: chunkRecords, vectors });
      }

      const meta = {
        fileId: fileMeta.fileId,
        name: fileMeta.name,
        mimeType: fileMeta.mimeType,
        bytes: buffer.length,
        tokenCount,
        tier,
        chunkCount,
        status: 'ready',
        addedAt: fileMeta.addedAt
      };

      const list = this.readManifest(tempDir).filter(f => f.fileId !== meta.fileId);
      list.push(meta);
      this.#writeManifest(tempDir, list);
      sessionManager.addAttachedFile(sessionId, meta);

      logger.log(`RagStore: processed ${meta.name} (${meta.tier} tier, ${tokenCount} tokens, ${chunkCount} chunks)`);
      return meta;
    } catch (err) {
      // A write failed because the file's dir vanished mid-flight. If the rag root
      // still stands, this is the benign remove_file race (remove_file only deletes
      // rag/<id>); reclassify so callers log it quietly. If the rag root is gone
      // too, the whole session tree was torn down under a live worker (a teardown
      // race / stale bind mount) — a genuine bug, so let the raw ENOENT propagate
      // and be logged loudly with its stack.
      if (err.code === 'ENOENT' && !existsSync(dir) && existsSync(this.#ragDir(tempDir))) {
        throw this.#removedDuringProcessing(fileMeta.fileId);
      }
      throw err;
    }
  }

  /**
   * Delete a file's artifacts from disk, drop its cached vectors, and remove it
   * from the manifest + session metadata.
   */
  removeFile(sessionManager, sessionId, fileId) {
    const tempDir = sessionManager.getSessionTempDir(sessionId);
    this.cache.delete(fileId);
    try {
      rmSync(this.#fileDir(tempDir, fileId), { recursive: true, force: true });
    } catch (err) {
      logger.warn(`RagStore: failed to remove file dir for ${fileId}: ${err.message}`);
    }
    const list = this.readManifest(tempDir).filter(f => f.fileId !== fileId);
    this.#writeManifest(tempDir, list);
    sessionManager.removeAttachedFile(sessionId, fileId);
  }

  #loadVectors(tempDir, fileId) {
    if (this.cache.has(fileId)) return this.cache.get(fileId);
    const dir = this.#fileDir(tempDir, fileId);
    const chunksPath = join(dir, 'chunks.json');
    const embPath = join(dir, 'embeddings.json');
    if (!existsSync(chunksPath) || !existsSync(embPath)) return null;
    try {
      const entry = {
        chunks: JSON.parse(readFileSync(chunksPath, 'utf8')),
        vectors: JSON.parse(readFileSync(embPath, 'utf8'))
      };
      this.cache.set(fileId, entry);
      return entry;
    } catch (err) {
      logger.warn(`RagStore: failed to load vectors for ${fileId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Semantic search over vector-tier files. Embeds the query and returns the
   * top-k chunks by cosine similarity (== dot product on normalized vectors),
   * each with source attribution.
   */
  async search(sessionManager, sessionId, query, options) {
    const topK = options?.topK ?? config.ragSearchTopK;
    const fileIdFilter = options?.fileId ?? null;
    const tempDir = sessionManager.getSessionTempDir(sessionId);

    const manifest = this.readManifest(tempDir);
    const vectorFiles = manifest.filter(f => f.tier === 'vector' && (!fileIdFilter || f.fileId === fileIdFilter));
    if (vectorFiles.length === 0) return [];

    const [queryVector] = await this.embedder.embed([query]);
    const scored = [];
    for (const file of vectorFiles) {
      const entry = this.#loadVectors(tempDir, file.fileId);
      if (!entry) continue;
      for (let i = 0; i < entry.vectors.length; i++) {
        const chunk = entry.chunks[i];
        scored.push({
          fileId: file.fileId,
          name: file.name,
          chunkIndex: chunk.chunkIndex,
          location: { startChar: chunk.startChar, endChar: chunk.endChar, ...(chunk.page != null ? { page: chunk.page } : {}) },
          score: dot(queryVector, entry.vectors[i]),
          text: chunk.text
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Reconcile on worker startup (initialize IPC). Registers metadata for files
   * already processed on disk (e.g. carried across an agent switch — no
   * re-embedding) and processes any whose bytes exist but text has not yet been
   * extracted (e.g. uploaded before a worker existed). Returns the list of files
   * that were freshly processed so the caller can notify the client.
   */
  async reconcile(sessionManager, sessionId, attachedFiles) {
    const tempDir = sessionManager.getSessionTempDir(sessionId);
    const diskManifest = this.readManifest(tempDir);
    const diskById = new Map(diskManifest.map(m => [m.fileId, m]));
    const incoming = attachedFiles || [];
    const seen = new Set();
    const freshlyProcessed = [];

    for (const file of incoming) {
      seen.add(file.fileId);
      const dir = this.#fileDir(tempDir, file.fileId);
      const alreadyExtracted = existsSync(join(dir, 'extracted.txt')) && diskById.has(file.fileId);

      if (alreadyExtracted) {
        sessionManager.addAttachedFile(sessionId, diskById.get(file.fileId));
      } else if (existsSync(join(dir, 'original.bin'))) {
        try {
          freshlyProcessed.push(await this.processFile(sessionManager, sessionId, file));
        } catch (err) {
          // A removal racing this reconcile-time processing is benign (see
          // processFile); anything else is a real failure worth an error log.
          if (err.code === 'FILE_REMOVED_DURING_PROCESSING' || err.code === 'ORIGINAL_BIN_MISSING') {
            logger.log(`RagStore: reconcile skipped ${file.fileId} (removed during processing)`);
          } else {
            logger.error(`RagStore: reconcile failed to process ${file.fileId}: ${err.message}`);
          }
          const meta = { ...file, status: 'error', error: err.message };
          sessionManager.addAttachedFile(sessionId, meta);
          freshlyProcessed.push(meta);
        }
      } else {
        sessionManager.addAttachedFile(sessionId, { ...file, status: 'error', error: 'file bytes missing' });
      }
    }

    // Defensive: register any disk-manifest entries the main process didn't send.
    for (const meta of diskManifest) {
      if (!seen.has(meta.fileId)) sessionManager.addAttachedFile(sessionId, meta);
    }

    return freshlyProcessed;
  }
}
