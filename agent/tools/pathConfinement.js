import { basename, dirname, isAbsolute, join, resolve, sep } from 'path';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';

/**
 * Where the agent's filesystem tools are allowed to look, shared by both routes.
 *
 * The non-SDK loops call read_file (fileTools.js), which has confined itself to
 * the session dir + APP_ROOT since it was written. The Anthropic Agent SDK route
 * calls the SDK's own native Read/Glob/Grep, which had no confinement at all:
 * `permissionMode: 'bypassPermissions'` auto-approves every path, and those tools
 * are handed to EVERY agent — the read-only tool set in startConversation is
 * ['Read', 'Glob', 'Grep'], no capability gate.
 *
 * Inside the sandbox that is not academic, because the sandbox cannot close it.
 * bwrap masks the credential files under /app, but it also mounts /proc, and
 * /proc/self/environ and /proc/1/environ are ordinary readable paths holding the
 * worker's whole environment. No bind mount can take those away — /proc is what
 * makes the sandbox a working Node process. Confining these tools to the session
 * directory and the application directory is what puts them out of reach.
 */

// agent/tools/pathConfinement.js -> the sd-ai root. Inside the bwrap sandbox this
// resolves to /app, which is where the application is bind-mounted.
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Resolve a path to its canonical on-disk form.
 *
 * Symlinks are followed on purpose, and BOTH sides of every comparison go through
 * here: on macOS os.tmpdir() reports /var/folders/... while the real path is
 * /private/var/folders/..., so canonicalising only one side would reject every
 * legitimate read of the session directory.
 *
 * realpathSync throws on a path that does not exist, and a tool naming a file it
 * is about to create is ordinary. Falling back to a lexical resolve for the whole
 * path is not good enough: it leaves the leaf lexical while the root it is
 * compared against canonicalises, which denied every read of a session file on a
 * symlinked tmpdir. So resolve the deepest ancestor that does exist and re-append
 * the rest — the symlinks are all in the ancestor.
 */
function canonical(path) {
  let existing = resolve(path);
  const remainder = [];

  for (;;) {
    try {
      return join(realpathSync(existing), ...remainder);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return resolve(path); // reached the root; none of it exists
      remainder.unshift(basename(existing));
      existing = parent;
    }
  }
}

export function isWithin(candidatePath, rootPath) {
  const root = canonical(rootPath);
  const candidate = canonical(candidatePath);
  return candidate === root || candidate.startsWith(root + sep);
}

// The SDK filesystem tools, and the input field each one names a path in. Grep
// and Glob take an optional `path`; omitting it means "search cwd", which the
// query pins to the session directory.
const SDK_TOOL_PATH_FIELD = { Read: 'file_path', Glob: 'path', Grep: 'path' };

/**
 * Decide whether an SDK filesystem tool call may proceed.
 *
 * Returns { allowed, reason }. Tools not in SDK_TOOL_PATH_FIELD are allowed —
 * this gate is about paths, and a tool that names none is not its business. Bash
 * is deliberately not here: a shell cannot be confined by inspecting one
 * argument, which is why it is gated by capability (SDK_WRITE_TOOLS) instead.
 */
export function evaluateSdkFilesystemAccess(toolName, toolInput, roots, cwd) {
  const field = SDK_TOOL_PATH_FIELD[toolName];
  if (!field) return { allowed: true, reason: null };

  const requested = toolInput?.[field];
  if (requested === undefined || requested === null || requested === '') {
    return { allowed: true, reason: null }; // defaults to cwd, which is a root
  }
  if (typeof requested !== 'string') {
    return { allowed: false, reason: `${toolName}: ${field} must be a string path.` };
  }

  const target = isAbsolute(requested) ? requested : resolve(cwd, requested);

  if (!roots.some(root => isWithin(target, root))) {
    return {
      allowed: false,
      reason: `Reading outside the session directory and the application directory is not allowed: ${requested}`
    };
  }
  return { allowed: true, reason: null };
}

/**
 * Build the PreToolUse hook that enforces the above on the Agent SDK route.
 *
 * A PreToolUse hook rather than canUseTool or allowedTools, because those two do
 * not survive this query's settings. allowedTools only pre-answers a prompt —
 * the SDK's own docs say restricting availability is what `tools` is for — and
 * under bypassPermissions there is no prompt to pre-answer. The SDK documents
 * that "PreToolUse hook denies bypass canUseTool", making this the one gate that
 * still applies.
 */
export function createSdkFilesystemGuard(roots, cwd) {
  const permitted = roots.filter(Boolean);

  return async (input) => {
    if (input?.hook_event_name !== 'PreToolUse') return {};

    const { allowed, reason } = evaluateSdkFilesystemAccess(
      input.tool_name, input.tool_input, permitted, cwd
    );
    if (allowed) return {};

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    };
  };
}
