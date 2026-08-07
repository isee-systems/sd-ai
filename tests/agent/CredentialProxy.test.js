/**
 * Regression guard: the real Anthropic credential must never leave the main
 * process.
 *
 * The Agent SDK route spawns the `claude` CLI, which authenticates from its own
 * environment — so on that route a credential has to exist somewhere the agent's
 * Bash tool can run `env` and read it. The proxy makes the thing sitting there a
 * per-session sentinel instead, and performs the exchange on the way upstream.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import http from 'http';
import credentialProxy from '../../agent/utilities/CredentialProxy.js';

// Stands in for api.anthropic.com and records what it was actually sent.
let upstream;
let upstreamOrigin;
let received;
let savedEnv;

function request(path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${credentialProxy.origin}${path}`, { method: 'POST', headers }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      received = { url: req.url, headers: req.headers, body };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
  await credentialProxy.start();
});

afterAll(async () => {
  await credentialProxy.stop();
  await new Promise((resolve) => upstream.close(resolve));
});

beforeEach(() => {
  savedEnv = { ...process.env };
  received = null;
  process.env.ANTHROPIC_BASE_URL = upstreamOrigin;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-the-real-one';
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterEach(() => {
  process.env = savedEnv;
});

describe('CredentialProxy', () => {
  it('exchanges a session sentinel for the real key', async () => {
    const sentinel = credentialProxy.issueToken('session-a');

    const res = await request('/v1/messages', { 'x-api-key': sentinel, 'content-type': 'application/json' }, '{"model":"x"}');

    expect(res.status).toBe(200);
    expect(received.headers['x-api-key']).toBe('sk-ant-the-real-one');
    expect(received.body).toBe('{"model":"x"}');
    expect(received.url).toBe('/v1/messages');
  });

  it('never forwards the sentinel itself', async () => {
    const sentinel = credentialProxy.issueToken('session-b');

    await request('/v1/messages', { 'x-api-key': sentinel }, '{}');

    expect(JSON.stringify(received.headers)).not.toContain(sentinel);
  });

  it('issues a distinct unguessable sentinel per session', () => {
    const a = credentialProxy.issueToken('session-c');
    const b = credentialProxy.issueToken('session-d');

    expect(a).not.toBe(b);
    expect(a).toMatch(/^sk-sdai-proxy-[0-9a-f]{48}$/);
  });

  it('rejects an unknown credential without touching upstream', async () => {
    const res = await request('/v1/messages', { 'x-api-key': 'sk-ant-guessed' }, '{}');

    expect(res.status).toBe(401);
    expect(received).toBeNull();
  });

  it('rejects a request carrying no credential at all', async () => {
    const res = await request('/v1/messages', {}, '{}');

    expect(res.status).toBe(401);
    expect(received).toBeNull();
  });

  it('stops honouring a sentinel once its session ends', async () => {
    const sentinel = credentialProxy.issueToken('session-e');
    expect((await request('/v1/messages', { 'x-api-key': sentinel }, '{}')).status).toBe(200);

    credentialProxy.revokeToken(sentinel);

    const after = await request('/v1/messages', { 'x-api-key': sentinel }, '{}');
    expect(after.status).toBe(401);
  });

  it('accepts a sentinel presented as a bearer token', async () => {
    // Claude Code sends `authorization: Bearer` when configured with an auth
    // token rather than an api key.
    const sentinel = credentialProxy.issueToken('session-f');

    const res = await request('/v1/messages', { authorization: `Bearer ${sentinel}` }, '{}');

    expect(res.status).toBe(200);
    expect(received.headers['x-api-key']).toBe('sk-ant-the-real-one');
    expect(received.headers.authorization).toBeUndefined();
  });

  it('injects an operator auth token as bearer when that is the configured scheme', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'oat-real-token';
    const sentinel = credentialProxy.issueToken('session-g');

    await request('/v1/messages', { 'x-api-key': sentinel }, '{}');

    expect(received.headers.authorization).toBe('Bearer oat-real-token');
    expect(received.headers['x-api-key']).toBeUndefined();
  });

  it('binds loopback only', () => {
    expect(credentialProxy.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('preserves a base path when the operator points at a gateway subpath', async () => {
    process.env.ANTHROPIC_BASE_URL = `${upstreamOrigin}/anthropic`;
    const sentinel = credentialProxy.issueToken('session-h');

    await request('/v1/messages', { 'x-api-key': sentinel }, '{}');

    expect(received.url).toBe('/anthropic/v1/messages');
  });
});
