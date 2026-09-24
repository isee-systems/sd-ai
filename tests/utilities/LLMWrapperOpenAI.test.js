import { describe, test, expect, jest, beforeAll, beforeEach } from '@jest/globals';
import { zodResponseFormat } from 'openai/helpers/zod';

// The OpenAI SDK is replaced so these tests can see the exact request the wrapper
// builds, and hand back a chosen answer, without calling the API.
let answer = null;
const createSpy = jest.fn();

jest.unstable_mockModule('openai', () => ({
  default: class MockOpenAI {
    constructor() {
      this.chat = {
        completions: {
          create: (params) => {
            createSpy(params);
            return Promise.resolve({
              choices: [{ message: { role: 'assistant', content: answer } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 }
            });
          }
        }
      };
    }
  }
}));

let LLMWrapper;

beforeAll(async () => {
  ({ LLMWrapper } = await import('../../utilities/LLMWrapper.js'));
});

beforeEach(() => {
  createSpy.mockClear();
  answer = '{}';
});

const newWrapper = () => new LLMWrapper({ openAIKey: 'test-openai-key', underlyingModel: 'gpt-4o' });
const messages = [{ role: 'user', content: 'model this' }];
const sentSchema = () => createSpy.mock.calls[0][0].response_format.json_schema;

describe('the OpenAI path with structured outputs', () => {
  test('sends the quantitative schema with sub-types on, every field required and none nullable', async () => {
    // zodResponseFormat threw on this schema back when its sub-type fields were optional.
    const wrapper = newWrapper();
    const schema = wrapper.generateQuantitativeSDJSONResponseSchema(true, true, true, true);

    await wrapper.createChatCompletion(messages, 'gpt-4o', schema, null, null);

    const variable = sentSchema().schema.properties.variables.items;
    expect(sentSchema().strict).toBe(true);
    expect(variable.required).toEqual(Object.keys(variable.properties));
    expect(variable.properties.subType.enum).toContain('none');
    expect(variable.properties.additionalProperties.type).toBe('array');
    expect(sentSchema()).toEqual(zodResponseFormat(schema, 'sdai_schema').json_schema);
  });

  test('sends the same schema zodResponseFormat did for every schema without optional fields', async () => {
    const wrapper = newWrapper();
    const schemas = [
      wrapper.generateQuantitativeSDJSONResponseSchema(false, false, false, false),
      wrapper.generateQuantitativeSDJSONResponseSchema(true, true, true, false),
      wrapper.generateQuantitativeSDCodeResponseSchema(false),
      wrapper.generateQualitativeSDJSONResponseSchema(false),
      wrapper.generateSeldonResponseSchema(true),
      wrapper.generateLTMNarrativeResponseSchema(false),
      wrapper.generateDocumentationResponseSchema(true, true, false)
    ];

    for (const schema of schemas) {
      createSpy.mockClear();
      await wrapper.createChatCompletion(messages, 'gpt-4o', schema, null, null);
      expect(sentSchema()).toEqual(zodResponseFormat(schema, 'sdai_schema').json_schema);
    }
  });

  test('strips the nulls a model returns for omitted optional fields', async () => {
    answer = JSON.stringify({
      variables: [{ name: 'stock a', subType: null, additionalProperties: null, equation: '1' }],
      title: 'x'
    });
    const wrapper = newWrapper();
    const schema = wrapper.generateQuantitativeSDJSONResponseSchema(false, false, false, true);

    const result = await wrapper.createChatCompletion(messages, 'gpt-4o', schema, null, null);

    expect(JSON.parse(result.content)).toEqual({ variables: [{ name: 'stock a', equation: '1' }], title: 'x' });
  });

  test('leaves the answer alone when no schema was sent', async () => {
    answer = '{"a":null}';
    const wrapper = newWrapper();

    const result = await wrapper.createChatCompletion(messages, 'gpt-4o', null, null, null);

    expect(result.content).toBe('{"a":null}');
  });
});
