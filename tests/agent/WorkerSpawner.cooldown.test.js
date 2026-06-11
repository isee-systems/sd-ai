/**
 * Tests the bwrap self-healing cooldown in agent/WorkerSpawner.js.
 *
 * Regression guard for the "poisoned PM2 cluster worker" incident: a transient
 * bwrap failure used to latch a PERMANENT, process-wide `#bwrapBroken = true`
 * flag, so a single momentary blip poisoned one cluster worker for its entire
 * lifetime — every session PM2 routed to it threw SandboxUnavailableError
 * forever while sibling workers served fine. The flag is now a 60s cooldown
 * timestamp that re-probes bwrap once it elapses.
 *
 * This lives in its own file because it mocks `child_process` to force the
 * Linux+bwrap path and simulate bwrap exiting early — that mock would break the
 * real-spawn integration tests in WorkerSpawner.test.js (Jest isolates the
 * module registry per test file).
 */

import { describe, it, expect, jest, beforeAll, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

// ── Mock child_process so spawn() takes the bwrap branch and "bwrap" fails ────
// `which bwrap` resolves (so the branch is entered); `which claude` is treated
// as not found. The spawned bwrap proc exits early without its IPC socket ever
// connecting, which WorkerSpawner reads as a failed attempt.
const mockSpawn = jest.fn();
const mockFork = jest.fn();
const mockExecSync = jest.fn((cmd) => {
  if (String(cmd).includes('bwrap')) return '/usr/bin/bwrap\n';
  throw new Error('not found'); // e.g. `which claude`
});

jest.unstable_mockModule('child_process', () => ({
  spawn: mockSpawn,
  fork: mockFork,
  execSync: mockExecSync,
  default: { spawn: mockSpawn, fork: mockFork, execSync: mockExecSync },
}));

let WorkerSpawner, SandboxUnavailableError;

// A fake bwrap process that exits early (non-zero) so the IPC socket never
// connects. Emits 'exit' on a 0ms timer so it fires after spawn() has wired up
// worker.attach() + the early-exit listener.
function makeFailingProc() {
  const proc = new EventEmitter();
  proc.pid = 4242;
  proc.stderr = null; // WorkerSpawner does `if (proc.stderr)` — skip the pipe wiring
  proc.kill = () => {};
  setTimeout(() => proc.emit('exit', 1, null), 0);
  return proc;
}

const tempDirs = [];
function makeTempDir() {
  // Short path under /tmp keeps the Unix-socket path well under the ~104-char
  // sun_path limit (os.tmpdir() on macOS is long enough to overflow it).
  const dir = join('/tmp', `sdcd-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

// Drive an in-flight spawn() promise to settlement by advancing fake time in
// small steps — flushing the 0ms exit emits, the 3s inter-attempt sleeps, and
// yielding to the real event loop so IpcWorker's socket bind ('listening') can
// resolve. Stops as soon as the promise settles so we don't over-advance the
// clock (which would skew the cooldown-window assertions).
async function settle(promise) {
  let done = false;
  const guarded = promise.then(
    (v) => { done = true; return { ok: true, value: v }; },
    (e) => { done = true; return { ok: false, error: e }; },
  );
  for (let i = 0; i < 300 && !done; i++) {
    await jest.advanceTimersByTimeAsync(100);
  }
  return guarded;
}

beforeAll(async () => {
  // #allowUnsandboxedFallback is captured at module-eval time, so this must be
  // cleared before the import: we want hard-fail (throw) mode, not fork fallback.
  delete process.env.ALLOW_UNSANDBOXED_FALLBACK;
  ({ WorkerSpawner, SandboxUnavailableError } = await import('../../agent/WorkerSpawner.js'));
});

describe('WorkerSpawner bwrap cooldown (self-healing, not a permanent latch)', () => {
  let originalPlatform;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => makeFailingProc());
    mockFork.mockReset();
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    jest.useRealTimers();
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('arms the cooldown after exhausting retries, fast-fails inside the window, then re-probes once it elapses', async () => {
    const COOLDOWN_MS = 60_000;

    // 1) First spawn: bwrap exits early on all 3 attempts → arms the cooldown
    //    and rejects with SandboxUnavailableError (fallback disabled).
    const r1 = await settle(WorkerSpawner.spawn('s1', makeTempDir()));
    expect(r1.ok).toBe(false);
    expect(r1.error).toBeInstanceOf(SandboxUnavailableError);
    expect(mockSpawn).toHaveBeenCalledTimes(3); // 3 attempts
    expect(mockFork).not.toHaveBeenCalled();    // no unsandboxed fallback

    // 2) Inside the cooldown window: spawn must fast-fail WITHOUT re-probing
    //    bwrap. This is the whole point — the old permanent latch behaved the
    //    same here, but here it must NOT have touched child_process.spawn.
    mockSpawn.mockClear();
    jest.advanceTimersByTime(40_000); // well within COOLDOWN_MS of the arming
    const r2 = await settle(WorkerSpawner.spawn('s2', makeTempDir()));
    expect(r2.ok).toBe(false);
    expect(r2.error).toBeInstanceOf(SandboxUnavailableError);
    expect(mockSpawn).not.toHaveBeenCalled(); // proves the fast-fail short-circuit

    // 3) After the cooldown elapses: spawn RE-PROBES bwrap. The old permanent
    //    latch would never have called spawn() again for the process lifetime.
    mockSpawn.mockClear();
    jest.advanceTimersByTime(30_000); // now past COOLDOWN_MS since arming
    const r3 = await settle(WorkerSpawner.spawn('s3', makeTempDir()));
    expect(mockSpawn).toHaveBeenCalledTimes(3); // re-probed (and failed again)
    expect(r3.ok).toBe(false);
    expect(r3.error).toBeInstanceOf(SandboxUnavailableError);
  }, 20_000);
});
