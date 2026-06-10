import {
  SDModelSchema,
  InitializeSessionMessageSchema,
  ChatMessageSchema,
  ModelUpdatedNotificationSchema,
  createAgentTextMessage,
  createToolCallNotificationMessage,
  createToolCallCompletedMessage,
  createAgentCompleteMessage,
  createErrorMessage,
  createSessionReadyMessage,
  validateClientMessage,
  createFileAddedMessage,
  createFileRemovedMessage
} from '../../agent/utilities/MessageProtocol.js';

describe('MessageProtocol', () => {
  describe('SDModelSchema', () => {
    it('should validate valid CLD model', () => {
      const model = {
        variables: [{ name: 'Population', type: 'variable' }],
        relationships: [{ from: 'Population', to: 'Births', polarity: '+' }]
      };

      const result = SDModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('should validate valid SFD model', () => {
      const model = {
        variables: [
          { name: 'Stock1', type: 'stock', equation: '100' },
          { name: 'Flow1', type: 'flow', equation: '5' }
        ]
      };

      const result = SDModelSchema.safeParse(model);
      expect(result.success).toBe(true);
    });

    it('should accept additional properties with passthrough', () => {
      const model = {
        variables: [],
        customField: 'custom value',
        anotherField: 123
      };

      const result = SDModelSchema.safeParse(model);
      expect(result.success).toBe(true);
      expect(result.data.customField).toBe('custom value');
    });
  });

  describe('InitializeSessionMessageSchema', () => {
    it('should validate valid initialization message', () => {
      const message = {
        type: 'initialize_session',
        authenticationKey: 'test-key',
        clientProduct: 'sd-web',
        clientVersion: '1.0.0',
        mode: 'cld',
        model: { variables: [] },
        tools: []
      };

      const result = InitializeSessionMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should require mode to be cld or sfd', () => {
      const message = {
        type: 'initialize_session',
        authenticationKey: 'test-key',
        clientProduct: 'sd-web',
        clientVersion: '1.0.0',
        mode: 'invalid',
        model: {},
        tools: []
      };

      const result = InitializeSessionMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should allow optional context', () => {
      const message = {
        type: 'initialize_session',
        authenticationKey: 'test-key',
        clientProduct: 'sd-web',
        clientVersion: '1.0.0',
        mode: 'sfd',
        model: {},
        tools: [],
        context: { description: 'This is test context' }
      };

      const result = InitializeSessionMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe('ChatMessageSchema', () => {
    it('should validate valid chat message', () => {
      const message = {
        type: 'chat',
        sessionId: 'test-123',
        message: 'Build me a population model'
      };

      const result = ChatMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should require message field', () => {
      const message = {
        type: 'chat',
        sessionId: 'test-123'
      };

      const result = ChatMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('ModelUpdatedNotificationSchema', () => {
    it('should validate model update notification', () => {
      const message = {
        type: 'model_updated_notification',
        sessionId: 'test-123',
        model: { variables: [{ name: 'X', type: 'stock' }] },
        changeReason: 'User requested change'
      };

      const result = ModelUpdatedNotificationSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe('add_file / remove_file messages', () => {
    it('validates a well-formed add_file message', () => {
      const result = validateClientMessage({
        type: 'add_file',
        sessionId: 'test-123',
        name: 'spec.md',
        mimeType: 'text/markdown',
        encoding: 'utf8',
        content: '# Spec\nhello'
      });
      expect(result.success).toBe(true);
    });

    it('rejects add_file with a bad encoding', () => {
      const result = validateClientMessage({
        type: 'add_file',
        sessionId: 'test-123',
        name: 'spec.md',
        mimeType: 'text/markdown',
        encoding: 'hex',
        content: 'abc'
      });
      expect(result.success).toBe(false);
    });

    it('rejects add_file missing required fields', () => {
      const result = validateClientMessage({
        type: 'add_file',
        sessionId: 'test-123',
        name: 'spec.md'
      });
      expect(result.success).toBe(false);
    });

    it('validates a well-formed remove_file message', () => {
      const result = validateClientMessage({
        type: 'remove_file',
        sessionId: 'test-123',
        fileId: 'file_abc'
      });
      expect(result.success).toBe(true);
    });

    it('rejects remove_file without a fileId', () => {
      const result = validateClientMessage({
        type: 'remove_file',
        sessionId: 'test-123'
      });
      expect(result.success).toBe(false);
    });
  });

  describe('file snapshot builders', () => {
    it('createFileAddedMessage carries the full file snapshot', () => {
      const files = [{ fileId: 'f1', name: 'a.txt', status: 'ready' }];
      const message = createFileAddedMessage('session-1', files);
      expect(message.type).toBe('file_added');
      expect(message.sessionId).toBe('session-1');
      expect(message.files).toEqual(files);
      expect(message.timestamp).toBeDefined();
    });

    it('createFileRemovedMessage carries the full file snapshot', () => {
      const message = createFileRemovedMessage('session-1', []);
      expect(message.type).toBe('file_removed');
      expect(message.files).toEqual([]);
    });
  });

  describe('message creation helpers', () => {
    it('should create agent text message', () => {
      const message = createAgentTextMessage('session-1', 'Hello user', false);

      expect(message.type).toBe('agent_text');
      expect(message.sessionId).toBe('session-1');
      expect(message.content).toBe('Hello user');
      expect(message.isThinking).toBe(false);
    });

    it('should create tool call notification message', () => {
      const message = createToolCallNotificationMessage(
        'session-1',
        'call-123',
        'generate_quantitative_model',
        { prompt: 'Build model' },
        true
      );

      expect(message.type).toBe('tool_call_notification');
      expect(message.callId).toBe('call-123');
      expect(message.toolName).toBe('generate_quantitative_model');
      expect(message.isBuiltIn).toBe(true);
    });

    it('should create tool call completed message', () => {
      const message = createToolCallCompletedMessage(
        'session-1',
        'call-123',
        'generate_quantitative_model',
        { model: {} },
        false
      );

      expect(message.type).toBe('tool_call_completed');
      expect(message.callId).toBe('call-123');
      expect(message.isError).toBe(false);
    });

    it('should create agent complete message', () => {
      const message = createAgentCompleteMessage('session-1', 'success', 'Done');

      expect(message.type).toBe('agent_complete');
      expect(message.status).toBe('success');
      expect(message.finalMessage).toBe('Done');
    });

    it('should create error message', () => {
      const message = createErrorMessage('session-1', 'Something went wrong', 'GENERIC', true);

      expect(message.type).toBe('error');
      expect(message.error).toBe('Something went wrong');
      expect(message.errorCode).toBe('GENERIC');
    });

    it('should create session ready message', () => {
      const availableAgents = [
        { id: 'socrates', name: 'Socrates', description: 'Helpful mentor' },
        { id: 'merlin', name: 'Merlin', description: 'Expert modeler' }
      ];
      const message = createSessionReadyMessage('session-1', availableAgents);

      expect(message.type).toBe('session_ready');
      expect(message.sessionId).toBe('session-1');
      expect(message.availableAgents).toHaveLength(2);
      expect(message.availableAgents[0].id).toBe('socrates');
    });
  });
});
