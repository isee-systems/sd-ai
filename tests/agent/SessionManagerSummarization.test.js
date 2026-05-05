import { SessionManager } from '../../agent/utilities/SessionManager.js';
import { AgentOrchestrator } from '../../agent/AgentOrchestrator.js';
import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_A_CONFIG = path.join(__dirname, '../../agent/config/socrates.md');
const AGENT_B_CONFIG = path.join(__dirname, '../../agent/config/merlin.md');

function makeGeminiMock(summaryText = 'Mocked summary.') {
  return {
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: summaryText
      })
    }
  };
}

function userMsg(text) {
  return { role: 'user', parts: [{ text }] };
}

function modelMsg(text) {
  return { role: 'model', parts: [{ text }] };
}

function modelResultMessage(id) {
  return {
    role: 'user',
    parts: [{
      functionResponse: {
        name: 'generate_model',
        response: { result: JSON.stringify({ model: { variables: [] }, resultId: id }) }
      }
    }]
  };
}

function modelToolCallMessage(id) {
  return {
    role: 'model',
    parts: [{
      functionCall: {
        name: 'generate_model',
        args: { id }
      }
    }]
  };
}

// ─── SessionManager.cleanupContext ─────────────────────────────────

describe('SessionManager.cleanupContext', () => {
  let sessionManager;
  let sessionId;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {});
    sessionManager.gemini = makeGeminiMock();
  });

  afterEach(() => { sessionManager.shutdown(); });

  it('does nothing when context is under the token limit', async () => {
    sessionManager.addToConversationHistory(sessionId, userMsg('Hello'));
    sessionManager.addToConversationHistory(sessionId, modelMsg('Hi there'));

    const contextBefore = [...sessionManager.getConversationContext(sessionId)];
    await sessionManager.cleanupContext(sessionId, 100_000);

    expect(sessionManager.getConversationContext(sessionId)).toEqual(contextBefore);
    expect(sessionManager.gemini.models.generateContent).not.toHaveBeenCalled();
  });

  it('replaces old messages with a summary when over the token limit', async () => {
    for (let i = 0; i < 10; i++) {
      sessionManager.addToConversationHistory(sessionId, userMsg(`Message ${i}`));
      sessionManager.addToConversationHistory(sessionId, modelMsg(`Response ${i}`));
    }

    await sessionManager.cleanupContext(sessionId, 1);

    const context = sessionManager.getConversationContext(sessionId);
    expect(context[0].role).toBe('user');
    expect(context[0].parts[0].text).toMatch(/\[Previous conversation summary\]/);
    expect(sessionManager.gemini.models.generateContent).toHaveBeenCalled();
  });

  it('modifies the session context in-place so the live reference reflects the change', async () => {
    for (let i = 0; i < 8; i++) {
      sessionManager.addToConversationHistory(sessionId, userMsg(`Message ${i}`));
      sessionManager.addToConversationHistory(sessionId, modelMsg(`Response ${i}`));
    }

    const liveRef = sessionManager.getConversationContext(sessionId);
    const originalLength = liveRef.length;

    await sessionManager.cleanupContext(sessionId, 1);

    // splice is in-place: the same array object must be updated, not replaced
    expect(liveRef).toBe(sessionManager.getConversationContext(sessionId));
    expect(liveRef.length).toBeLessThan(originalLength);
    expect(liveRef[0].parts[0].text).toMatch(/\[Previous conversation summary\]/);
  });

  it('uses a fallback summary message when the LLM call fails', async () => {
    sessionManager.gemini.models.generateContent.mockRejectedValue(new Error('API error'));

    for (let i = 0; i < 5; i++) {
      sessionManager.addToConversationHistory(sessionId, userMsg(`Message ${i}`));
      sessionManager.addToConversationHistory(sessionId, modelMsg(`Response ${i}`));
    }

    await sessionManager.cleanupContext(sessionId, 1);

    const context = sessionManager.getConversationContext(sessionId);
    expect(context[0].parts[0].text).toMatch(/condensed/);
  });

  it('does nothing for a non-existent session ID', async () => {
    await expect(
      sessionManager.cleanupContext('non-existent-id', 1)
    ).resolves.toBeUndefined();
  });
});

// ─── SessionManager.cleanupContext ───────────────────────────────────────────

describe('SessionManager.cleanupContext', () => {
  let sessionManager;
  let sessionId;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {});
    sessionManager.gemini = makeGeminiMock();
  });

  afterEach(() => { sessionManager.shutdown(); });

  it('does nothing when context is empty', async () => {
    await expect(
      sessionManager.cleanupContext(sessionId, 100_000)
    ).resolves.toBeUndefined();
    expect(sessionManager.getConversationContext(sessionId)).toHaveLength(0);
  });

  it('summarizes after removing stale models when still over the token limit', async () => {
    for (let i = 0; i < 5; i++) {
      sessionManager.addToConversationHistory(sessionId, userMsg(`request ${i}`));
      sessionManager.addToConversationHistory(sessionId, modelToolCallMessage(String(i)));
      sessionManager.addToConversationHistory(sessionId, modelResultMessage(String(i)));
    }

    await sessionManager.cleanupContext(sessionId, 1);

    const context = sessionManager.getConversationContext(sessionId);
    const hasSummary = context.some(
      msg => Array.isArray(msg.parts) && msg.parts[0]?.text?.includes('[Previous conversation summary]')
    );
    expect(hasSummary).toBe(true);
    expect(sessionManager.gemini.models.generateContent).toHaveBeenCalled();
  });
});

// ─── Agent switch context continuity ─────────────────────────────────────────

describe('Agent switch - context continuity between orchestrators', () => {
  let sessionManager;
  let sessionId;
  const sendToClient = jest.fn();

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {});
    process.env.GEMINI_API_KEY = 'dummy_key';
    process.env.ANTHROPIC_API_KEY = 'dummy_key';
  });

  afterEach(() => {
    sessionManager.shutdown();
    sendToClient.mockClear();
  });

  it('second orchestrator sees context accumulated by the first orchestrator', () => {
    const orchestratorA = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_A_CONFIG);

    // Simulate agent A processing a conversation turn (manual mode pushes to live context)
    sessionManager.addToConversationHistory(sessionId, userMsg('Build a causal loop diagram'));
    const context = sessionManager.getConversationContext(sessionId);
    context.push(modelMsg('Here is the CLD.'));

    // websocket.js captures the context on switch, then creates a new orchestrator
    const capturedOnSwitch = sessionManager.getConversationContext(sessionId);

    const orchestratorB = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_B_CONFIG);

    // Agent B reads the session context — must see what agent A built
    const agentBContext = sessionManager.getConversationContext(sessionId);
    expect(agentBContext).toBe(capturedOnSwitch);
    expect(agentBContext).toHaveLength(2);
    expect(agentBContext[0].parts[0].text).toBe('Build a causal loop diagram');
    expect(agentBContext[1].parts[0].text).toBe('Here is the CLD.');

    orchestratorA.destroy();
    orchestratorB.destroy();
  });

  it('second orchestrator sees the summarized context after summarization by the first', async () => {
    sessionManager.gemini = makeGeminiMock(
      'Agent A built a CLD with 5 variables and 3 feedback loops.'
    );

    const orchestratorA = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_A_CONFIG);

    // Agent A accumulates a large context
    for (let i = 0; i < 10; i++) {
      sessionManager.addToConversationHistory(sessionId, userMsg(`Step ${i}`));
      sessionManager.addToConversationHistory(sessionId, modelMsg(`Done ${i}`));
    }
    const fullLength = sessionManager.getConversationContext(sessionId).length;

    // Summarization fires during agent A's last turn
    await sessionManager.cleanupContext(sessionId, 1);

    // websocket.js captures context and creates agent B
    const capturedOnSwitch = sessionManager.getConversationContext(sessionId);
    const orchestratorB = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_B_CONFIG);

    const agentBContext = sessionManager.getConversationContext(sessionId);

    // Agent B sees the summarized (shorter) context, not the full bloated one
    expect(agentBContext).toBe(capturedOnSwitch);
    expect(agentBContext.length).toBeLessThan(fullLength);
    expect(
      agentBContext.some(m => Array.isArray(m.parts) && m.parts[0]?.text?.includes('[Previous conversation summary]'))
    ).toBe(true);

    orchestratorA.destroy();
    orchestratorB.destroy();
  });
});
