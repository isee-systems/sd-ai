import http from 'http';
import https from 'https';
import { randomBytes } from 'crypto';
import logger from '../../utilities/logger.js';

/**
 * A loopback relay that keeps the real Anthropic credential in the main process.
 *
 * Every other provider key can be kept out of the worker's environment and held
 * in its heap (see workerCredentials in WorkerSpawner) — nothing spawns a child
 * that needs them. The Anthropic key is different: the Agent SDK route runs the
 * `claude` CLI as a subprocess, the CLI authenticates from its own environment,
 * and the SDK offers no way to hand it a key otherwise (sdk.d.ts has only
 * `apiKeyHelper`, which is no improvement when HOME is the agent-writable
 * /session). So on that route the key must exist in an environment the agent's
 * Bash tool can read with `env`.
 *
 * Unless the thing in that environment is not the key. This server listens on
 * 127.0.0.1, hands each worker a random per-session sentinel in place of the real
 * credential, and swaps the sentinel for the real one on the way upstream. What
 * leaks from the sandbox is then a token that is useless anywhere else and dies
 * with the session, rather than a credential that bills the operator until it is
 * noticed and rotated.
 *
 * The sandbox can reach it because bwrap is not given --unshare-net, so the
 * container shares the host's network namespace and 127.0.0.1 is the same
 * loopback on both sides.
 *
 * Two properties this deliberately does not claim:
 *  - It is not a defence against the agent *using* Anthropic. The sentinel is a
 *    live capability for the session's lifetime; an agent that wants to spend
 *    tokens can already do that by asking the model a question. What it bounds is
 *    blast radius and lifetime.
 *  - The loopback hop is plaintext HTTP. It never leaves the host, and the
 *    upstream hop is ordinary TLS.
 */

const DEFAULT_UPSTREAM = 'https://api.anthropic.com';

// Headers that describe a single hop and must not be relayed to the next one.
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
]);

class CredentialProxy {
  #server = null;
  #port = null;
  #starting = null;
  // sentinel -> sessionId, so a revoked session's token stops working the moment
  // its worker exits rather than lasting as long as the process does.
  #tokens = new Map();

  /** The upstream this relays to. Honours an operator-configured gateway. */
  get #upstream() {
    return new URL(process.env.ANTHROPIC_BASE_URL || DEFAULT_UPSTREAM);
  }

  get origin() {
    if (this.#port === null) throw new Error('CredentialProxy.start() has not completed');
    return `http://127.0.0.1:${this.#port}`;
  }

  /**
   * Start listening, once per process. Concurrent callers share one promise, so
   * a burst of session connects does not race into several servers.
   */
  start() {
    if (this.#starting) return this.#starting;

    this.#starting = new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.#handle(req, res));
      server.on('error', reject);
      // Streaming agent turns idle between tokens; the default 2-minute socket
      // timeout would sever a long tool-using turn mid-response.
      server.setTimeout(0);
      // 127.0.0.1 explicitly: binding 0.0.0.0 would expose an Anthropic relay to
      // anything that can route to this host.
      server.listen(0, '127.0.0.1', () => {
        this.#server = server;
        this.#port = server.address().port;
        logger.log(`[credential-proxy] listening on ${this.origin} -> ${this.#upstream.origin}`);
        resolve(this.#port);
      });
    });

    return this.#starting;
  }

  /** Mint a sentinel for one session. Returns the value to put in its environment. */
  issueToken(sessionId) {
    const token = `sk-sdai-proxy-${randomBytes(24).toString('hex')}`;
    this.#tokens.set(token, sessionId);
    return token;
  }

  revokeToken(token) {
    this.#tokens.delete(token);
  }

  /** Close the listener. For process shutdown and for test teardown. */
  async stop() {
    if (!this.#server) return;
    const server = this.#server;
    this.#server = null;
    this.#port = null;
    this.#starting = null;
    this.#tokens.clear();
    await new Promise((resolve) => server.close(resolve));
  }

  async #handle(req, res) {
    const presented = req.headers['x-api-key']
      || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

    if (!presented || !this.#tokens.has(presented)) {
      // A credential that was presented and is not live is worth surfacing: it is
      // a worker outliving its session, or another process on the host trying the
      // relay. An unauthenticated request is not — the claude CLI probes the base
      // URL's root with no headers when a session starts, and warning on that
      // would put a line in the log for every connect.
      const note = `[credential-proxy] rejected request to ${req.url}: no valid session token`;
      if (presented) logger.warn(note); else logger.debug(note);
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'Invalid or expired session credential' } }));
      req.resume();
      return;
    }

    const upstream = this.#upstream;
    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    }
    headers.host = upstream.host;

    // The swap. Whichever scheme the operator configured is the one sent on; the
    // sentinel never travels past this process.
    delete headers['x-api-key'];
    delete headers['authorization'];
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
      headers['authorization'] = `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`;
    } else {
      headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
    }

    const basePath = upstream.pathname.replace(/\/$/, '');
    // Chosen from the URL rather than hardcoded to https: an operator pointing
    // ANTHROPIC_BASE_URL at a plaintext in-cluster gateway would otherwise hit
    // "Protocol http: not supported" from https.request.
    const transport = upstream.protocol === 'http:' ? http : https;
    const proxied = transport.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || (transport === http ? 80 : 443),
        method: req.method,
        path: `${basePath}${req.url}`,
        headers,
      },
      (upstreamRes) => {
        const outHeaders = {};
        for (const [name, value] of Object.entries(upstreamRes.headers)) {
          if (!HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
        }
        res.writeHead(upstreamRes.statusCode, outHeaders);
        // Piped, never buffered: these responses are SSE streams and buffering
        // one would stall the agent until its whole turn finished.
        upstreamRes.pipe(res);
      }
    );

    proxied.on('error', (err) => {
      logger.error(`[credential-proxy] upstream request failed: ${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `Upstream request failed: ${err.message}` } }));
    });

    req.on('aborted', () => proxied.destroy());
    req.pipe(proxied);
  }
}

// One relay per main process; every session's worker points at it.
export default new CredentialProxy();
