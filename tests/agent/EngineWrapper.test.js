import { assertGenerationInput, assertDiscussionPrompt } from '../../agent/utilities/EngineWrapper.js';

describe('assertGenerationInput', () => {
  const emptyModel = { variables: [], relationships: [] };

  describe('rejects requests with nothing to build from', () => {
    it('throws on an empty prompt with no other content', () => {
      expect(() => assertGenerationInput('', emptyModel, {})).toThrow(/non-empty prompt is required/);
    });

    it('throws on a whitespace-only prompt with no other content', () => {
      expect(() => assertGenerationInput('   \n\t', emptyModel, {})).toThrow(/non-empty prompt is required/);
    });

    it('throws on a missing prompt and undefined model/parameters', () => {
      expect(() => assertGenerationInput(undefined, undefined, undefined)).toThrow(/non-empty prompt is required/);
    });

    it('throws when only blank problem statement and background are supplied', () => {
      expect(() => assertGenerationInput('', emptyModel, { problemStatement: '  ', backgroundKnowledge: '' })).toThrow();
    });
  });

  describe('allows requests that have something to build from', () => {
    it('accepts a non-empty prompt', () => {
      expect(() => assertGenerationInput('Build a model of population growth', emptyModel, {})).not.toThrow();
    });

    it('accepts an empty prompt when a problem statement is provided', () => {
      expect(() => assertGenerationInput('', emptyModel, { problemStatement: 'Declining sales' })).not.toThrow();
    });

    it('accepts an empty prompt when background knowledge is provided', () => {
      expect(() => assertGenerationInput('', emptyModel, { backgroundKnowledge: 'Domain notes' })).not.toThrow();
    });

    it('accepts an empty prompt when refining a model with variables', () => {
      expect(() => assertGenerationInput('', { variables: [{ name: 'Population' }], relationships: [] }, {})).not.toThrow();
    });

    it('accepts an empty prompt when refining a model with relationships', () => {
      expect(() => assertGenerationInput('', { variables: [], relationships: [{ from: 'a', to: 'b' }] }, {})).not.toThrow();
    });
  });
});

describe('assertDiscussionPrompt', () => {
  it('throws on an empty prompt', () => {
    expect(() => assertDiscussionPrompt('')).toThrow(/non-empty prompt/);
  });

  it('throws on a whitespace-only prompt', () => {
    expect(() => assertDiscussionPrompt('  \n')).toThrow(/non-empty prompt/);
  });

  it('throws on a missing prompt', () => {
    expect(() => assertDiscussionPrompt(undefined)).toThrow(/non-empty prompt/);
  });

  it('accepts a real question', () => {
    expect(() => assertDiscussionPrompt('What are the key feedback loops?')).not.toThrow();
  });
});
