/**
 * Regression guard: the sandbox must not expose the application's secrets.
 *
 * spawn() builds `workerEnv` as an explicit per-provider allowlist, and the
 * comment there explains the intent — a provider whose key is not listed never
 * reaches the worker. That intent was undone by `--ro-bind APP_ROOT /app`:
 * `npm start` runs with `--env-file=.env`, so .env sits at the repository root
 * and appeared inside the sandbox at /app/.env, readable by the read_file tool
 * that every agent gets. One prompt injection returned every provider key,
 * including the ones the allowlist withheld.
 *
 * sandboxMaskArgs is tested directly rather than through spawn(): the caller is
 * a private static behind a `process.platform === 'linux'` branch, so on any
 * other platform an end-to-end test would assert nothing at all.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { sandboxMaskArgs } from '../../agent/WorkerSpawner.js';

// The args arrive as a flat list; pair them up to ask "what happened to /app/X?"
function maskFor(args, containerPath) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tmpfs' && args[i + 1] === containerPath) return 'tmpfs';
    if (args[i] === '--ro-bind' && args[i + 2] === containerPath) return `ro-bind:${args[i + 1]}`;
  }
  return null;
}

describe('sandboxMaskArgs', () => {
  let appRoot;

  beforeEach(() => {
    appRoot = mkdtempSync(join(tmpdir(), 'mask-approot-'));
  });

  afterEach(() => {
    rmSync(appRoot, { recursive: true, force: true });
  });

  it('masks .env with /dev/null', () => {
    writeFileSync(join(appRoot, '.env'), 'ANTHROPIC_API_KEY=sk-secret\n');

    expect(maskFor(sandboxMaskArgs(appRoot), '/app/.env')).toBe('ro-bind:/dev/null');
  });

  it('masks .git and .claude directories with a tmpfs', () => {
    mkdirSync(join(appRoot, '.git'));
    mkdirSync(join(appRoot, '.claude'));

    const args = sandboxMaskArgs(appRoot);

    expect(maskFor(args, '/app/.git')).toBe('tmpfs');
    expect(maskFor(args, '/app/.claude')).toBe('tmpfs');
  });

  it('masks every dotenv variant, not just .env', () => {
    writeFileSync(join(appRoot, '.env'), 'A=1');
    writeFileSync(join(appRoot, '.env.local'), 'B=2');
    writeFileSync(join(appRoot, '.env.production'), 'C=3');

    const args = sandboxMaskArgs(appRoot);

    expect(maskFor(args, '/app/.env')).toBe('ro-bind:/dev/null');
    expect(maskFor(args, '/app/.env.local')).toBe('ro-bind:/dev/null');
    expect(maskFor(args, '/app/.env.production')).toBe('ro-bind:/dev/null');
  });

  it('emits no mask for a file that is not there', () => {
    // bwrap cannot bind over a mount point that does not exist inside a
    // read-only /app, so masking an absent path would abort the spawn.
    expect(sandboxMaskArgs(appRoot)).toEqual([]);
  });

  it('leaves application code alone', () => {
    writeFileSync(join(appRoot, '.env'), 'A=1');
    mkdirSync(join(appRoot, 'agent'));
    mkdirSync(join(appRoot, 'node_modules'));

    const args = sandboxMaskArgs(appRoot);

    expect(maskFor(args, '/app/agent')).toBeNull();
    expect(maskFor(args, '/app/node_modules')).toBeNull();
  });

  it('masks the sensitive paths this repository actually has', () => {
    // The check that would actually have caught the bug in production, run
    // against the real APP_ROOT rather than a synthetic one. Which paths are
    // present varies: .env is gitignored, so a CI checkout has none of the
    // dotenv variants. The expectation is therefore read off the directory,
    // with .git — present in every checkout — as the fixed anchor.
    const args = sandboxMaskArgs(process.cwd());

    expect(maskFor(args, '/app/.git')).toBe('tmpfs');
    for (const entry of readdirSync(process.cwd()).filter(name => name.startsWith('.env'))) {
      expect(maskFor(args, `/app/${entry}`)).toBe('ro-bind:/dev/null');
    }
  });
});
