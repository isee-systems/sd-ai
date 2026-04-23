import { SessionManager } from '../../agent/utilities/SessionManager.js';
import { AgentOrchestrator } from '../../agent/AgentOrchestrator.js';
import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_A_CONFIG = path.join(__dirname, '../../agent/config/ganos-lal.md');
const AGENT_B_CONFIG = path.join(__dirname, '../../agent/config/myrddin.md');

function makeMockAnthropic(summaryText = 'Mocked summary.') {
  return {
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: summaryText }]
      })
    }
  };
}

function modelResultMessage(id) {
  return {
    role: 'user',
    content: [{
      type: 'tool_result',
      tool_use_id: id,
      content: JSON.stringify({ model: { variables: [] }, resultId: id })
    }]
  };
}

// ─── SessionManager.summarizeContextIfNeeded ─────────────────────────────────

describe('SessionManager.summarizeContextIfNeeded', () => {
  let sessionManager;
  let sessionId;

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {});
    sessionManager.anthropic = makeMockAnthropic();
  });

  afterEach(() => { sessionManager.shutdown(); });

  it('does nothing when context is under the token limit', async () => {
    sessionManager.addToConversationHistory(sessionId, { role: 'user', content: 'Hello' });
    sessionManager.addToConversationHistory(sessionId, { role: 'assistant', content: 'Hi there' });

    const contextBefore = [...sessionManager.getConversationContext(sessionId)];
    await sessionManager.summarizeContextIfNeeded(sessionId, 100_000);

    expect(sessionManager.getConversationContext(sessionId)).toEqual(contextBefore);
    expect(sessionManager.anthropic.messages.create).not.toHaveBeenCalled();
  });

  it('replaces old messages with a summary when over the token limit', async () => {
    for (let i = 0; i < 10; i++) {
      sessionManager.addToConversationHistory(sessionId, { role: 'user', content: `Message ${i}` });
      sessionManager.addToConversationHistory(sessionId, { role: 'assistant', content: `Response ${i}` });
    }

    const firstMessage = sessionManager.getConversationContext(sessionId)[0];
    await sessionManager.summarizeContextIfNeeded(sessionId, 1);

    const context = sessionManager.getConversationContext(sessionId);
    expect(context[0]).toEqual(firstMessage);
    expect(context[1].role).toBe('user');
    expect(context[1].content).toMatch(/\[Previous conversation summary\]/);
    expect(sessionManager.anthropic.messages.create).toHaveBeenCalled();
  });

  it('modifies the session context in-place so the live reference reflects the change', async () => {
    for (let i = 0; i < 8; i++) {
      sessionManager.addToConversationHistory(sessionId, { role: 'user', content: `Message ${i}` });
      sessionManager.addToConversationHistory(sessionId, { role: 'assistant', content: `Response ${i}` });
    }

    const liveRef = sessionManager.getConversationContext(sessionId);
    const originalLength = liveRef.length;

    await sessionManager.summarizeContextIfNeeded(sessionId, 1);

    // splice is in-place: the same array object must be updated, not replaced
    expect(liveRef).toBe(sessionManager.getConversationContext(sessionId));
    expect(liveRef.length).toBeLessThan(originalLength);
    expect(liveRef[1].content).toMatch(/\[Previous conversation summary\]/);
  });

  it('uses a fallback summary message when the LLM call fails', async () => {
    sessionManager.anthropic.messages.create.mockRejectedValue(new Error('API error'));

    for (let i = 0; i < 5; i++) {
      sessionManager.addToConversationHistory(sessionId, { role: 'user', content: `Message ${i}` });
      sessionManager.addToConversationHistory(sessionId, { role: 'assistant', content: `Response ${i}` });
    }

    await sessionManager.summarizeContextIfNeeded(sessionId, 1);

    const context = sessionManager.getConversationContext(sessionId);
    expect(context[1].content).toMatch(/condensed/);
  });

  it('does nothing for a non-existent session ID', async () => {
    await expect(
      sessionManager.summarizeContextIfNeeded('non-existent-id', 1)
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
    sessionManager.anthropic = makeMockAnthropic();
  });

  afterEach(() => { sessionManager.shutdown(); });

  it('removes all but the most recent model result', async () => {
    sessionManager.addToConversationHistory(sessionId, { role: 'user', content: 'request 1' });
    sessionManager.addToConversationHistory(sessionId, modelResultMessage('r1'));
    sessionManager.addToConversationHistory(sessionId, { role: 'user', content: 'request 2' });
    sessionManager.addToConversationHistory(sessionId, modelResultMessage('r2'));
    sessionManager.addToConversationHistory(sessionId, { role: 'user', content: 'request 3' });
    sessionManager.addToConversationHistory(sessionId, modelResultMessage('r3'));

    await sessionManager.cleanupContext(sessionId, 100_000);

    const context = sessionManager.getConversationContext(sessionId);
    const modelResults = context.filter(msg =>
      msg.role === 'user' &&
      Array.isArray(msg.content) &&
      msg.content.some(c => {
        try { return JSON.parse(c.content)?.model !== undefined; } catch { return false; }
      })
    );

    expect(modelResults).toHaveLength(1);
    expect(JSON.parse(modelResults[0].content[0].content).resultId).toBe('r3');
  });

  it('leaves the context untouched when there is only one model result', async () => {
    sessionManager.addToConversationHistory(sessionId, { role: 'user', content: 'request' });
    sessionManager.addToConversationHistory(sessionId, modelResultMessage('only'));

    const lengthBefore = sessionManager.getConversationContext(sessionId).length;
    await sessionManager.cleanupContext(sessionId, 100_000);

    expect(sessionManager.getConversationContext(sessionId)).toHaveLength(lengthBefore);
  });

  it('does nothing when context is empty', async () => {
    await expect(
      sessionManager.cleanupContext(sessionId, 100_000)
    ).resolves.toBeUndefined();
    expect(sessionManager.getConversationContext(sessionId)).toHaveLength(0);
  });

  it('summarizes after removing stale models when still over the token limit', async () => {
    for (let i = 0; i < 5; i++) {
      sessionManager.addToConversationHistory(sessionId, { role: 'user', content: `request ${i}` });
      sessionManager.addToConversationHistory(sessionId, modelResultMessage(String(i)));
    }

    await sessionManager.cleanupContext(sessionId, 1);

    const context = sessionManager.getConversationContext(sessionId);
    const hasSummary = context.some(
      msg => typeof msg.content === 'string' && msg.content.includes('[Previous conversation summary]')
    );
    expect(hasSummary).toBe(true);
    expect(sessionManager.anthropic.messages.create).toHaveBeenCalled();
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
    process.env.GOOGLE_API_KEY = 'dummy_key';
  });

  afterEach(() => {
    sessionManager.shutdown();
    sendToClient.mockClear();
  });

  it('second orchestrator sees context accumulated by the first orchestrator', () => {
    const orchestratorA = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_A_CONFIG);

    // Simulate agent A processing a conversation turn (manual mode pushes to live context)
    sessionManager.addToConversationHistory(sessionId, { role: 'user', content: 'Build a causal loop diagram' });
    const context = sessionManager.getConversationContext(sessionId);
    context.push({ role: 'assistant', content: [{ type: 'text', text: 'Here is the CLD.' }] });

    // websocket.js captures the context on switch, then creates a new orchestrator
    const capturedOnSwitch = sessionManager.getConversationContext(sessionId);

    const orchestratorB = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_B_CONFIG);

    // Agent B reads the session context — must see what agent A built
    const agentBContext = sessionManager.getConversationContext(sessionId);
    expect(agentBContext).toBe(capturedOnSwitch);
    expect(agentBContext).toHaveLength(2);
    expect(agentBContext[0].content).toBe('Build a causal loop diagram');
    expect(agentBContext[1].content[0].text).toBe('Here is the CLD.');

    orchestratorA.destroy();
    orchestratorB.destroy();
  });

  it('second orchestrator sees the summarized context after summarization by the first', async () => {
    sessionManager.anthropic = makeMockAnthropic(
      'Agent A built a CLD with 5 variables and 3 feedback loops.'
    );

    const orchestratorA = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_A_CONFIG);

    // Agent A accumulates a large context
    for (let i = 0; i < 10; i++) {
      sessionManager.addToConversationHistory(sessionId, { role: 'user', content: `Step ${i}` });
      sessionManager.addToConversationHistory(sessionId, { role: 'assistant', content: `Done ${i}` });
    }
    const fullLength = sessionManager.getConversationContext(sessionId).length;

    // Summarization fires during agent A's last turn
    await sessionManager.summarizeContextIfNeeded(sessionId, 1);

    // websocket.js captures context and creates agent B
    const capturedOnSwitch = sessionManager.getConversationContext(sessionId);
    const orchestratorB = new AgentOrchestrator(sessionManager, sessionId, sendToClient, AGENT_B_CONFIG);

    const agentBContext = sessionManager.getConversationContext(sessionId);

    // Agent B sees the summarized (shorter) context, not the full bloated one
    expect(agentBContext).toBe(capturedOnSwitch);
    expect(agentBContext.length).toBeLessThan(fullLength);
    expect(
      agentBContext.some(m => typeof m.content === 'string' && m.content.includes('[Previous conversation summary]'))
    ).toBe(true);

    orchestratorA.destroy();
    orchestratorB.destroy();
  });
});
