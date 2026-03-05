import { validateEvaluationResult } from '../../evals/evaluationSchema.js';

describe('EvaluationResult Schema', () => {
  describe('Valid inputs (AC7.1)', () => {
    it('should accept empty array (representing a passing test)', () => {
      const result = validateEvaluationResult([]);
      expect(result).toEqual([]);
    });

    it('should accept single-element array with valid failure object', () => {
      const input = [{ type: 'Error', details: 'something' }];
      const result = validateEvaluationResult(input);
      expect(result).toEqual(input);
    });

    it('should accept multi-element array with valid failure objects', () => {
      const input = [
        { type: 'Error1', details: 'detail 1' },
        { type: 'Error2', details: 'detail 2' },
        { type: 'Error3', details: 'detail 3' }
      ];
      const result = validateEvaluationResult(input);
      expect(result).toEqual(input);
    });

    it('should accept array with extra properties (Zod strips by default)', () => {
      const input = [
        { type: 'Error', details: 'something', extraProp: 'ignored', another: 123 }
      ];
      const result = validateEvaluationResult(input);
      expect(result).toEqual([{ type: 'Error', details: 'something' }]);
    });
  });

  describe('Invalid inputs - missing type field (AC6.3)', () => {
    it('should reject array with missing type field', () => {
      const input = [{ details: 'missing type' }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should throw ZodError for missing type', () => {
      const input = [{ details: 'missing type' }];
      try {
        validateEvaluationResult(input);
        fail('Should have thrown');
      } catch (error) {
        expect(error.name).toBe('ZodError');
      }
    });
  });

  describe('Invalid inputs - non-string details field (AC6.4)', () => {
    it('should reject array with non-string details field', () => {
      const input = [{ type: 'err', details: 123 }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should throw ZodError for non-string details', () => {
      const input = [{ type: 'err', details: 123 }];
      try {
        validateEvaluationResult(input);
        fail('Should have thrown');
      } catch (error) {
        expect(error.name).toBe('ZodError');
      }
    });

    it('should reject details as boolean', () => {
      const input = [{ type: 'err', details: true }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject details as object', () => {
      const input = [{ type: 'err', details: { message: 'test' } }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject details as null', () => {
      const input = [{ type: 'err', details: null }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject details as array', () => {
      const input = [{ type: 'err', details: ['item1', 'item2'] }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });
  });

  describe('Invalid inputs - non-array input', () => {
    it('should reject plain object', () => {
      const input = { type: 'Error', details: 'something' };
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject null', () => {
      expect(() => validateEvaluationResult(null)).toThrow();
    });

    it('should reject undefined', () => {
      expect(() => validateEvaluationResult(undefined)).toThrow();
    });

    it('should reject string', () => {
      const input = 'not an array';
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject number', () => {
      const input = 42;
      expect(() => validateEvaluationResult(input)).toThrow();
    });
  });

  describe('Invalid inputs - array containing non-object elements', () => {
    it('should reject array containing strings', () => {
      const input = ['error string'];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject array containing numbers', () => {
      const input = [123];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject array with mixed types', () => {
      const input = [
        { type: 'Error', details: 'valid' },
        'invalid string'
      ];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject array containing null', () => {
      const input = [null];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject array containing undefined', () => {
      const input = [undefined];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject array containing objects with null type', () => {
      const input = [{ type: null, details: 'something' }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });
  });

  describe('AC6.3 and AC6.4 combined tests', () => {
    it('should reject object missing both type and details', () => {
      const input = [{}];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should reject object with missing type and non-string details', () => {
      const input = [{ details: 456 }];
      expect(() => validateEvaluationResult(input)).toThrow();
    });

    it('should accept object with empty string type (empty strings are valid)', () => {
      const input = [{ type: '', details: 'something' }];
      const result = validateEvaluationResult(input);
      expect(result).toEqual(input);
    });

    it('should accept object with empty string details (empty strings are valid)', () => {
      const input = [{ type: 'Error', details: '' }];
      const result = validateEvaluationResult(input);
      expect(result).toEqual(input);
    });
  });
});
