/**
 * Regression guard: WebFetch must not become a request primitive aimed at the host.
 *
 * bwrap is given no --unshare-net (CredentialProxy needs a shared loopback), so
 * the sandbox has the host's network stack — its 127.0.0.1 is the host's, and
 * 169.254.169.254 is the cloud metadata service that hands out a token for the
 * VM's service account. WebFetch reaches every agent, read-only ones included,
 * so without this an attached document carrying a prompt injection is one hop
 * from those.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  evaluateSdkNetworkAccess,
  createSdkNetworkGuard,
} from '../../agent/tools/networkConfinement.js';

const fetchUrl = (url) => evaluateSdkNetworkAccess('WebFetch', { url });

describe('evaluateSdkNetworkAccess', () => {
  it('denies the cloud metadata service, which is the whole point', async () => {
    expect((await fetchUrl('http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token')).allowed).toBe(false);
    // The rest of link-local goes with it — the metadata address is not special,
    // it is just the one that pays.
    expect((await fetchUrl('http://169.254.1.1/')).allowed).toBe(false);
  });

  it('denies loopback in every spelling that reaches it', async () => {
    expect((await fetchUrl('http://127.0.0.1:8080/')).allowed).toBe(false);
    expect((await fetchUrl('http://127.1.2.3/')).allowed).toBe(false);
    expect((await fetchUrl('http://[::1]/')).allowed).toBe(false);
    // Resolved, not pattern-matched: localhost is a name like any other.
    expect((await fetchUrl('http://localhost:3000/')).allowed).toBe(false);
  });

  it('denies the obfuscated literals that are not IP literals to isIP', async () => {
    // getaddrinfo resolves both of these to 127.0.0.1; net.isIP calls neither an
    // address. Resolving the hostname is what catches them.
    expect((await fetchUrl('http://2130706433/')).allowed).toBe(false);
    expect((await fetchUrl('http://0177.0.0.1/')).allowed).toBe(false);
  });

  it('denies IPv4-mapped and NAT64 forms of a blocked address', async () => {
    expect((await fetchUrl('http://[::ffff:169.254.169.254]/')).allowed).toBe(false);
    expect((await fetchUrl('http://[64:ff9b::127.0.0.1]/')).allowed).toBe(false);
  });

  it('denies the private ranges an internal service would sit on', async () => {
    for (const host of ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1', '100.64.0.1']) {
      expect((await fetchUrl(`http://${host}/`)).allowed).toBe(false);
    }
  });

  it('allows a public address', async () => {
    expect((await fetchUrl('https://93.184.216.34/')).allowed).toBe(true);
    // 172.32 is outside 172.16/12 — the boundary is a range, not a prefix match.
    expect((await fetchUrl('http://172.32.0.1/')).allowed).toBe(true);
  });

  it('allows a public hostname', async () => {
    const result = await fetchUrl('https://docs.anthropic.com/en/docs');
    expect(result.allowed).toBe(true);
  });

  it('allows a hostname that does not resolve — the fetch fails on its own', async () => {
    const result = await fetchUrl('https://this-host-does-not-exist.invalid/');
    expect(result.allowed).toBe(true);
  });

  it('refuses non-http schemes', async () => {
    expect((await fetchUrl('file:///etc/passwd')).allowed).toBe(false);
    expect((await fetchUrl('ftp://example.com/')).allowed).toBe(false);
  });

  it('refuses a malformed or missing url rather than passing it through', async () => {
    expect((await fetchUrl('not a url')).allowed).toBe(false);
    expect((await evaluateSdkNetworkAccess('WebFetch', {})).allowed).toBe(false);
    expect((await evaluateSdkNetworkAccess('WebFetch', { url: 42 })).allowed).toBe(false);
  });

  it('leaves tools that name no URL alone', async () => {
    // WebSearch takes a query; anything it surfaces reaches the network through
    // WebFetch, which is checked.
    expect((await evaluateSdkNetworkAccess('WebSearch', { query: 'system dynamics' })).allowed).toBe(true);
    expect((await evaluateSdkNetworkAccess('Read', { file_path: '/tmp/x' })).allowed).toBe(true);
  });
});

describe('createSdkNetworkGuard', () => {
  const preToolUse = (toolName, toolInput) => ({
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
  });

  it('denies with a PreToolUse decision the SDK will honour under bypassPermissions', async () => {
    const guard = createSdkNetworkGuard();

    const out = await guard(preToolUse('WebFetch', { url: 'http://169.254.169.254/' }));

    expect(out.hookSpecificOutput).toEqual({
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: expect.stringContaining('not allowed'),
    });
  });

  it('stays out of the way of a permitted fetch', async () => {
    const guard = createSdkNetworkGuard();

    expect(await guard(preToolUse('WebFetch', { url: 'https://93.184.216.34/' }))).toEqual({});
  });

  it('ignores hook events other than PreToolUse', async () => {
    const guard = createSdkNetworkGuard();

    expect(await guard({ hook_event_name: 'PostToolUse', tool_name: 'WebFetch' })).toEqual({});
  });
});
