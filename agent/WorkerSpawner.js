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
  #proc = null;
  #server;
  #socketPath;
  #socket = null;
  #sendQueue = [];
  #connected = true;
  #socketConnected = false;

  /**
   * Create the server socket and wait until it is bound and listening.
   * The socket file exists on disk before this promise resolves, so bwrap
   * can be spawned immediately after with no race condition.
   * Call worker.attach(proc) right after spawning the sandboxed process.
   */
  static async listen(socketPath) {
    const server = net.createServer();
    try { unlinkSync(socketPath); } catch { /* no stale socket to remove */ }
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
      server.listen(socketPath);
    });
    return new IpcWorker(server, socketPath);
  }

  constructor(server, socketPath) {
    super();
    this.#server = server;
    this.#socketPath = socketPath;

    server.on('connection', (socket) => {
      // Defensive: only one connection is expected per worker, but if a second
      // arrives (e.g. retry inside the sandbox), tear the old one down rather
      // than orphan its FD and listeners.
      if (this.#socket && !this.#socket.destroyed) this.#socket.destroy();
      this.#socket = socket;
      this.#socketConnected = true;
      this.emit('socket-connected');

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

    server.on('error', (err) => this.emit('error', err));
  }

  /**
   * Tear down the server + socket file without going through attach().
   * Use only when spawn() failed before attach() was called — once attached,
   * proc.on('exit') owns the cleanup.
   */
  dispose() {
    this.#socket?.destroy();
    try { this.#server.close(); } catch { /* already closing */ }
    try { unlinkSync(this.#socketPath); } catch { /* already gone */ }
  }

  /** Wire up the sandboxed process after the socket is already listening. */
  attach(proc) {
    this.#proc = proc;
    proc.on('error', (err) => this.emit('error', err));
    proc.on('exit', (code, signal) => {
      this.#connected = false;
      this.#socket?.destroy();
      this.#server.close();
      unlink(this.#socketPath, () => {});
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
  // Set ALLOW_UNSANDBOXED_FALLBACK=true to allow unsandboxed fork workers when
  // bwrap fails at runtime.  Defaults to false so a sandbox failure is a hard
  // error rather than a silent security regression.
  static #allowUnsandboxedFallback = process.env.ALLOW_UNSANDBOXED_FALLBACK === 'true';

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
  static async spawn(sessionId, sessionTempDir) {
    if (process.platform === 'linux') {
      const bwrapBin = WorkerSpawner.#findBinary('bwrap');
      if (bwrapBin && !WorkerSpawner.#bwrapBroken) {
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const attemptLabel = attempt > 1 ? ` (attempt ${attempt}/${MAX_ATTEMPTS})` : '';
          logger.log(`[worker:${sessionId}] Spawning sandboxed worker via bwrap${attemptLabel}`);

          mkdirSync(sessionTempDir, { recursive: true });
          // Unique name per spawn so the old IpcWorker's async unlink-on-exit
          // never races with the new IpcWorker's socket (agent-switch scenario).
          const socketName = `ipc-${randomBytes(4).toString('hex')}.sock`;
          const socketPath = join(sessionTempDir, socketName);
          const workerEnv = {
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY,
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            OPEN_ROUTER_API_KEY: process.env.OPEN_ROUTER_API_KEY,
            TOKEN_REPORTER_URL: process.env.TOKEN_REPORTER_URL,
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

          // Socket file is on disk before bwrap starts — no race condition.
          const worker = await IpcWorker.listen(socketPath);

          let proc;
          try {
            proc = spawn(bwrapBin, bwrapArgs, {
              env: workerEnv,
              // Pipe stderr (instead of inheriting) so we can prefix lines with
              // the session id — concurrent workers' stderr would otherwise
              // interleave under a single anonymous fd, making post-mortems
              // (like the "IPC socket error: connect ENOENT /session/ipc-*.sock"
              // failure seen under concurrent spawns) impossible to attribute.
              stdio: ['inherit', 'inherit', 'pipe'],
            });
          } catch (err) {
            // spawn rarely throws synchronously (most failures emit 'error'),
            // but bad options can. Tear down the listening server + socket file
            // so we don't leak FDs across retries.
            worker.dispose();
            throw err;
          }
          if (proc.stderr) {
            let buf = '';
            proc.stderr.on('data', (chunk) => {
              buf += chunk.toString();
              let nl;
              while ((nl = buf.indexOf('\n')) !== -1) {
                const line = buf.slice(0, nl);
                buf = buf.slice(nl + 1);
                if (line.length > 0) logger.error(`[bwrap:${sessionId}] ${line}`);
              }
            });
            proc.stderr.on('end', () => {
              if (buf.length > 0) logger.error(`[bwrap:${sessionId}] ${buf}`);
            });
          }
          worker.attach(proc);

          // Wait for either a successful IPC connection or an early bwrap exit.
          // Each handler removes its sibling so the loser doesn't stay attached
          // for the worker's lifetime firing into an already-resolved promise.
          const earlyExit = await new Promise((resolve) => {
            const onConnected = () => {
              worker.off('exit', onExit);
              resolve(null);
            };
            const onExit = (code, signal) => {
              worker.off('socket-connected', onConnected);
              if (!worker.socketConnected) resolve({ code, signal });
            };
            worker.once('socket-connected', onConnected);
            worker.once('exit', onExit);
          });

          if (earlyExit === null) return worker; // socket connected — worker is up

          const { code, signal } = earlyExit;
          if (attempt < MAX_ATTEMPTS) {
            logger.warn(
              `[worker:${sessionId}] bwrap exited early (code=${code} signal=${signal}) — attempt ${attempt}/${MAX_ATTEMPTS}, retrying in 3s...`
            );
            await new Promise(r => setTimeout(r, 3000));
          } else {
            WorkerSpawner.#bwrapBroken = true;
            const fallbackNote = WorkerSpawner.#allowUnsandboxedFallback
              ? 'Future workers will fall back to unsandboxed fork (ALLOW_UNSANDBOXED_FALLBACK=true).'
              : 'Worker spawning will now FAIL until bwrap is fixed (set ALLOW_UNSANDBOXED_FALLBACK=true to override).';
            logger.error(
              `[worker:${sessionId}] bwrap exited early (code=${code} signal=${signal}) — sandbox unavailable after ${MAX_ATTEMPTS} attempts. See stderr above.\n` +
              fallbackNote + '\n' +
              'Fix: update bubblewrap (apt-get upgrade bubblewrap) or ensure user namespaces are enabled.'
            );
            WorkerSpawner.#logBwrapDiagnostics(bwrapBin);
          }
        }
        // All attempts failed — fall through to bwrapBroken handling below.
      }
      if (WorkerSpawner.#bwrapBroken) {
        if (!WorkerSpawner.#allowUnsandboxedFallback) {
          throw new Error('bwrap sandbox is unavailable and ALLOW_UNSANDBOXED_FALLBACK is not set — refusing to spawn unsandboxed worker');
        }
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

    // Unsandboxed fallback: plain fork.
    // detached: true puts the worker in its own process group so that killing
    // the group (process.kill(-pid, signal)) also kills grandchildren like the
    // claude CLI subprocess spawned by the Agent SDK.
    return fork(WorkerSpawner.#WORKER_PATH, [], {
      env: { ...process.env, SESSION_ID: sessionId, SESSION_TEMP_DIR: sessionTempDir },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      // detached only on Unix: puts the worker in its own process group so
      // process.kill(-pid) can kill grandchildren (e.g. the claude CLI).
      // On Windows, detached + inherited stdio breaks the IPC channel (EBADF),
      // and negative-PID group killing isn't supported anyway.
      detached: process.platform !== 'win32',
    });
  }
}
