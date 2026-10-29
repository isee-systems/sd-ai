import { sanitizeSchemaForGemini } from '../../../agent/tools/builtin/toolHelpers.js';

describe('sanitizeSchemaForGemini', () => {
  it('spells a list of types as anyOf, which Gemini accepts', () => {
    // Stella's model-test tools declare tolerance and run times this way; sent as is,
    // Gemini context-cache creation fails with "Proto field is not repeating".
    const out = sanitizeSchemaForGemini({
      type: 'object',
      properties: { tolerance: { type: ['number', 'string'], description: 'How far off still counts' } }
    });

    expect(out.properties.tolerance).toEqual({
      anyOf: [{ type: 'number' }, { type: 'string' }],
      description: 'How far off still counts'
    });
  });

  it('carries a null member of a type list as nullable', () => {
    const out = sanitizeSchemaForGemini({ type: ['string', 'null'] });

    expect(out).toEqual({ type: 'string', nullable: true });
  });

  it('reaches type lists nested in array items', () => {
    const out = sanitizeSchemaForGemini({
      type: 'array',
      items: { type: 'object', properties: { start: { type: ['number', 'string'] } } }
    });

    expect(out.items.properties.start.anyOf).toEqual([{ type: 'number' }, { type: 'string' }]);
  });

  it('leaves a property that is itself named type alone', () => {
    const out = sanitizeSchemaForGemini({
      type: 'object',
      properties: { type: { type: 'string', enum: ['stock', 'flow'] } }
    });

    expect(out.properties.type).toEqual({ type: 'string', enum: ['stock', 'flow'] });
  });

  it('still drops keys Gemini rejects and converts numeric exclusive bounds', () => {
    const out = sanitizeSchemaForGemini({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'number',
      exclusiveMinimum: 0,
      additionalProperties: false
    });

    expect(out).toEqual({ type: 'number', minimum: 0 });
  });
});
