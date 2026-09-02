import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

import logger from '../../utilities/logger.js';

// Every check below has to run with the ambient test flags cleared, because Jest sets
// JEST_WORKER_ID itself — leave it in place and the logger is unconditionally quiet and
// none of these assertions can fail.
const AMBIENT = ['NODE_ENV', 'JEST_WORKER_ID', 'SDAI_TEST_MODE'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(AMBIENT.map(name => [name, process.env[name]]));
  for (const name of AMBIENT) delete process.env[name];
});

afterEach(() => {
  for (const name of AMBIENT) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('logger test-mode detection', () => {
  test('follows SDAI_TEST_MODE set long after this module was imported', () => {
    // The regression this guards: the flag used to be captured in the constructor, so
    // whichever module imported the logger first decided the value for the whole
    // process. evals/run.js sets SDAI_TEST_MODE in its body — which ES modules run only
    // after every static import has been evaluated — so a single added import to
    // run.js was enough to spill engine logs and stack traces over the progress bar.
    expect(logger.isTestMode).toBe(false);

    process.env.SDAI_TEST_MODE = 'true';
    expect(logger.isTestMode).toBe(true);

    delete process.env.SDAI_TEST_MODE;
    expect(logger.isTestMode).toBe(false);
  });

  test('writes nothing once the flag is set', () => {
    process.env.SDAI_TEST_MODE = 'true';
    const spies = {
      log: jest.spyOn(console, 'log').mockImplementation(() => {}),
      error: jest.spyOn(console, 'error').mockImplementation(() => {}),
      warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
      info: jest.spyOn(console, 'info').mockImplementation(() => {}),
      debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
    };
    try {
      logger.log('usage');
      logger.error('boom');
      logger.warn('careful');
      logger.info('fyi');
      logger.debug('detail');

      for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of Object.values(spies)) spy.mockRestore();
    }
  });

  test('writes normally when no test flag is set', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      logger.log('visible');
      expect(spy).toHaveBeenCalledWith('visible');
    } finally {
      spy.mockRestore();
    }
  });

  test('treats NODE_ENV=test and a Jest worker as test mode too', () => {
    process.env.NODE_ENV = 'test';
    expect(logger.isTestMode).toBe(true);

    delete process.env.NODE_ENV;
    process.env.JEST_WORKER_ID = '1';
    expect(logger.isTestMode).toBe(true);
  });
});
