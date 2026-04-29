import { spawn, fork } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import logger from '../utilities/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = dirname(__dirname);  // sd-ai root (parent of agent/)

export class WorkerSpawner {
  static CONTAINER_SESSION_PATH = '/session';
  static #WORKER_PATH = join(__dirname, 'AgentWorker.js');

  static #findBinary(name) {
    try { return execSync(`which ${name}`, { encoding: 'utf8' }).trim(); }
    catch { return null; }
  }

  /**
   * Build bwrap argument list for a sandboxed worker process.
   *
   * Mount strategy:
   *  - /usr (+ /lib, /lib64 if present): Node.js runtime + system libraries (read-only)
   *  - /etc/ssl, /etc/resolv.conf, /etc/hosts: TLS certs + DNS for Anthropic API (read-only)
   *  - APP_ROOT → /app: application code including node_modules (read-only)
   *  - Node binary dir (if outside /usr, e.g. nvm): additional read-only bind
   *  - Claude binary dir (if outside /usr): additional read-only bind
   *  - sessionTempDir → /session: the ONLY writable location
   *  - /dev, /proc: required pseudo-filesystems for Node.js
   *  - /tmp: tmpfs (ephemeral scratch, not writable by agent since all writes go to /session)
   *  - --forward-fd 3: preserve the Node.js IPC socket fd across the exec boundary
   */
  static #buildBwrapArgs(sessionTempDir) {
    const nodeBin = process.execPath;
    const nodeBinDir = dirname(nodeBin);
    const claudeBin = WorkerSpawner.#findBinary('claude');

    const args = [
      '--ro-bind', '/usr', '/usr',
    ];

    for (const lib of ['/lib', '/lib64', '/lib/x86_64-linux-gnu', '/lib/aarch64-linux-gnu']) {
      if (existsSync(lib)) args.push('--ro-bind', lib, lib);
    }

    for (const path of ['/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/gai.conf']) {
      if (existsSync(path)) args.push('--ro-bind', path, path);
    }

    args.push('--ro-bind', APP_ROOT, '/app');

    if (!nodeBin.startsWith('/usr/')) {
      const parts = nodeBinDir.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        args.push('--dir', '/' + parts.slice(0, i).join('/'));
      }
      args.push('--ro-bind', nodeBinDir, nodeBinDir);
    }

    if (claudeBin && !claudeBin.startsWith('/usr/')) {
      const claudeDir = dirname(claudeBin);
      const parts = claudeDir.split('/').filter(Boolean);
      for (let i = 1; i <= parts.length; i++) {
        args.push('--dir', '/' + parts.slice(0, i).join('/'));
      }
      args.push('--ro-bind', claudeDir, claudeDir);
    }

    args.push(
      '--bind', sessionTempDir, WorkerSpawner.CONTAINER_SESSION_PATH,
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
      '--unshare-pid',
      '--unshare-uts', '--hostname', 'agent',
      // Forward the Node.js IPC socket fd (always fd 3 with stdio: [..., 'ipc'])
      '--forward-fd', '3',
      '--',
      nodeBin,
      '/app/agent/AgentWorker.js'
    );

    return args;
  }

  /**
   * Spawn a sandboxed agent worker process for the given session.
   *
   * On Linux with bwrap installed: runs inside a bubblewrap container where
   * only the session temp dir is writable and most of the filesystem is
   * either read-only or not mounted at all.
   *
   * On Linux without bwrap, macOS, or Windows: falls back to a plain fork
   * with a prominent warning. Use Linux + bwrap for any publicly hosted
   * deployment.
   *
   * Returns a ChildProcess with an active IPC channel (.send() / on('message')).
   */
  static spawn(sessionId, sessionTempDir) {
    if (process.platform === 'linux') {
      const bwrapBin = WorkerSpawner.#findBinary('bwrap');
      if (bwrapBin) {
        logger.log(`[worker:${sessionId}] Spawning sandboxed worker via bwrap`);
        const workerEnv = {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          SESSION_ID: sessionId,
          SESSION_TEMP_DIR: WorkerSpawner.CONTAINER_SESSION_PATH,
          PATH: process.env.PATH,
          // NODE_CHANNEL_FD is injected automatically by Node.js for the ipc stdio slot
        };
        return spawn(bwrapBin, WorkerSpawner.#buildBwrapArgs(sessionTempDir), {
          env: workerEnv,
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        });
      }
      logger.error(
        '================================================================================\n' +
        'SECURITY WARNING: bwrap (bubblewrap) not found on Linux!\n' +
        'Agent workers will run WITHOUT filesystem sandbox isolation.\n' +
        'Install bubblewrap to enable sandboxing: apt install bubblewrap\n' +
        'DO NOT run this configuration for any publicly hosted service.\n' +
        '================================================================================'
      );
    } else {
      logger.warn(
        '================================================================================\n' +
        `SECURITY WARNING: Running on ${process.platform} — bwrap sandboxing is unavailable.\n` +
        'Agent workers can read and write the ENTIRE server filesystem.\n' +
        'This configuration is for LOCAL DEVELOPMENT ONLY.\n' +
        'Deploy on Linux with bubblewrap installed for any hosted environment.\n' +
        '================================================================================'
      );
    }

    // Unsandboxed fallback: plain fork, inherits full environment
    return fork(WorkerSpawner.#WORKER_PATH, [], {
      env: { ...process.env, SESSION_ID: sessionId, SESSION_TEMP_DIR: sessionTempDir },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
  }
}
