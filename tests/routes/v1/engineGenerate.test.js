import request from 'supertest';
import express from 'express';
import engineGenerateRouter from '../../../routes/v1/engineGenerate.js';

describe('EngineGenerate Route', () => {
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
    delete process.env.AUTHENTICATION_KEY;
  });

  describe('POST /:engine/generate', () => {
    const validPayload = {
      prompt: "Create a simple model",
      underlyingModel: "gpt-4o-mini",
      openAIKey: "test-key-123"
    };

    it('should reject request without API key when no auth key set', async () => {
      const payloadWithoutKey = { ...validPayload };
      delete payloadWithoutKey.openAIKey;

      const response = await request(app)
        .post('/quantitative/generate')
        .send(payloadWithoutKey);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('failed');
    });

    it('should accept request with valid authentication header', async () => {
      process.env.AUTHENTICATION_KEY = 'test-auth-key';
      
      const payloadWithoutKey = { ...validPayload };
      delete payloadWithoutKey.openAIKey;

      const response = await request(app)
        .post('/quantitative/generate')
        .set('Authentication', 'test-auth-key')
        .send(payloadWithoutKey);

      expect(response.status).not.toBe(403);
    });

    it('should reject request with invalid authentication header', async () => {
      process.env.AUTHENTICATION_KEY = 'test-auth-key';
      
      const payloadWithoutKey = { ...validPayload };
      delete payloadWithoutKey.openAIKey;

      const response = await request(app)
        .post('/quantitative/generate')
        .set('Authentication', 'wrong-key')
        .send(payloadWithoutKey);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Unauthorized, please pass valid Authentication header.');
    });

    it('should handle requests with OpenAI key for OpenAI models', async () => {
      const response = await request(app)
        .post('/quantitative/generate')
        .send({
          ...validPayload,
          underlyingModel: 'gpt-4o'
        });

      expect(response.status).not.toBe(403);
    });

    it('should handle requests with Google key for Gemini models', async () => {
      const geminiPayload = {
        ...validPayload,
        underlyingModel: 'gemini-2.5-flash',
        googleKey: 'test-google-key-123'
      };
      delete geminiPayload.openAIKey;

      const response = await request(app)
        .post('/quantitative/generate')
        .send(geminiPayload);

      expect(response.status).not.toBe(403);
    });


    it('should handle currentModel parameter', async () => {
      const payloadWithModel = {
        ...validPayload,
        currentModel: {
          variables: [{ name: 'test', type: 'variable' }],
          relationships: []
        }
      };

      const response = await request(app)
        .post('/quantitative/generate')
        .send(payloadWithModel);

      expect(response.status).not.toBe(403);
    });

    describe('Engine-specific tests', () => {
      it('should handle different engine types', async () => {
        const engines = ['qualitative', 'seldon', 'causal-chains', 'recursivecausal'];
        
        for (const engine of engines) {
          const response = await request(app)
            .post(`/${engine}/generate`)
            .send(validPayload);

          expect(response.status).not.toBe(403);
        }
      });
    });
  });
});