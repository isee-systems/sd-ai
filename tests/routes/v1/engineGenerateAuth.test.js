/**
 * Regression guard: the bring-your-own-key waiver on POST /:engine/generate.
 *
 * A request carrying its own credentials is allowed past AUTHENTICATION_KEY,
 * because it runs on the caller's account rather than the operator's. The bug
 * was that the waiver keyed off a body field the engine might never read:
 * `causal-chains` named its OpenAI parameter `apiKey`, so `{"openAIKey":"x"}`
 * waived authentication and the engine — finding no `apiKey` — fell back to
 * `process.env.OPENAI_API_KEY`. An unauthenticated caller spent the operator's
 * credits.
 *
 * The waiver now requires the engine to DECLARE the parameter in
 * additionalParameters(), which ties it to the key that will actually be used.
 * These tests pin both halves: the waiver still works where it should, and a
 * name mismatch fails closed.
 */

import request from 'supertest';
import express from 'express';
import engineGenerateRouter from '../../../routes/v1/engineGenerate.js';

const TIMEOUT = 60 * 1000;

describe('engineGenerate credential waiver', () => {
  let app;
  let originalEnv;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', engineGenerateRouter);
    originalEnv = process.env;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AUTHENTICATION_KEY = 'server-auth-key';
  });

  it('403s an unauthenticated request with no client credentials', async () => {
    const response = await request(app)
      .post('/qualitative/generate')
      .send({ prompt: 'hi', underlyingModel: 'gpt-4o-mini' });

    expect(response.status).toBe(403);
  }, TIMEOUT);

  it('waives auth when the engine declares the supplied key parameter', async () => {
    // `qualitative` declares openAIKey, so the caller's key is genuinely used.
    const response = await request(app)
      .post('/qualitative/generate')
      .send({ prompt: 'hi', underlyingModel: 'gpt-4o-mini', openAIKey: 'sk-client-key' });

    expect(response.status).not.toBe(403);
  }, TIMEOUT);

  // The actual vulnerability. causal-chains' parameter is now named openAIKey to
  // match; were it renamed back, the waiver would be denied rather than handing
  // the request the server's key.
  it('causal-chains declares openAIKey, not apiKey', async () => {
    const engine = await import('../../../engines/causal-chains/engine.js');
    const names = new engine.default().additionalParameters().map(p => p.name);

    expect(names).toContain('openAIKey');
    expect(names).not.toContain('apiKey');
  }, TIMEOUT);

  it('does not waive auth for a non-canonical key parameter', async () => {
    // `apiKey` is not one of the three names the route checks and LLMWrapper
    // reads, so it must buy nothing. The invariant that no engine reads its
    // credentials under such a name is pinned by engineCredentialNames.test.js.
    const response = await request(app)
      .post('/qualitative/generate')
      .send({ prompt: 'hi', underlyingModel: 'gpt-4o-mini', apiKey: 'sk-client-key' });

    expect(response.status).toBe(403);
  }, TIMEOUT);

  it('does not waive auth for an empty key', async () => {
    const response = await request(app)
      .post('/qualitative/generate')
      .send({ prompt: 'hi', underlyingModel: 'gpt-4o-mini', openAIKey: '' });

    expect(response.status).toBe(403);
  }, TIMEOUT);

  it('does not waive auth when the key does not match the model kind', async () => {
    // An OpenAI key against a Gemini model buys nothing: the request would run
    // on the server's GEMINI_API_KEY.
    const response = await request(app)
      .post('/qualitative/generate')
      .send({ prompt: 'hi', underlyingModel: 'gemini-3.6-flash', openAIKey: 'sk-client-key' });

    expect(response.status).toBe(403);
  }, TIMEOUT);

  // LLMWrapper reads openRouterKey/deepseekKey, but the route does not treat
  // them as waivers — an OpenRouter-routed request always needs the header.
  // Fail-closed, and pinned so widening the waiver stays a deliberate act.
  it.each([
    ['openRouterKey', 'qwen/qwen3.7-max'],
    ['deepseekKey', 'deepseek-v4-pro'],
  ])('does not waive auth for %s', async (keyName, model) => {
    const response = await request(app)
      .post('/qualitative/generate')
      .send({ prompt: 'hi', underlyingModel: model, [keyName]: 'sk-client-key' });

    expect(response.status).toBe(403);
  }, TIMEOUT);

  it('still accepts a valid Authentication header with no client key', async () => {
    const response = await request(app)
      .post('/qualitative/generate')
      .set('Authentication', 'server-auth-key')
      .send({ prompt: 'hi', underlyingModel: 'gpt-4o-mini' });

    expect(response.status).not.toBe(403);
  }, TIMEOUT);

  it('404s a traversing engine name before doing any auth work', async () => {
    const response = await request(app)
      .post('/..%2f..%2f..%2ftmp/generate')
      .send({ prompt: 'hi' });

    expect(response.status).toBe(404);
  }, TIMEOUT);
});
