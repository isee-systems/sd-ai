/**
 * Regression guard: path traversal through Express route parameters.
 *
 * Three routes turn a `:param` into a filesystem path — two of them into a
 * module specifier handed to a dynamic `import()`, which executes it. They were
 * guarded by `existsSync(join(cwd, 'engines', param, 'engine.js'))`, which
 * validates a path the caller steered rather than the caller's input.
 *
 * The subtlety that made this exploitable, and the reason these tests use
 * percent-encoding: Express matches the route against the still-encoded
 * pathname, then runs `decodeURIComponent` on each captured parameter
 * (express/lib/router/layer.js, decode_param). `:engine` will not match a
 * literal `/`, but it matches `..%2f..%2ftmp` — which arrives in the handler
 * already decoded to `../../tmp`. A traversal test written with plain slashes
 * passes for the wrong reason (no route match at all), so every case here is
 * encoded.
 *
 * The fix is an allowlist of real directory/module names (routes/v1/engineRegistry.js);
 * these tests pin that a traversing name is rejected while ordinary names still work.
 */

import request from 'supertest';
import express from 'express';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import engineParametersRouter from '../../../routes/v1/engineParameters.js';
import evalsTestDetailsRouter from '../../../routes/v1/evalsTestDetails.js';
import leaderboardRouter from '../../../routes/v1/leaderboard.js';

const TIMEOUT = 60 * 1000;

// A module planted where a traversing parameter can reach it. Without this the
// traversal tests below would pass for the wrong reason — the old existsSync
// check also 404s a path with nothing at the end of it, so a test aimed at an
// empty directory proves nothing. This module exists, exports the shape the
// route expects, and records that it was executed.
const PLANT_DIR = join(process.cwd(), 'tests', 'tmp-planted-module');
const PLANT_MARKER = join(PLANT_DIR, 'executed.marker');
const PLANT_SOURCE = `
import { writeFileSync } from 'fs';
import { join } from 'path';
writeFileSync(join(import.meta.dirname, 'executed.marker'), 'imported');
export default class Planted {
  static supportedModes() { return ['cld']; }
  additionalParameters() { return []; }
  async generate() { return { model: {} }; }
}
`;

function plantModule() {
  mkdirSync(PLANT_DIR, { recursive: true });
  writeFileSync(join(PLANT_DIR, 'engine.js'), PLANT_SOURCE);
  writeFileSync(join(PLANT_DIR, 'category.js'), PLANT_SOURCE);
}

function clearPlantedModule() {
  rmSync(PLANT_DIR, { recursive: true, force: true });
}

// Encoded so the segment still matches `:param` but decodes to a traversal.
const TRAVERSING_NAMES = [
  '..%2f..%2f..%2ftmp',
  '..%2F..%2F..%2Fetc',
  '%2e%2e%2f%2e%2e%2ftmp',
  'qualitative%2f..%2f..%2ftmp',
  '..%2f..%2fconfig',
];

describe('engine name traversal (GET /:engine/parameters)', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', engineParametersRouter);
  });

  it('still serves a legitimate engine', async () => {
    const response = await request(app).get('/qualitative/parameters');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.parameters)).toBe(true);
  }, TIMEOUT);

  it.each(TRAVERSING_NAMES)('404s the traversing engine name %s', async (name) => {
    const response = await request(app).get(`/${name}/parameters`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  }, TIMEOUT);

  it('404s an engine name that is not a directory under engines/', async () => {
    const response = await request(app).get('/no-such-engine/parameters');

    expect(response.status).toBe(404);
  }, TIMEOUT);

  // The test that actually proves the fix. `engines/../tests/tmp-planted-module/engine.js`
  // exists and is importable, so the old existsSync guard approved it and Node
  // executed it. The allowlist rejects the name before any path is built.
  it('refuses to import a module that exists outside engines/', async () => {
    plantModule();
    try {
      const response = await request(app).get('/..%2ftests%2ftmp-planted-module/parameters');

      expect(response.status).toBe(404);
      expect(existsSync(PLANT_MARKER)).toBe(false);
    } finally {
      clearPlantedModule();
    }
  }, TIMEOUT);
});

describe('evals category traversal (GET /:category/:group/:testname)', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', evalsTestDetailsRouter);
  });

  it.each(TRAVERSING_NAMES)('404s the traversing category %s', async (name) => {
    const response = await request(app).get(`/${name}/somegroup/sometest`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  }, TIMEOUT);

  // Distinguishes "rejected by the allowlist" from "rejected later, having
  // already imported the module" — the message only reaches the group check if
  // the category was accepted as legitimate.
  it('lets a real category through to the group lookup', async () => {
    const response = await request(app).get('/physicalLaws/no-such-group/no-such-test');

    expect(response.status).toBe(404);
    expect(response.body.message).toMatch(/Group/);
  }, TIMEOUT);

  it('refuses to import a module that exists outside evals/categories/', async () => {
    plantModule();
    try {
      const response = await request(app)
        .get('/..%2f..%2ftests%2ftmp-planted-module%2fcategory/g/t');

      expect(response.status).toBe(404);
      expect(existsSync(PLANT_MARKER)).toBe(false);
    } finally {
      clearPlantedModule();
    }
  }, TIMEOUT);
});

describe('leaderboard mode traversal (GET /:mode)', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', leaderboardRouter);
  });

  // `mode` is interpolated into `leaderboard_<mode>_full_results.json.gz` and then
  // path.join'd, so an encoded separator escapes evals/results entirely.
  it.each([
    'x%2f..%2f..%2f..%2f..%2fetc%2fpasswd',
    '..%2f..%2f..%2fpackage',
    'cld%2f..%2f..%2fconfig',
  ])('404s the traversing mode %s', async (mode) => {
    const response = await request(app).get(`/${mode}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  }, TIMEOUT);

  it('accepts a plain word mode', async () => {
    const response = await request(app).get('/cld');

    // 200 when the results file is present, 404 when it is not — either way the
    // request got past the name check rather than being rejected as malformed.
    expect([200, 404]).toContain(response.status);
  }, TIMEOUT);

  // `generation` reaches the same filename, so it needs the same treatment as `mode`:
  // resolved against the known list, never interpolated from what the caller sent.
  it.each([
    '..%2f..%2f..%2fpackage',
    'v1%2f..%2f..%2fconfig',
    'V1',
    'v99',
  ])('404s the unknown generation %s without reading a file', async (generation) => {
    const response = await request(app).get(`/sfd?generation=${generation}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  }, TIMEOUT);

  it('404s a known generation with no rows in the file', async () => {
    // v2 is declared but nothing has been collected into it yet, so it must be reported
    // as absent rather than served as an empty leaderboard.
    const response = await request(app).get('/sfd?generation=v2');

    if (response.status === 404) {
      expect(response.body.success).toBe(false);
      expect(response.body.generations).toEqual(expect.any(Array));
    } else {
      // Once v2 results are collected this legitimately becomes a 200.
      expect(response.status).toBe(200);
      expect(response.body.generation).toBe('v2');
      expect(response.body.data.results.length).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('rejects a mode that is not a real leaderboard', async () => {
    const response = await request(app).get('/notamode');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
  }, TIMEOUT);

  it('lists the modes that have results', async () => {
    // Regression: the previous implementation matched filenames against
    // /leaderboard([A-Z]+)_full_results\.json/, which cannot match the real
    // `leaderboard_cld_full_results.json.gz`, so this endpoint always returned no modes.
    const response = await request(app).get('/');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.modes).toEqual(expect.arrayContaining(['cld', 'sfd', 'discussion']));
    for (const entry of response.body.available) {
      expect(entry.generations.length).toBeGreaterThan(0);
    }
  }, TIMEOUT);
});
