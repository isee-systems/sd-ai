import { z } from 'zod';
import { ZodToGeminiConverter } from '../ZodToGeminiConverter.js';
import { LLMWrapper } from '../utils.js';

describe('ZodToGeminiConverter', () => {
  let converter;
  let llmWrapper;

  beforeEach(() => {
    converter = new ZodToGeminiConverter();
    // Still need LLMWrapper for testing actual schema generation
    llmWrapper = new LLMWrapper({
      openAIKey: 'test-key',
      googleKey: 'test-google-key'
    });
  });

  describe('basic type conversion', () => {
    it('should convert ZodString to Gemini string schema', () => {
      const zodSchema = z.string();
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string'
      });
    });

    it('should convert ZodString with description', () => {
      const zodSchema = z.string().describe('Test description');
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        description: 'Test description'
      });
    });

    it('should convert ZodNumber to Gemini number schema', () => {
      const zodSchema = z.number();
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'number'
      });
    });

    it('should convert ZodNumber with description', () => {
      const zodSchema = z.number().describe('A test number');
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'number',
        description: 'A test number'
      });
    });

    it('should convert ZodBoolean to Gemini boolean schema', () => {
      const zodSchema = z.boolean();
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'boolean'
      });
    });
  });

  describe('array conversion', () => {
    it('should convert ZodArray to Gemini array schema', () => {
      const zodSchema = z.array(z.string());
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'array',
        items: {
          type: 'string'
        }
      });
    });

    it('should convert ZodArray with description and constraints', () => {
      const zodSchema = z.array(z.number()).min(1).max(10).describe('Array of numbers');
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'array',
        items: {
          type: 'number'
        },
        description: 'Array of numbers',
        minItems: 1,
        maxItems: 10
      });
    });

    it('should convert nested arrays', () => {
      const zodSchema = z.array(z.array(z.string()));
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'string'
          }
        }
      });
    });
  });

  describe('object conversion', () => {
    it('should convert simple ZodObject to Gemini object schema', () => {
      const zodSchema = z.object({
        name: z.string(),
        age: z.number()
      });
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name', 'age'],
        propertyOrdering: ['name', 'age']
      });
    });

    it('should convert ZodObject with optional properties', () => {
      const zodSchema = z.object({
        name: z.string(),
        age: z.number().optional(),
        email: z.string().optional()
      });
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number', nullable: true },
          email: { type: 'string', nullable: true }
        },
        required: ['name'],
        propertyOrdering: ['name', 'age', 'email']
      });
    });

    it('should convert ZodObject with description', () => {
      const zodSchema = z.object({
        id: z.string()
      }).describe('Test object');
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string' }
        },
        required: ['id'],
        propertyOrdering: ['id'],
        description: 'Test object'
      });
    });

    it('should convert nested objects', () => {
      const zodSchema = z.object({
        user: z.object({
          name: z.string(),
          contact: z.object({
            email: z.string(),
            phone: z.string().optional()
          })
        }),
        metadata: z.object({
          created: z.string(),
          updated: z.string().optional()
        })
      });

      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              contact: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  phone: { type: 'string', nullable: true }
                },
                required: ['email'],
                propertyOrdering: ['email', 'phone']
              }
            },
            required: ['name', 'contact'],
            propertyOrdering: ['name', 'contact']
          },
          metadata: {
            type: 'object',
            properties: {
              created: { type: 'string' },
              updated: { type: 'string', nullable: true }
            },
            required: ['created'],
            propertyOrdering: ['created', 'updated']
          }
        },
        required: ['user', 'metadata'],
        propertyOrdering: ['user', 'metadata']
      });
    });
  });

  describe('enum conversion', () => {
    it('should convert ZodEnum to Gemini enum schema', () => {
      const zodSchema = z.enum(['red', 'green', 'blue']);
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        enum: ['red', 'green', 'blue']
      });
    });

    it('should convert ZodEnum with description', () => {
      const zodSchema = z.enum(['+', '-']).describe('Polarity enum');
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        enum: ['+', '-'],
        description: 'Polarity enum'
      });
    });
  });

  describe('union and optional conversion', () => {
    it('should convert ZodOptional to nullable schema', () => {
      const zodSchema = z.string().optional();
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        nullable: true
      });
    });

    it('should convert ZodUnion with null to nullable schema', () => {
      const zodSchema = z.union([z.string(), z.null()]);
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        nullable: true
      });
    });

    it('should convert ZodUnion of literals to enum', () => {
      const zodSchema = z.union([z.literal('small'), z.literal('medium'), z.literal('large')]);
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        enum: ['small', 'medium', 'large']
      });
    });

    it('should convert ZodUnion of number literals to number enum', () => {
      const zodSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'number',
        enum: [1, 2, 3]
      });
    });

    it('should handle complex unions by defaulting to string', () => {
      const zodSchema = z.union([z.string(), z.number()]);
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string'
      });
    });
  });

  describe('literal conversion', () => {
    it('should convert ZodLiteral string to enum with single value', () => {
      const zodSchema = z.literal('fixed-value');
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'string',
        enum: ['fixed-value']
      });
    });

    it('should convert ZodLiteral number to enum with single value', () => {
      const zodSchema = z.literal(42);
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'number',
        enum: [42]
      });
    });
  });

  describe('actual schema conversion tests', () => {
    it('should convert generateQualitativeSDJSONResponseSchema', () => {
      const zodSchema = llmWrapper.generateQualitativeSDJSONResponseSchema();
      const result = converter.convert(zodSchema);

      expect(result.type).toBe('object');
      expect(result.properties).toBeDefined();
      expect(result.properties.relationships).toBeDefined();
      expect(result.properties.relationships.type).toBe('array');
      expect(result.properties.relationships.items.type).toBe('object');
      expect(result.properties.relationships.items.properties.from.type).toBe('string');
      expect(result.properties.relationships.items.properties.to.type).toBe('string');
      expect(result.properties.relationships.items.properties.polarity).toEqual({
        type: 'string',
        enum: ['+', '-']
      });
      expect(result.properties.explanation.type).toBe('string');
      expect(result.properties.title.type).toBe('string');
      expect(result.required).toContain('relationships');
      expect(result.required).toContain('explanation');
      expect(result.required).toContain('title');
      expect(result.propertyOrdering).toBeDefined();
    });

    it('should convert generateQuantitativeSDJSONResponseSchema', () => {
      const zodSchema = llmWrapper.generateQuantitativeSDJSONResponseSchema(false);
      const result = converter.convert(zodSchema);

      expect(result.type).toBe('object');
      expect(result.properties).toBeDefined();
      expect(result.properties.variables).toBeDefined();
      expect(result.properties.variables.type).toBe('array');
      expect(result.properties.variables.items.type).toBe('object');
      expect(result.properties.variables.items.properties.type.type).toBe('string');
      expect(result.properties.variables.items.properties.type.enum).toEqual(['stock', 'flow', 'variable']);
      expect(result.properties.relationships).toBeDefined();
      expect(result.properties.specs).toBeDefined();
      expect(result.properties.specs.type).toBe('object');
      expect(result.properties.specs.properties.startTime.type).toBe('number');
      expect(result.properties.specs.properties.stopTime.type).toBe('number');
      expect(result.properties.specs.properties.dt.type).toBe('number');
      expect(result.properties.specs.properties.timeUnits.type).toBe('string');
      expect(result.required).toContain('variables');
      expect(result.required).toContain('relationships');
      expect(result.required).toContain('specs');
      expect(result.propertyOrdering).toBeDefined();
    });

    it('should convert generateLTMNarrativeResponseSchema', () => {
      const zodSchema = llmWrapper.generateLTMNarrativeResponseSchema();
      const result = converter.convert(zodSchema);

      expect(result.type).toBe('object');
      expect(result.properties).toBeDefined();
      expect(result.properties.feedbackLoops).toBeDefined();
      expect(result.properties.feedbackLoops.type).toBe('array');
      expect(result.properties.feedbackLoops.items.type).toBe('object');
      expect(result.properties.feedbackLoops.items.properties.identifier.type).toBe('string');
      expect(result.properties.feedbackLoops.items.properties.name.type).toBe('string');
      expect(result.properties.feedbackLoops.items.properties.description.type).toBe('string');
      expect(result.properties.narrativeMarkdown.type).toBe('string');
      expect(result.required).toContain('feedbackLoops');
      expect(result.required).toContain('narrativeMarkdown');
      expect(result.propertyOrdering).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle null or undefined schema', () => {
      expect(converter.convert(null)).toEqual({});
      expect(converter.convert(undefined)).toEqual({});
    });

    it('should handle schema without _def', () => {
      const invalidSchema = {};
      expect(converter.convert(invalidSchema)).toEqual({});
    });

    it('should handle unsupported Zod types by defaulting to string', () => {
      const mockSchema = {
        _def: {
          typeName: 'ZodUnsupported'
        }
      };

      const originalWarn = console.warn;
      const warnings = [];
      console.warn = (message) => warnings.push(message);

      const result = converter.convert(mockSchema);

      expect(result).toEqual({ type: 'string' });
      expect(warnings).toContain('Unsupported Zod type: ZodUnsupported');

      console.warn = originalWarn;
    });

    it('should handle empty objects', () => {
      const zodSchema = z.object({});
      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'object',
        properties: {},
        required: []
      });
    });

    it('should handle arrays with constraints set to null', () => {
      const zodSchema = z.array(z.string());
      // Mock the internal structure to simulate null constraints
      zodSchema._def.minLength = null;
      zodSchema._def.maxLength = null;

      const result = converter.convert(zodSchema);

      expect(result).toEqual({
        type: 'array',
        items: {
          type: 'string'
        }
      });
    });
  });

  describe('converter functionality', () => {
    it('should expose convert method as public API', () => {
      expect(typeof converter.convert).toBe('function');
    });

    it('should be a separate class from LLMWrapper', () => {
      expect(converter).toBeInstanceOf(ZodToGeminiConverter);
      expect(converter).not.toBeInstanceOf(LLMWrapper);
    });
  });
});