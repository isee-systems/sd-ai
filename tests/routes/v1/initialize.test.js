import request from 'supertest';
import express from 'express';
import initializeRouter from '../../../routes/v1/initialize.js';

describe('Initialize Route', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/', initializeRouter);
  });

  describe('GET /', () => {
    it('should return success when supported platform parameters are provided', async () => {
      const response = await request(app)
        .get('/')
        .query({
          clientProduct: 'test-client',
          clientVersion: '1.0.0'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Diagram generation session is ready.');
    });

    it('should return failure when clientProduct is missing', async () => {
      const response = await request(app)
        .get('/')
        .query({
          clientVersion: '1.0.0'
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Your client application is not currently supported.');
    });

    it('should return failure when clientVersion is missing', async () => {
      const response = await request(app)
        .get('/')
        .query({
          clientProduct: 'test-client'
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Your client application is not currently supported.');
    });

    it('should return failure when both parameters are missing', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Your client application is not currently supported.');
    });
  });
});