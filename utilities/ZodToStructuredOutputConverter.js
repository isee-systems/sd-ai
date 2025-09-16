import logger from "./logger.js"

export class ZodToStructuredOutputConverter {
  convert(zodSchema) {
    if (!zodSchema || !zodSchema._def) {
      return {};
    }

    const zodType = zodSchema._def.typeName;

    switch (zodType) {
      case 'ZodString':
        return this.convertZodStringToStructuredOutput(zodSchema._def);
      case 'ZodNumber':
        return this.convertZodNumberToStructuredOutput(zodSchema._def);
      case 'ZodBoolean':
        return { type: 'boolean' };
      case 'ZodArray':
        return this.convertZodArrayToStructuredOutput(zodSchema._def);
      case 'ZodObject':
        return this.convertZodObjectToStructuredOutput(zodSchema._def);
      case 'ZodEnum':
        return this.convertZodEnumToStructuredOutput(zodSchema._def);
      case 'ZodOptional':
        const innerSchema = this.convert(zodSchema._def.innerType);
        return { ...innerSchema, nullable: true };
      case 'ZodUnion':
        return this.convertZodUnionToStructuredOutput(zodSchema._def);
      case 'ZodLiteral':
        return this.convertZodLiteralToStructuredOutput(zodSchema._def);
      default:
        logger.warn(`Unsupported Zod type: ${zodType}`);
        return { type: 'string' };
    }
  }

  convertZodStringToStructuredOutput(def) {
    const schema = { type: 'string' };

    if (def.description) {
      schema.description = def.description;
    }

    return schema;
  }

  convertZodNumberToStructuredOutput(def) {
    const schema = { type: 'number' };

    if (def.description) {
      schema.description = def.description;
    }

    return schema;
  }

  convertZodArrayToStructuredOutput(def) {
    const schema = {
      type: 'array',
      items: this.convert(def.type)
    };

    if (def.description) {
      schema.description = def.description;
    }

    if (def.minLength !== null) {
      schema.minItems = def.minLength.value;
    }

    if (def.maxLength !== null) {
      schema.maxItems = def.maxLength.value;
    }

    return schema;
  }

  convertZodObjectToStructuredOutput(def) {
    const schema = {
      type: 'object',
      properties: {},
      required: []
    };

    if (def.description) {
      schema.description = def.description;
    }

    const propertyOrder = [];

    for (const [key, zodSchema] of Object.entries(def.shape())) {
      schema.properties[key] = this.convert(zodSchema);
      propertyOrder.push(key);

      if (!zodSchema.isOptional()) {
        schema.required.push(key);
      }
    }

    if (propertyOrder.length > 0) {
      schema.propertyOrdering = propertyOrder;
    }

    return schema;
  }

  convertZodEnumToStructuredOutput(def) {
    const schema = {
      type: 'string',
      enum: def.values
    };

    if (def.description) {
      schema.description = def.description;
    }

    return schema;
  }

  convertZodUnionToStructuredOutput(def) {
    const options = def.options;

    if (options.length === 2 && options.some(opt => opt._def.typeName === 'ZodNull')) {
      const nonNullOption = options.find(opt => opt._def.typeName !== 'ZodNull');
      const schema = this.convert(nonNullOption);
      schema.nullable = true;
      return schema;
    }

    const enumValues = [];
    let allLiterals = true;

    for (const option of options) {
      if (option._def.typeName === 'ZodLiteral') {
        enumValues.push(option._def.value);
      } else {
        allLiterals = false;
        break;
      }
    }

    if (allLiterals && enumValues.length > 0) {
      return {
        type: typeof enumValues[0] === 'string' ? 'string' : 'number',
        enum: enumValues
      };
    }

    logger.warn('Complex union types not fully supported, defaulting to string');
    return { type: 'string' };
  }

  convertZodLiteralToStructuredOutput(def) {
    return {
      type: typeof def.value === 'string' ? 'string' : 'number',
      enum: [def.value]
    };
  }
}