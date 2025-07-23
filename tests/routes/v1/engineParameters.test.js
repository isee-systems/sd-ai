import request from 'supertest';
import express from 'express';
import engineParametersRouter from '../../../routes/v1/engineParameters.js';

describe('EngineParameters Route', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', engineParametersRouter);
  });

  describe('GET /:engine/parameters', () => {
    it('should return success response with parameters list', async () => {
      const response = await request(app)
        .get('/quantitative/parameters')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.parameters).toBeDefined();
      expect(Array.isArray(response.body.parameters)).toBe(true);
    });

    it('should include base parameters for all engines', async () => {
      const response = await request(app)
        .get('/quantitative/parameters')
        .expect(200);

      const paramNames = response.body.parameters.map(p => p.name);
      
      expect(paramNames).toContain('prompt');
      expect(paramNames).toContain('currentModel');
    });

    it('should return prompt parameter with correct properties', async () => {
      const response = await request(app)
        .get('/quantitative/parameters')
        .expect(200);

      const promptParam = response.body.parameters.find(p => p.name === 'prompt');
      
      expect(promptParam).toBeDefined();
      expect(promptParam.type).toBe('string');
      expect(promptParam.required).toBe(true);
      expect(promptParam.uiElement).toBe('textarea');
      expect(promptParam.label).toBe('Prompt');
      expect(promptParam.description).toContain('Description of desired model');
    });

    it('should return currentModel parameter with correct properties', async () => {
      const response = await request(app)
        .get('/quantitative/parameters')
        .expect(200);

      const currentModelParam = response.body.parameters.find(p => p.name === 'currentModel');
      
      expect(currentModelParam).toBeDefined();
      expect(currentModelParam.type).toBe('json');
      expect(currentModelParam.required).toBe(false);
      expect(currentModelParam.defaultValue).toBe('{"variables": [], "relationships": []}');
      expect(currentModelParam.uiElement).toBe('hidden');
    });

    it('should include engine-specific additional parameters', async () => {
      const response = await request(app)
        .get('/quantitative/parameters')
        .expect(200);

      expect(response.body.parameters.length).toBeGreaterThan(3);
    });

    it('should handle different engines', async () => {
      const engines = ['quantitative', 'qualitative', 'seldon', 'causal-chains','recursivecausal'];
      
      for (const engine of engines) {
        const response = await request(app)
          .get(`/${engine}/parameters`)
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.parameters).toBeDefined();
        expect(Array.isArray(response.body.parameters)).toBe(true);
        
        const paramNames = response.body.parameters.map(p => p.name);
        expect(paramNames).toContain('prompt');
        expect(paramNames).toContain('currentModel');
      }
    });


    it('should return parameters with required properties', async () => {
      const response = await request(app)
        .get('/quantitative/parameters')
        .expect(200);

      response.body.parameters.forEach(param => {
        expect(param.name).toBeDefined();
        expect(typeof param.name).toBe('string');
        expect(param.type).toBeDefined();
        expect(typeof param.type).toBe('string');
        expect(typeof param.required).toBe('boolean');
      });
    });
  });
});