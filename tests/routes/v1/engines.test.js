import request from 'supertest';
import express from 'express';
import enginesRouter from '../../../routes/v1/engines.js';

const TIMEOUT = 5*60*1000;

describe('Engines Route', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', enginesRouter);
  });

  describe('GET /', () => {

    it('should return recommended defaults', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.recommendedDefaults).toEqual({
        "sfd": "quantitative",
        "cld": "qualitative",
        "sfd-discuss": "seldon",
        "cld-discuss": "seldon",
        "ltm-discuss": "ltm-narrative",
        "documentation": "generate-documentation"
      });
    }, TIMEOUT);

    it('should return engines with name and supports properties', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      response.body.engines.forEach(engine => {
        expect(engine.name).toBeDefined();
        expect(typeof engine.name).toBe('string');
        expect(engine.supports).toBeDefined();
        expect(Array.isArray(engine.supports)).toBe(true);
        expect(engine.supports.length).toBeGreaterThan(0);
      });
    }, TIMEOUT);

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
    }, TIMEOUT);

    it('should place engines ending in -experimental at the end of the list', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      const engines = response.body.engines;
      const experimentalEngines = engines.filter(engine => engine.name.endsWith('-experimental'));
      const nonExperimentalEngines = engines.filter(engine => !engine.name.endsWith('-experimental'));

      if (experimentalEngines.length > 0) {
        // Find the indices of experimental engines
        const experimentalIndices = experimentalEngines.map(expEngine => 
          engines.findIndex(engine => engine.name === expEngine.name)
        );
        
        // Find the indices of non-experimental engines
        const nonExperimentalIndices = nonExperimentalEngines.map(nonExpEngine => 
          engines.findIndex(engine => engine.name === nonExpEngine.name)
        );

        // All experimental engines should come after all non-experimental engines
        const maxNonExperimentalIndex = Math.max(...nonExperimentalIndices);
        const minExperimentalIndex = Math.min(...experimentalIndices);

        expect(minExperimentalIndex).toBeGreaterThan(maxNonExperimentalIndex);
      }
    }, TIMEOUT);
  });
});