import { z } from 'zod';
import logger from './logger.js';

/**
 * The message a required argument gives back when the model leaves it out.
 *
 * Zod's default for a missing argument is "expected string, received undefined",
 * which names the type but not the argument's purpose — and since MCP validates
 * before the handler runs, that default is the entire account the model gets of
 * what it did wrong, on the one failure that actually happens in practice. It
 * retries by guessing. Naming the argument and repeating its own description gives
 * it the thing it needs instead.
 *
 * Only for `undefined`: returning undefined for every other issue leaves zod's
 * message standing, so a wrong *type* still reads as a wrong type rather than as a
 * missing argument.
 */
function requiredError(propName, propDef) {
  const detail = (propDef?.description ?? '').trim();
  const sentence = detail ? ` ${detail.endsWith('.') ? detail : `${detail}.`}` : '';

  return issue => (issue.input === undefined ? `'${propName}' is required.${sentence}` : undefined);
}

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
    if (!jsonSchema || (!jsonSchema.type && !jsonSchema.properties)) {
      logger.warn('Invalid JSON Schema provided');
      return z.any();
    }

    // Handle object schema. A schema carrying `properties` but no `type` is an
    // object too — convertTypeToZod already infers that for a nested property, and
    // the two disagreeing here was silent and expensive: `z.any()` has no `.shape`,
    // so a client tool whose schema omitted `type` was registered with an empty
    // shape, advertised to the model as taking no arguments at all, and had whatever
    // the model did send stripped before the handler saw it. No error anywhere.
    if (jsonSchema.type === 'object' || (!jsonSchema.type && jsonSchema.properties)) {
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
  convertObjectSchema(jsonSchema, params) {
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];

    const zodSchema = {};

    for (const [propName, propDef] of Object.entries(properties)) {
      const isRequired = required.includes(propName);

      // The message rides on the leaf type, not on the enclosing object, because the
      // leaf is what sees the `undefined` — and because it then survives being handed
      // to MCP as a raw shape, which is the only form registerTool takes.
      let zodField = this.convertTypeToZod(
        propDef,
        isRequired ? { error: requiredError(propName, propDef) } : undefined
      );

      // Make optional if not required
      if (!isRequired) {
        zodField = zodField.optional();
      }

      // Add description if present
      if (propDef.description) {
        zodField = zodField.describe(propDef.description);
      }

      zodSchema[propName] = zodField;
    }

    return z.object(zodSchema, params);
  }

  /**
   * Convert JSON Schema type to Zod type
   * @param {Object} propDef - JSON Schema property definition
   * @returns {import('zod').ZodTypeAny} Zod type
   */
  convertTypeToZod(propDef, params) {
    // Handle anyOf / oneOf as union
    if (propDef.anyOf || propDef.oneOf) {
      const items = propDef.anyOf || propDef.oneOf;
      const nullItems = items.filter(v => v.type === 'null');
      const nonNullItems = items.filter(v => v.type !== 'null');
      if (nonNullItems.length === 0) return z.null(params);
      let base = nonNullItems.length === 1
        ? this.convertTypeToZod(nonNullItems[0], params)
        : z.union(nonNullItems.map(v => this.convertTypeToZod(v)), params);
      return nullItems.length > 0 ? base.nullable() : base;
    }

    // No type field — infer from shape
    if (propDef.type === undefined) {
      if (propDef.properties || propDef.additionalProperties) {
        return this.convertNestedObject(propDef, params);
      }
      if (propDef.items) {
        return this.convertArrayType(propDef, params);
      }
      if (propDef.enum) {
        return this.convertStringType(propDef, params);
      }
      return z.any();
    }

    switch (propDef.type) {
      case 'string':
        return this.convertStringType(propDef, params);
      case 'number':
        return z.number(params);
      case 'integer':
        return z.number(params).int();
      case 'boolean':
        return z.boolean(params);
      case 'null':
        return z.null(params);
      case 'array':
        return this.convertArrayType(propDef, params);
      case 'object':
        return this.convertNestedObject(propDef, params);
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
  convertStringType(propDef, params) {
    if (propDef.enum && Array.isArray(propDef.enum) && propDef.enum.length > 0) {
      // Zod v4 z.enum requires at least one value
      // For safety, ensure we have at least one string value
      const enumValues = propDef.enum.filter(v => typeof v === 'string');
      if (enumValues.length > 0) {
        return z.enum(enumValues, params);
      }
    }
    return z.string(params);
  }

  /**
   * Convert array type
   * @param {Object} propDef - JSON Schema array property
   * @returns {import('zod').ZodArray} Zod array
   */
  convertArrayType(propDef, params) {
    if (propDef.items) {
      return z.array(this.convertTypeToZod(propDef.items), params);
    }
    return z.array(z.any(), params);
  }

  /**
   * Convert nested object
   * @param {Object} propDef - JSON Schema nested object property
   * @returns {import('zod').ZodObject} Zod object
   */
  convertNestedObject(propDef, params) {
    if (propDef.properties) {
      return this.convertObjectSchema(propDef, params);
    }
    return z.object({}, params).catchall(z.any());
  }
}
