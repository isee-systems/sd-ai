import request from 'supertest';
import express from 'express';
import enginesRouter from '../../../routes/v1/engines.js';

describe('Engines Route', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', enginesRouter);
  });

  describe('GET /', () => {
    it('should return success response with engines list', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.engines).toBeDefined();
      expect(Array.isArray(response.body.engines)).toBe(true);
    });

    it('should return recommended defaults', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.recommendedDefaults).toEqual({
        "sfd": "quantitative",
        "cld": "qualitative",
        "sfd-discuss": "seldon",
        "cld-discuss": "seldon"
      });
    });

    it('should return engines with name and supports properties', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      response.body.engines.forEach(engine => {
        expect(engine.name).toBeDefined();
        expect(typeof engine.name).toBe('string');
        expect(engine.supports).toBeDefined();
        expect(Array.isArray(engine.supports)).toBe(true);
      });
    });

    it('should prioritize qualitative engine first in list', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      if (response.body.engines.length > 0) {
        const qualEngine = response.body.engines.find(e => e.name === 'qualitative');
        if (qualEngine) {
          expect(response.body.engines[0]).toEqual(qualEngine);
        }
      }
    });

    it('should only include engines with supported modes', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      response.body.engines.forEach(engine => {
        expect(engine.supports.length).toBeGreaterThan(0);
      });
    });
  });
});