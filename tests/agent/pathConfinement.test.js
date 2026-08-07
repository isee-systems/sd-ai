/**
 * Regression guard: the Agent SDK's native filesystem tools must not reach the
 * worker's environment.
 *
 * The SDK route runs with permissionMode 'bypassPermissions', which auto-approves
 * every path, and hands Read/Glob/Grep to every agent — the read-only tool set is
 * ['Read', 'Glob', 'Grep'], no capability gate. bwrap cannot close this: it mounts
 * /proc for Node's benefit, and /proc/self/environ is then an ordinary readable
 * file holding every credential the worker holds. Confinement has to happen in
 * the process, via a PreToolUse hook, because that is the one gate bypassPermissions
 * does not waive.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  APP_ROOT,
  isWithin,
  evaluateSdkFilesystemAccess,
  createSdkFilesystemGuard,
} from '../../agent/tools/pathConfinement.js';
import { createVisualizationTool } from '../../agent/tools/builtin/createVisualization.js';

let sessionDir;
let roots;

beforeEach(() => {
  sessionDir = mkdtempSync(join(tmpdir(), 'confine-session-'));
  roots = [sessionDir, APP_ROOT];
});

afterEach(() => {
  rmSync(sessionDir, { recursive: true, force: true });
});

const read = (filePath) => evaluateSdkFilesystemAccess('Read', { file_path: filePath }, roots, sessionDir);

describe('evaluateSdkFilesystemAccess', () => {
  it('denies the process environment, which is the whole point', () => {
    expect(read('/proc/self/environ').allowed).toBe(false);
    // The worker is PID 1 under --unshare-pid, so narrowing only the SDK
    // subprocess env would still leave this readable.
    expect(read('/proc/1/environ').allowed).toBe(false);
  });

  it('denies absolute paths outside every root', () => {
    expect(read('/etc/passwd').allowed).toBe(false);
    expect(read('/root/.aws/credentials').allowed).toBe(false);
  });

  it('denies a traversal that climbs out of the session directory', () => {
    const escape = join(sessionDir, '..', '..', '..', 'etc', 'passwd');
    expect(read(escape).allowed).toBe(false);
  });

  it('allows the session directory and the application directory', () => {
    expect(read(join(sessionDir, 'model.sdjson')).allowed).toBe(true);
    expect(read(join(APP_ROOT, 'package.json')).allowed).toBe(true);
  });

  it('resolves relative paths against cwd, which the query pins to the session dir', () => {
    expect(read('variables.csv').allowed).toBe(true);
    expect(read('../../../etc/passwd').allowed).toBe(false);
  });

  it('confines Glob and Grep by their path argument', () => {
    expect(evaluateSdkFilesystemAccess('Glob', { pattern: '*', path: '/proc' }, roots, sessionDir).allowed).toBe(false);
    expect(evaluateSdkFilesystemAccess('Grep', { pattern: 'KEY', path: '/proc/1' }, roots, sessionDir).allowed).toBe(false);
    expect(evaluateSdkFilesystemAccess('Grep', { pattern: 'x', path: sessionDir }, roots, sessionDir).allowed).toBe(true);
  });

  it('allows Glob and Grep with no path — that means cwd, which is a root', () => {
    expect(evaluateSdkFilesystemAccess('Glob', { pattern: '**/*.csv' }, roots, sessionDir).allowed).toBe(true);
    expect(evaluateSdkFilesystemAccess('Grep', { pattern: 'x' }, roots, sessionDir).allowed).toBe(true);
  });

  it('leaves tools that name no path alone', () => {
    // Bash is gated by capability, not by path — a shell cannot be confined by
    // inspecting one argument, and pretending otherwise would be worse than not
    // trying.
    expect(evaluateSdkFilesystemAccess('Bash', { command: 'cat /proc/1/environ' }, roots, sessionDir).allowed).toBe(true);
    expect(evaluateSdkFilesystemAccess('WebFetch', { url: 'https://example.com' }, roots, sessionDir).allowed).toBe(true);
  });

  it('rejects a non-string path instead of coercing it', () => {
    expect(evaluateSdkFilesystemAccess('Read', { file_path: { toString: () => sessionDir } }, roots, sessionDir).allowed).toBe(false);
  });
});

describe('isWithin', () => {
  it('canonicalises both sides so symlinked temp dirs still match', () => {
    // On macOS os.tmpdir() reports /var/folders/... while the real path is
    // /private/var/folders/... . Comparing one canonical path against one
    // lexical path would deny every legitimate read of the session directory.
    expect(isWithin(join(realpathSync(sessionDir), 'f.txt'), sessionDir)).toBe(true);
    expect(isWithin(join(sessionDir, 'f.txt'), realpathSync(sessionDir))).toBe(true);
  });

  it('does not treat a sibling with a shared prefix as inside', () => {
    expect(isWithin(`${sessionDir}-other/f.txt`, sessionDir)).toBe(false);
  });
});

describe('createSdkFilesystemGuard', () => {
  const preToolUse = (toolName, toolInput) => ({
    hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, tool_use_id: 'tu_1',
  });

  it('returns a deny decision the SDK honours under bypassPermissions', async () => {
    const guard = createSdkFilesystemGuard(roots, sessionDir);

    const out = await guard(preToolUse('Read', { file_path: '/proc/self/environ' }));

    expect(out.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('not allowed'),
    });
  });

  it('stays out of the way of permitted calls', async () => {
    const guard = createSdkFilesystemGuard(roots, sessionDir);

    expect(await guard(preToolUse('Read', { file_path: join(sessionDir, 'a.txt') }))).toEqual({});
  });

  it('ignores hook events other than PreToolUse', async () => {
    const guard = createSdkFilesystemGuard(roots, sessionDir);

    expect(await guard({ hook_event_name: 'PostToolUse', tool_name: 'Read' })).toEqual({});
  });

  it('drops a null root rather than treating it as permitting everything', async () => {
    // getSessionTempDir returns undefined for an unknown session.
    const guard = createSdkFilesystemGuard([undefined, APP_ROOT], sessionDir);

    const out = await guard(preToolUse('Read', { file_path: '/proc/self/environ' }));

    expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
  });
});

/**
 * create_visualization takes a model-chosen absolute path and reads it directly,
 * which made it the one filesystem read in the worker that went around the
 * confinement above. It is gated only by mode — no capability check — so every
 * SFD agent, read-only ones included, could reach it.
 */
describe('create_visualization path confinement', () => {
  const sessionId = 'sess_viz_confinement';

  const toolFor = (dir) => createVisualizationTool(
    { getSessionTempDir: () => dir, getSession: () => ({ clientId: null }) },
    sessionId,
    async () => {},
    { createVisualization: async () => '<svg/>' },
    'anthropic'
  );

  const call = (dir, filePath) => toolFor(dir).handler({
    type: 'time_series', filePath, title: 'T', options: { timeUnits: 'y', seriesUnits: {} }
  });

  it('refuses the process environment', async () => {
    const result = await call(sessionDir, '/proc/self/environ');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the session directory is not allowed/);
  });

  it('refuses a traversal out of the session directory', async () => {
    const result = await call(sessionDir, join(sessionDir, '..', '..', 'etc', 'passwd'));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the session directory is not allowed/);
  });

  it('reads a data file inside the session directory', async () => {
    const dataPath = join(sessionDir, 'variable_data_1.json');
    writeFileSync(dataPath, JSON.stringify({ time: [0, 1], population: [10, 20] }));

    const result = await call(sessionDir, dataPath);

    expect(result.isError).toBe(false);
  });

  it('refuses everything when the session has no temp dir rather than permitting it', async () => {
    const result = await call(undefined, join(sessionDir, 'variable_data_1.json'));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/outside the session directory is not allowed/);
  });
});
