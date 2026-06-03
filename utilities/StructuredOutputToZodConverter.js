import { z } from 'zod';
import logger from './logger.js';

/**
 * StructuredOutputToZodConverter
 * Converts JSON Schema (structured output format) to Zod schemas
 *
 * This is the inverse of Zod's toJSONSchema() method.
 * Used primarily for converting client-registered tool schemas
 * (which come in JSON Schema format) to Zod schemas for validation.
 */
export class StructuredOutputToZodConverter {
  /**
   * Convert JSON schema to Zod schema
   * @param {Object} jsonSchema - JSON Schema object
   * @returns {import('zod').ZodTypeAny} Zod schema
   */
  convert(jsonSchema) {
    if (!jsonSchema || !jsonSchema.type) {
      logger.warn('Invalid JSON Schema provided');
      return z.any();
    }

    // Handle object schema
    if (jsonSchema.type === 'object') {
      return this.convertObjectSchema(jsonSchema);
    }

    // Handle primitive or array schema
    return this.convertTypeToZod(jsonSchema);
  }

  /**
   * Convert JSON Schema object to Zod object schema
   * @param {Object} jsonSchema - JSON Schema object with properties
   * @returns {import('zod').ZodObject} Zod object schema
   */
  convertObjectSchema(jsonSchema) {
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];

    const zodSchema = {};

    for (const [propName, propDef] of Object.entries(properties)) {
      let zodField = this.convertTypeToZod(propDef);

      // Make optional if not required
      if (!required.includes(propName)) {
        zodField = zodField.optional();
      }

      // Add description if present
      if (propDef.description) {
        zodField = zodField.describe(propDef.description);
      }

      zodSchema[propName] = zodField;
    }

    return z.object(zodSchema);
  }

  /**
   * Convert JSON Schema type to Zod type
   * @param {Object} propDef - JSON Schema property definition
   * @returns {import('zod').ZodTypeAny} Zod type
   */
  convertTypeToZod(propDef) {
    // Handle anyOf / oneOf as union
    if (propDef.anyOf || propDef.oneOf) {
      const items = propDef.anyOf || propDef.oneOf;
      const nullItems = items.filter(v => v.type === 'null');
      const nonNullItems = items.filter(v => v.type !== 'null');
      if (nonNullItems.length === 0) return z.null();
      const variants = nonNullItems.map(v => this.convertTypeToZod(v));
      let base = variants.length === 1 ? variants[0] : z.union(variants);
      return nullItems.length > 0 ? base.nullable() : base;
    }

    // No type field — infer from shape
    if (propDef.type === undefined) {
      if (propDef.properties || propDef.additionalProperties) {
        return this.convertNestedObject(propDef);
      }
      if (propDef.items) {
        return this.convertArrayType(propDef);
      }
      if (propDef.enum) {
        return this.convertStringType(propDef);
      }
      return z.any();
    }

    switch (propDef.type) {
      case 'string':
        return this.convertStringType(propDef);
      case 'number':
        return z.number();
      case 'integer':
        return z.number().int();
      case 'boolean':
        return z.boolean();
      case 'null':
        return z.null();
      case 'array':
        return this.convertArrayType(propDef);
      case 'object':
        return this.convertNestedObject(propDef);
      default:
        logger.warn(`Unknown JSON Schema type: ${propDef.type}`);
        return z.any();
    }
  }

  /**
   * Convert string type with enum support
   * @param {Object} propDef - JSON Schema string property
   * @returns {import('zod').ZodString|import('zod').ZodEnum} Zod string or enum
   */
  convertStringType(propDef) {
    if (propDef.enum && Array.isArray(propDef.enum) && propDef.enum.length > 0) {
      // Zod v4 z.enum requires at least one value
      // For safety, ensure we have at least one string value
      const enumValues = propDef.enum.filter(v => typeof v === 'string');
      if (enumValues.length > 0) {
        return z.enum(enumValues);
      }
    }
    return z.string();
  }

  /**
   * Convert array type
   * @param {Object} propDef - JSON Schema array property
   * @returns {import('zod').ZodArray} Zod array
   */
  convertArrayType(propDef) {
    if (propDef.items) {
      return z.array(this.convertTypeToZod(propDef.items));
    }
    return z.array(z.any());
  }

  /**
   * Convert nested object
   * @param {Object} propDef - JSON Schema nested object property
   * @returns {import('zod').ZodObject} Zod object
   */
  convertNestedObject(propDef) {
    if (propDef.properties) {
      return this.convertObjectSchema(propDef);
    }
    return z.object({}).catchall(z.any());
  }
}
