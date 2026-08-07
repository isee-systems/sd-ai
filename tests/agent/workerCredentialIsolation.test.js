/**
 * Regression guard: no real provider credential may sit in an environment the
 * agent can read.
 *
 * Two environments matter, and they are separate holes:
 *  - the worker's own, exposed at /proc/<pid>/environ, which the SDK route's Read
 *    tool can open on any absolute path;
 *  - the `claude` CLI subprocess's, which the Agent SDK gives it by inheriting
 *    process.env unless the query passes `env` — reachable with `env` from Bash.
 *
 * The Anthropic key cannot be withheld from the second one (the CLI authenticates
 * from its environment and the SDK offers no alternative), so it is replaced by a
 * per-session sentinel that only the loopback CredentialProxy exchanges.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { workerCredentials } from '../../agent/WorkerSpawner.js';
import { anthropicSdkSubprocessEnv } from '../../agent/AgentOrchestrator.js';

const PROVIDER_KEYS = [
  'OPENAI_API_KEY', 'GEMINI_API_KEY', 'OPEN_ROUTER_API_KEY', 'DEEPSEEK_API_KEY',
];

let saved;

beforeEach(() => {
  saved = { ...process.env };
  for (const name of [...PROVIDER_KEYS, 'ANTHROPIC_API_KEY']) {
    process.env[name] = `real-${name}`;
  }
});

afterEach(() => {
  process.env = saved;
});

describe('workerCredentials', () => {
  it('carries the provider keys that must reach the worker', () => {
    const values = workerCredentials();

    for (const name of PROVIDER_KEYS) {
      expect(values[name]).toBe(`real-${name}`);
    }
  });

  it('excludes the Anthropic key, which travels as a sentinel instead', () => {
    // The one credential the worker cannot hold in its heap: the Agent SDK
    // spawns the claude CLI, which reads it from the environment.
    expect(workerCredentials()).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('derives OpenAI-compatible provider keys from the registry', async () => {
    const { OPENAI_COMPATIBLE_PROVIDERS, envVarNamesFor } =
      await import('../../agent/utilities/nativeProviders.js');

    const values = workerCredentials();

    for (const provider of OPENAI_COMPATIBLE_PROVIDERS) {
      expect(values).toHaveProperty(envVarNamesFor(provider).apiKey);
    }
  });
});

describe('anthropicSdkSubprocessEnv', () => {
  it('withholds every non-Anthropic provider key from the CLI subprocess', () => {
    const env = anthropicSdkSubprocessEnv();

    for (const name of PROVIDER_KEYS) {
      expect(env).not.toHaveProperty(name);
    }
  });

  it('passes nothing whose value is a real provider credential', () => {
    // Broader than the list above: catches a future key added to the worker's
    // environment that nobody remembered to exclude here.
    const values = Object.values(anthropicSdkSubprocessEnv());

    for (const name of PROVIDER_KEYS) {
      expect(values).not.toContain(`real-${name}`);
    }
  });

  it('passes the Anthropic key through — WorkerSpawner has made it a sentinel', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-sdai-proxy-deadbeef';

    expect(anthropicSdkSubprocessEnv().ANTHROPIC_API_KEY).toBe('sk-sdai-proxy-deadbeef');
  });

  it('carries the transport settings a proxied or custom-CA deployment needs', () => {
    process.env.HTTPS_PROXY = 'http://corp-proxy:3128';
    process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/corp.pem';
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:51423';

    const env = anthropicSdkSubprocessEnv();

    expect(env.HTTPS_PROXY).toBe('http://corp-proxy:3128');
    expect(env.NODE_EXTRA_CA_CERTS).toBe('/etc/ssl/corp.pem');
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:51423');
  });

  it('omits names that are unset rather than defining them as undefined', () => {
    delete process.env.NODE_EXTRA_CA_CERTS;

    expect(anthropicSdkSubprocessEnv()).not.toHaveProperty('NODE_EXTRA_CA_CERTS');
  });
});
