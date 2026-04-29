import { spawn, fork } from 'child_process';
import { existsSync, readFileSync, statSync, unlink, unlinkSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import net from 'net';
import { EventEmitter } from 'events';
import logger from '../utilities/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = dirname(__dirname);  // sd-ai root (parent of agent/)

/**
 * Wraps a bwrap ChildProcess with a Unix-socket-based IPC channel.
 *
 * bwrap cannot pass the Node.js IPC fd (fd 3) into the sandbox. 
 * Instead we create a Unix domain socket inside the session temp dir 
 * (which maps to /session in the container) and use newline-delimited 
 * JSON over that socket as a drop-in replacement.
 *
 * The public API intentionally mirrors the subset of ChildProcess that
 * WebSocket.js uses (.send, on('message'), .connected, .stdout, .stderr,
 * .kill, on('exit'), on('error')).
 */
class IpcWorker extends EventEmitter {
  #proc;
  #server;
  #socket = null;
  #sendQueue = [];
  #connected = true;   // true while the process is still alive
  #socketConnected = false;

  constructor(proc, socketPath) {
    super();
    this.#proc = proc;

    this.#server = net.createServer((socket) => {
      this.#socket = socket;
      this.#socketConnected = true;

      for (const chunk of this.#sendQueue) socket.write(chunk);
      this.#sendQueue = [];

      let buf = '';
      socket.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) {
            try { this.emit('message', JSON.parse(line)); }
            catch { /* ignore malformed line */ }
          }
        }
      });

      socket.once('close', () => { this.#connected = false; });
      socket.on('error', (err) => this.emit('error', err));
    });

    this.#server.on('error', (err) => this.emit('error', err));
    try { unlinkSync(socketPath); } catch { /* no stale socket to remove */ }
    this.#server.listen(socketPath);

    proc.on('error', (err) => this.emit('error', err));
    proc.on('exit', (code, signal) => {
      this.#connected = false;
      this.#socket?.destroy();
      this.#server.close();
      unlink(socketPath, () => {});
      this.emit('exit', code, signal);
    });
  }

  get stdout() { return this.#proc.stdout; }
  get stderr() { return this.#proc.stderr; }
  get stdin() { return this.#proc.stdin; }
  get connected() { return this.#connected; }
  get socketConnected() { return this.#socketConnected; }

  kill(signal) { this.#proc.kill(signal); }

  send(msg) {
    const chunk = JSON.stringify(msg) + '\n';
    if (this.#socket && !this.#socket.destroyed) {
      this.#socket.write(chunk);
    } else if (this.#connected) {
      this.#sendQueue.push(chunk); // worker hasn't connected yet; drain on connect
    }
    // silently drop if the process has already exited
  }
}

export class WorkerSpawner {
  static CONTAINER_SESSION_PATH = '/session';
  static #WORKER_PATH = join(__dirname, 'AgentWorker.js');
  static #bwrapBroken = false; // set true on first bwrap sandbox failure

  static #findBinary(name) {
    try { return execSync(`which ${name}`, { encoding: 'utf8' }).trim(); }
    catch { return null; }
  }

  static #logBwrapDiagnostics(bwrapBin) {
    const lines = ['bwrap sandbox diagnostics:'];

    let isSetuid = false;
    try {
      const st = statSync(bwrapBin);
      isSetuid = (st.mode & 0o4000) !== 0;
      lines.push(`  bwrap binary : ${bwrapBin} (mode=${st.mode.toString(8)}, setuid=${isSetuid})`);
    } catch (e) {
      lines.push(`  bwrap binary : stat failed — ${e.message}`);
    }

    for (const sysctl of [
      '/proc/sys/kernel/unprivileged_userns_clone',
      '/proc/sys/user/max_user_namespaces',
      '/proc/sys/kernel/apparmor_restrict_unprivileged_userns',
    ]) {
      try {
        lines.push(`  ${sysctl} = ${readFileSync(sysctl, 'utf8').trim()}`);
      } catch {
        lines.push(`  ${sysctl} = (not present)`);
      }
    }

    try {
      const caps = readFileSync('/proc/self/status', 'utf8');
      const capEff = caps.match(/^CapEff:\s+(\S+)/m)?.[1];
      lines.push(`  process CapEff: ${capEff ?? 'unknown'}`);
    } catch { /* ignore */ }

    for (const f of ['/.dockerenv', '/run/.containerenv']) {
      if (existsSync(f)) { lines.push(`  container marker: ${f}`); break; }
    }

    lines.push('');
    if (!isSetuid) {
      lines.push('  Most reliable fix: sudo chmod u+s ' + bwrapBin);
      lines.push('  Ubuntu 24.04 alternative: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0');
      lines.push('  LXC/Proxmox: enable nested user namespaces in the container config');
    }

    logger.error(lines.join('\n'));
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
   *  - Any non-/usr directories in PATH (e.g. python venv): read-only bind of
   *    the venv root (detected via pyvenv.cfg) or the directory itself
   *  - sessionTempDir → /session: the ONLY writable location; also hosts ipc.sock
   *  - /dev, /proc: required pseudo-filesystems for Node.js
   *  - /tmp: tmpfs (ephemeral scratch)
   *
   * IPC is handled via a Unix domain socket at /session/ipc.sock rather than
   * Node.js IPC fd forwarding, so no --forward-fd flag is needed.
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

    // Mount any non-/usr directories from PATH (e.g. python venv).
    // If a directory's parent contains pyvenv.cfg we mount the whole venv root
    // so that the Python interpreter can find its site-packages and stdlib.
    const alreadyMounted = new Set();
    for (const dir of (process.env.PATH || '').split(':')) {
      if (!dir || dir.startsWith('/usr') || !existsSync(dir)) continue;
      const parent = dirname(dir);
      const mountTarget = existsSync(join(parent, 'pyvenv.cfg')) ? parent : dir;
      if (alreadyMounted.has(mountTarget)) continue;
      alreadyMounted.add(mountTarget);
      const parts = mountTarget.split('/').filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        args.push('--dir', '/' + parts.slice(0, i).join('/'));
      }
      args.push('--ro-bind', mountTarget, mountTarget);
    }

    args.push(
      '--bind', sessionTempDir, WorkerSpawner.CONTAINER_SESSION_PATH,
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp',
      '--unshare-pid',
      '--unshare-uts', '--hostname', 'agent',
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
   * either read-only or not mounted at all.  IPC uses a Unix domain socket
   * at <sessionTempDir>/ipc.sock (mapped to /session/ipc.sock in the sandbox)
   * rather than Node.js IPC fd forwarding, so no --forward-fd support is needed.
   *
   * On Linux without bwrap, macOS, or Windows: falls back to a plain fork
   * with a prominent warning. Use Linux + bwrap for any publicly hosted
   * deployment.
   *
   * Returns an IpcWorker (bwrap) or ChildProcess (fork) — both expose the
   * same .send() / on('message') / .connected interface used by WebSocket.js.
   */
  static spawn(sessionId, sessionTempDir) {
    if (process.platform === 'linux') {
      const bwrapBin = WorkerSpawner.#findBinary('bwrap');
      if (bwrapBin && !WorkerSpawner.#bwrapBroken) {
        logger.log(`[worker:${sessionId}] Spawning sandboxed worker via bwrap`);

        mkdirSync(sessionTempDir, { recursive: true });
        // Unique name per spawn so the old IpcWorker's async unlink-on-exit
        // never races with the new IpcWorker's socket (agent-switch scenario).
        const socketName = `ipc-${randomBytes(4).toString('hex')}.sock`;
        const socketPath = join(sessionTempDir, socketName);
        const workerEnv = {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
          SESSION_ID: sessionId,
          SESSION_TEMP_DIR: WorkerSpawner.CONTAINER_SESSION_PATH,
          WORKER_IPC_SOCKET: `${WorkerSpawner.CONTAINER_SESSION_PATH}/${socketName}`,
          // claude CLI requires HOME to locate ~/.claude/ for config and session state.
          // Point it at /session so each sandbox gets a fresh, writable home dir.
          HOME: WorkerSpawner.CONTAINER_SESSION_PATH,
          PATH: process.env.PATH,
        };
        const bwrapArgs = WorkerSpawner.#buildBwrapArgs(sessionTempDir);
        logger.log(`[worker:${sessionId}] bwrap args: ${bwrapArgs.join(' ')}`);

        const proc = spawn(bwrapBin, bwrapArgs, {
          env: workerEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        const worker = new IpcWorker(proc, socketPath);

        worker.once('exit', (code, signal) => {
          if (!worker.socketConnected && code !== 0 && code !== null) {
            WorkerSpawner.#bwrapBroken = true;
            logger.error(
              `[worker:${sessionId}] bwrap exited early (code=${code} signal=${signal}) — sandbox unavailable. See stderr above.\n` +
              'Future workers will fall back to unsandboxed fork.\n' +
              'Fix: update bubblewrap (apt-get upgrade bubblewrap) or ensure user namespaces are enabled.'
            );
            WorkerSpawner.#logBwrapDiagnostics(bwrapBin);
          }
        });

        return worker;
      }
      if (WorkerSpawner.#bwrapBroken) {
        logger.warn(`[worker:${sessionId}] bwrap sandbox unavailable — spawning unsandboxed worker`);
      } else {
        logger.error(
          '================================================================================\n' +
          'SECURITY WARNING: bwrap (bubblewrap) not found on Linux!\n' +
          'Agent workers will run WITHOUT filesystem sandbox isolation.\n' +
          'Install bubblewrap to enable sandboxing: apt install bubblewrap\n' +
          'DO NOT run this configuration for any publicly hosted service.\n' +
          '================================================================================'
        );
      }
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
