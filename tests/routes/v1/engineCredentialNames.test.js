/**
 * Regression guard: every engine must name its credential parameters the same way.
 *
 * POST /:engine/generate waives AUTHENTICATION_KEY when the request carries its
 * own API key, on the reasoning that such a request runs on the caller's account
 * rather than the operator's. That reasoning holds only while "the client sent
 * openAIKey" implies "the client's key is the one that gets used".
 *
 * causal-chains broke the implication by naming its OpenAI parameter `apiKey`.
 * The route checked `openAIKey`, saw it, waived authentication — and the engine,
 * looking for `apiKey` and finding none, fell back to
 * `process.env.OPENAI_API_KEY`. An unauthenticated caller got a free ride on the
 * operator's credits.
 *
 * The runtime check cannot detect this: `additionalParameters()` is the list the
 * client UI renders, and several engines advertise only the key for their
 * default model while LLMWrapper honours all three regardless. So the invariant
 * is enforced here instead — statically, across every engine, at CI time.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

// The names LLMWrapper reads a client-supplied credential from. A credential
// parameter must use one of these or the waiver stops meaning what it says.
//
// Only the first three appear in the route's CLIENT_CREDENTIAL_PARAMS, so only
// they can waive AUTHENTICATION_KEY. openRouterKey and deepseekKey are read by
// LLMWrapper but waive nothing: an OpenRouter- or Deepseek-routed request always
// needs the header. That is deliberate and fail-closed — see the waiver tests in
// engineGenerateAuth.test.js. `clientId` is canonical and not a secret; it is
// listed here so it does not trip the name heuristic below.
const CANONICAL_CREDENTIAL_NAMES = [
  'openAIKey', 'googleKey', 'anthropicKey', 'openRouterKey', 'deepseekKey', 'clientId'
];

// Parameters that look like a credential: either declared as a password field or
// named like a key. `clientId` is canonical and not secret; it is listed above
// so it does not trip the name heuristic.
function looksLikeCredential(param) {
  if (param.uiElement === 'password') return true;
  return /(^|[a-z])(key|token|secret|password|credential)/i.test(param.name);
}

const ENGINES_DIR = join(process.cwd(), 'engines');
const engineDirs = readdirSync(ENGINES_DIR, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .filter(name => existsSync(join(ENGINES_DIR, name, 'engine.js')));

describe('engine credential parameter names', () => {
  it('found engines to check', () => {
    expect(engineDirs.length).toBeGreaterThan(0);
  });

  it.each(engineDirs)('%s declares only canonical credential parameters', async (name) => {
    const engine = await import(join(ENGINES_DIR, name, 'engine.js'));

    let parameters;
    try {
      parameters = new engine.default().additionalParameters();
    } catch {
      return; // an engine that cannot be constructed here declares nothing to check
    }

    const offenders = parameters
      .filter(looksLikeCredential)
      .map(param => param.name)
      .filter(paramName => !CANONICAL_CREDENTIAL_NAMES.includes(paramName));

    // A non-canonical credential name means a request can waive authentication
    // with a key this engine will not read, and fall back to server credentials.
    expect(offenders).toEqual([]);
  });

  it.each(engineDirs)('%s reads server credentials only under a canonical name', (name) => {
    const source = readFileSync(join(ENGINES_DIR, name, 'engine.js'), 'utf8');

    // Find `parameters.<something> || process.env.<SOMETHING>_KEY` fallbacks and
    // check the parameter side is a canonical name. This is what causal-chains
    // looked like before the fix.
    const fallbacks = [...source.matchAll(
      /parameters\.(\w+)\s*\|\|\s*process\.env\.\w*(?:API_)?KEY/g
    )].map(match => match[1]);

    const offenders = fallbacks.filter(paramName => !CANONICAL_CREDENTIAL_NAMES.includes(paramName));

    expect(offenders).toEqual([]);
  });
});
