import { jest } from '@jest/globals';
import path from 'path';
import { fileURLToPath } from 'url';

import config from '../../config.js';
import {
  getLadder,
  supportsIntelligence,
  getDefaultLevelId,
  resolveLevel,
  resolveToolLane,
  buildIntelligenceDiscovery,
  resetIntelligenceDiscoveryCache
} from '../../agent/utilities/intelligenceLevels.js';
import { selectEngineModel, selectImageModel } from '../../agent/tools/builtin/toolHelpers.js';
import {
  createSessionReadyMessage,
  createAgentSelectedMessage,
  createIntelligenceChangedMessage,
  validateClientMessage
} from '../../agent/utilities/MessageProtocol.js';
import { anthropic as anthropicPricing, gemini as geminiPricing, openai as openaiPricing, openaiAliases } from '../../utilities/pricing.js';

const { AgentOrchestrator } = await import('../../agent/AgentOrchestrator.js');
const { SessionManager } = await import('../../agent/utilities/SessionManager.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = { path: path.join(__dirname, '../../agent/config/socrates.md') };

// The values the agent sent before intelligence levels existed. Written as literals
// rather than read from config, because the whole point is to detect a config edit that
// silently moves what a legacy client gets.
const LEGACY = {
  anthropicModel: 'claude-sonnet-5',
  anthropicEffort: 'medium',
  anthropicThinking: { type: 'adaptive' },
  geminiModel: 'gemini-3.7-flash',
  geminiToolBuildNormal: 'gemini-3.7-flash low',
  geminiToolBuildHard: 'gemini-3.7-flash high'
};

describe('intelligence ladder — resolution', () => {
  it('treats a provider with no ladder as not participating', () => {
    // The OpenRouter brands are the real instance of this and must stay untouched.
    expect(getLadder('zai')).toBeNull();
    expect(supportsIntelligence('zai')).toBe(false);
    expect(resolveLevel('zai', 'maximum')).toBeNull();
    expect(getDefaultLevelId('zai')).toBeNull();
  });

  it('resolves each configured level of each participating provider', () => {
    for (const provider of Object.keys(config.agentIntelligence.providers)) {
      for (const level of getLadder(provider)) {
        const resolved = resolveLevel(provider, level.id);
        expect(resolved.id).toBe(level.id);
        expect(resolved.level.model).toBe(level.model);
      }
    }
  });

  it('falls back to the provider default rather than erroring on an unknown level', () => {
    // A client that switches provider can legitimately still be holding the previous
    // provider's level id. That must degrade, not fail the session.
    expect(resolveLevel('anthropic', 'no-such-level').id).toBe(getDefaultLevelId('anthropic'));
    expect(resolveLevel('anthropic', undefined).id).toBe(getDefaultLevelId('anthropic'));
    expect(resolveLevel('anthropic', null).id).toBe(getDefaultLevelId('anthropic'));
  });

  it('uses the ladder first rung when the global default id is absent from it', () => {
    const original = config.agentIntelligence;
    try {
      config.agentIntelligence = {
        defaultLevel: 'standard',
        providers: { acme: [{ id: 'fast', model: 'm-fast' }, { id: 'thorough', model: 'm-thorough' }] }
      };
      expect(getDefaultLevelId('acme')).toBe('fast');
      expect(resolveLevel('acme', 'standard').id).toBe('fast');
    } finally {
      config.agentIntelligence = original;
    }
  });
});

describe('intelligence ladder — engine tool lanes', () => {
  it('moves the tool models up with the level', () => {
    const low = selectEngineModel({ provider: 'anthropic', intelligence: 'standard' }, 'normal', 'build');
    const high = selectEngineModel({ provider: 'anthropic', intelligence: 'maximum' }, 'normal', 'build');
    expect(low).toBe(LEGACY.geminiToolBuildNormal);
    expect(high).not.toBe(low);
  });

  it('accepts a bare provider string and resolves it to the default level', () => {
    // Back-compat: every caller and test that predates the profile object passes a string.
    expect(selectEngineModel('anthropic', 'normal', 'build'))
      .toBe(selectEngineModel({ provider: 'anthropic', intelligence: config.agentIntelligence.defaultLevel }, 'normal', 'build'));
    expect(selectImageModel('anthropic')).toBe(selectImageModel({ provider: 'anthropic' }));
  });

  it('reflects a mutation of the live profile object', () => {
    // This is the mid-conversation path: the tools captured this object at registration
    // and only read it inside their handlers, so mutating it must change the next call.
    const profile = { provider: 'anthropic', intelligence: 'standard' };
    const before = selectEngineModel(profile, 'normal', 'build');
    profile.intelligence = 'maximum';
    expect(selectEngineModel(profile, 'normal', 'build')).not.toBe(before);
  });

  it('falls back to the default lane for a provider using its own rung vocabulary', () => {
    const original = config.agentIntelligence;
    try {
      config.agentIntelligence = {
        defaultLevel: 'standard',
        providers: { acme: [{ id: 'thorough', model: 'm-thorough' }] }
      };
      // No `thorough` lane exists in agentToolModels, so it must land on the
      // defaultLevel lane rather than returning nothing.
      expect(resolveToolLane('acme', 'thorough')).toEqual(config.agentToolModels.default.standard);
    } finally {
      config.agentIntelligence = original;
    }
  });

  it('reads a provider override still written in the pre-levels shape', () => {
    // The kinds sit where a level id belongs. Every keyed lookup misses, so without
    // recognising the shape the engine is handed `underlyingModel: undefined` — a
    // silent failure a long way from the config edit that caused it.
    const originalTools = config.agentToolModels;
    try {
      config.agentToolModels = {
        ...config.agentToolModels,
        anthropic: { build: { normal: 'legacy-a', hard: 'legacy-b' }, nonBuild: { normal: 'legacy-c', hard: 'legacy-d' } }
      };
      expect(selectEngineModel({ provider: 'anthropic', intelligence: 'maximum' }, 'hard', 'build')).toBe('legacy-b');
      expect(selectEngineModel({ provider: 'anthropic', intelligence: 'standard' }, 'normal', 'nonBuild')).toBe('legacy-c');
    } finally {
      config.agentToolModels = originalTools;
    }
  });

  it('falls back to the shared table when a provider override covers only some levels', () => {
    const originalTools = config.agentToolModels;
    try {
      config.agentToolModels = {
        ...config.agentToolModels,
        anthropic: { high: { build: { normal: 'only-high' }, nonBuild: { normal: 'only-high' } } }
      };
      // Covered by the override.
      expect(selectEngineModel({ provider: 'anthropic', intelligence: 'high' }, 'normal', 'build')).toBe('only-high');
      // Not covered, and the override has no defaultLevel lane either — must reach the
      // shared table rather than resolving to nothing.
      expect(selectEngineModel({ provider: 'anthropic', intelligence: 'maximum' }, 'normal', 'build'))
        .toBe(config.agentToolModels.default.maximum.build.normal);
    } finally {
      config.agentToolModels = originalTools;
    }
  });

  it("prefers a level's own toolModels over the shared table", () => {
    const original = config.agentIntelligence;
    try {
      const own = { build: { normal: 'own-a', hard: 'own-b' }, nonBuild: { normal: 'own-c', hard: 'own-d' } };
      config.agentIntelligence = {
        defaultLevel: 'standard',
        providers: { acme: [{ id: 'standard', model: 'm', toolModels: own }] }
      };
      expect(selectEngineModel({ provider: 'acme', intelligence: 'standard' }, 'hard', 'build')).toBe('own-b');
    } finally {
      config.agentIntelligence = original;
    }
  });
});

describe('intelligence ladder — config shape guards', () => {
  const providers = () => Object.entries(config.agentIntelligence.providers);

  it('gives every provider a non-empty ladder with unique ids', () => {
    for (const [, ladder] of providers()) {
      expect(ladder.length).toBeGreaterThan(0);
      const ids = ladder.map(l => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const level of ladder) expect(typeof level.model).toBe('string');
    }
  });

  it('prices every model named in a ladder', () => {
    // A model missing from pricing.js silently bills at the provider `default` rate and
    // silently derives the wrong relativeCost, so catch it here rather than in a bill.
    const tables = { anthropic: anthropicPricing, google: geminiPricing, openai: openaiPricing };
    for (const [provider, ladder] of providers()) {
      const table = tables[provider];
      if (!table) continue;
      for (const level of ladder) {
        const resolved = openaiAliases[level.model] ?? level.model;
        expect(table[resolved]).toBeDefined();
      }
    }
  });

  it('never advertises a higher rung as cheaper than a lower one', () => {
    const { byProvider } = buildIntelligenceDiscovery();
    for (const levels of Object.values(byProvider)) {
      const costs = levels.map(l => l.relativeCost).filter(c => c !== undefined);
      expect([...costs]).toEqual([...costs].sort((a, b) => a - b));
    }
  });

  it('starts every ladder at the cheapest rung, so the floor is the default', () => {
    const { byProvider, default: globalDefault } = buildIntelligenceDiscovery();
    for (const levels of Object.values(byProvider)) {
      expect(levels[0].relativeCost).toBe(1);
    }
    expect(globalDefault).toBe(config.agentIntelligence.defaultLevel);
  });

  it('never exposes a model cheaper than the default rung', () => {
    // "Users shouldn't be able to specify haiku": no rung may undercut the floor.
    const cheapestByProvider = { anthropic: 'claude-sonnet-5' };
    for (const [provider, floor] of Object.entries(cheapestByProvider)) {
      const models = getLadder(provider).map(l => l.model);
      expect(models[0]).toBe(floor);
      expect(models).not.toContain('claude-haiku-4-5');
    }
  });
});

describe('intelligence ladder — client discovery payload', () => {
  afterEach(() => resetIntelligenceDiscoveryCache());

  it('advertises levels per provider, omitting providers that do not participate', () => {
    const discovery = buildIntelligenceDiscovery();
    expect(Object.keys(discovery.byProvider)).toEqual(expect.arrayContaining(['anthropic', 'google']));
    expect(discovery.byProvider.zai).toBeUndefined();
  });

  it('never advertises a ladder for a provider a client cannot select', () => {
    // A ladder may be parked ahead of its provider being enabled (openai is, today).
    // Advertising it would hand the client a control that select_agent's provider enum
    // rejects, which is worse than the control simply not being there yet.
    for (const provider of Object.keys(buildIntelligenceDiscovery().byProvider)) {
      expect(config.agentProviders).toContain(provider);
    }

    // Asserted against an injected parked ladder too, so this keeps testing something
    // once every ladder in config.js happens to name an enabled provider.
    const original = config.agentIntelligence;
    try {
      resetIntelligenceDiscoveryCache();
      config.agentIntelligence = {
        defaultLevel: 'standard',
        providers: {
          anthropic: original.providers.anthropic,
          'not-a-provider': [{ id: 'standard', model: 'm' }]
        }
      };
      expect(buildIntelligenceDiscovery().byProvider['not-a-provider']).toBeUndefined();
      expect(buildIntelligenceDiscovery().byProvider.anthropic).toBeDefined();
    } finally {
      config.agentIntelligence = original;
      resetIntelligenceDiscoveryCache();
    }
  });

  it('labels a level from its id when config gives no label', () => {
    const original = config.agentIntelligence;
    try {
      resetIntelligenceDiscoveryCache();
      config.agentIntelligence = {
        defaultLevel: 'standard',
        providers: { anthropic: [{ id: 'very_high', model: 'claude-opus-5' }] }
      };
      expect(buildIntelligenceDiscovery().byProvider.anthropic[0].label).toBe('Very High');
    } finally {
      config.agentIntelligence = original;
      resetIntelligenceDiscoveryCache();
    }
  });

  it('returns null when no provider has a ladder, so the field can be omitted entirely', () => {
    const original = config.agentIntelligence;
    try {
      resetIntelligenceDiscoveryCache();
      config.agentIntelligence = { defaultLevel: 'standard', providers: {} };
      expect(buildIntelligenceDiscovery()).toBeNull();
    } finally {
      config.agentIntelligence = original;
      resetIntelligenceDiscoveryCache();
    }
  });
});

describe('intelligence ladder — wire compatibility for legacy clients', () => {
  it('omits intelligenceLevels from session_ready when there are none', () => {
    const legacyShaped = createSessionReadyMessage('s1', [], {}, null);
    expect('intelligenceLevels' in legacyShaped).toBe(false);
    expect(Object.keys(legacyShaped).sort())
      .toEqual(['availableAgents', 'defaults', 'sessionId', 'timestamp', 'type']);
  });

  it('omits currentIntelligence from agent_selected for a provider with no ladder', () => {
    const msg = createAgentSelectedMessage('s1', 'socrates', 'Socrates', [], 'zai', null);
    expect('currentIntelligence' in msg).toBe(false);
    expect(Object.keys(msg).sort())
      .toEqual(['agentId', 'agentName', 'currentProvider', 'sessionId', 'supportedProviders', 'timestamp', 'type']);
  });

  it('accepts a select_agent that carries no intelligence field', () => {
    const result = validateClientMessage({ type: 'select_agent', sessionId: 's1', agentId: 'socrates' });
    expect(result.success).toBe(true);
    expect(result.data.intelligence).toBeUndefined();
  });

  it('accepts an intelligence id this server does not know rather than rejecting the message', () => {
    // A strict enum here would reject a newer client outright; resolution-time fallback
    // is what makes a mismatch degrade instead.
    const result = validateClientMessage({
      type: 'select_agent', sessionId: 's1', agentId: 'socrates', intelligence: 'some-future-rung'
    });
    expect(result.success).toBe(true);
  });

  it('validates the set_intelligence message', () => {
    expect(validateClientMessage({ type: 'set_intelligence', sessionId: 's1', intelligence: 'high' }).success).toBe(true);
    expect(validateClientMessage({ type: 'set_intelligence', sessionId: 's1' }).success).toBe(false);
  });

  it('rejects an intelligence id too long to be one, on both messages', () => {
    // The id reaches a log line and the frame cap is measured in MB, so "free-form"
    // must still be bounded or a bad id is a write-to-disk primitive.
    const huge = 'x'.repeat(65);
    expect(validateClientMessage({ type: 'set_intelligence', sessionId: 's1', intelligence: huge }).success).toBe(false);
    expect(validateClientMessage({
      type: 'select_agent', sessionId: 's1', agentId: 'socrates', intelligence: huge
    }).success).toBe(false);
    // The bound is generous enough that no plausible rung name trips it.
    expect(validateClientMessage({
      type: 'set_intelligence', sessionId: 's1', intelligence: 'x'.repeat(64)
    }).success).toBe(true);
  });

  it('always reports the applied level on intelligence_changed', () => {
    expect(createIntelligenceChangedMessage('s1', 'high').currentIntelligence).toBe('high');
    expect(createIntelligenceChangedMessage('s1', null).currentIntelligence).toBeNull();
  });
});

describe('intelligence ladder — provider request shapes', () => {
  let sessionManager;
  let sessionId;
  let orc;

  function makeOrc(provider, intelligence) {
    process.env.ANTHROPIC_API_KEY = 'dummy';
    process.env.GEMINI_API_KEY = 'dummy';
    const o = new AgentOrchestrator(
      sessionManager, sessionId, jest.fn().mockResolvedValue(undefined), CONFIG, provider, intelligence
    );
    o.executeToolCallHelper = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'x' }], isError: false });
    o.tokenReporter = { report: jest.fn().mockResolvedValue(undefined) };
    return o;
  }

  function stubAnthropic(o) {
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    o.anthropic = { messages: { create } };
    return create;
  }

  function stubGemini(o) {
    const generateContent = jest.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'done' }] } }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
    });
    // caches.create rejecting drives the uncached fallback, which keeps the assertion on
    // one code path; a separate test covers the cached path's model binding.
    o.gemini = {
      models: { generateContent },
      caches: { create: jest.fn().mockRejectedValue(new Error('no cache in test')), delete: jest.fn() }
    };
    return generateContent;
  }

  beforeEach(() => {
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
  });

  afterEach(() => {
    orc?.destroy();
    sessionManager.shutdown();
  });

  it('sends a legacy client (no intelligence) exactly the pre-feature Anthropic request', async () => {
    orc = makeOrc('anthropic', undefined);
    const create = stubAnthropic(orc);

    await orc.startConversationAnthropicManual('hi');

    const req = create.mock.calls[0][0];
    expect(req.model).toBe(LEGACY.anthropicModel);
    expect(req.thinking).toEqual(LEGACY.anthropicThinking);
    expect(req.output_config).toEqual({ effort: LEGACY.anthropicEffort });
  });

  it('sends a legacy client (no intelligence) exactly the pre-feature Gemini request', async () => {
    orc = makeOrc('google', undefined);
    const generateContent = stubGemini(orc);

    await orc.startConversationGeminiManual('hi');

    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe(LEGACY.geminiModel);
    expect(req.config.thinkingConfig).toEqual(config.agentGeminiThinking);
  });

  it('raises the Anthropic model and effort with the level', async () => {
    orc = makeOrc('anthropic', 'high');
    const create = stubAnthropic(orc);

    await orc.startConversationAnthropicManual('hi');

    const req = create.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-5');
    expect(req.output_config).toEqual({ effort: 'high' });
  });

  it('omits output_config entirely for a level that defines no effort', async () => {
    // The distinction this option exists for: no key at all, not `{effort: undefined}`.
    orc = makeOrc('anthropic', 'maximum');
    const create = stubAnthropic(orc);

    await orc.startConversationAnthropicManual('hi');

    const req = create.mock.calls[0][0];
    expect(req.model).toBe('claude-fable-5');
    expect('output_config' in req).toBe(false);
  });

  it('omits thinkingConfig entirely for a Gemini level that defines no effort', async () => {
    orc = makeOrc('google', 'maximum');
    const generateContent = stubGemini(orc);

    await orc.startConversationGeminiManual('hi');

    const req = generateContent.mock.calls[0][0];
    expect(req.model).toBe('gemini-3.1-pro-preview');
    expect('thinkingConfig' in req.config).toBe(false);
  });

  it('keeps a no-ladder provider on its registry model', async () => {
    orc = makeOrc('anthropic', 'standard');
    const original = config.agentIntelligence;
    try {
      config.agentIntelligence = { defaultLevel: 'standard', providers: {} };
      const create = stubAnthropic(orc);
      await orc.startConversationAnthropicManual('hi');
      const req = create.mock.calls[0][0];
      expect(req.model).toBe(config.nativeAgentProviders.anthropic.model);
      expect(req.output_config).toEqual({ effort: config.agentAnthropicEffort });
    } finally {
      config.agentIntelligence = original;
    }
  });

  it('surfaces a refusal as a message instead of stalling the turn', async () => {
    orc = makeOrc('anthropic', 'maximum');
    orc.anthropic = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [],
          stop_reason: 'refusal',
          stop_details: { type: 'refusal', category: 'cyber' },
          usage: { input_tokens: 1, output_tokens: 0 }
        })
      }
    };

    await orc.startConversationAnthropicManual('hi');

    const texts = orc.sendToClient.mock.calls.map(([m]) => m).filter(m => m.type === 'agent_text');
    expect(texts.some(m => /declined the request/.test(m.content))).toBe(true);
  });
});

describe('intelligence ladder — changing level mid-conversation', () => {
  let sessionManager;
  let sessionId;
  let orc;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'dummy';
    process.env.GEMINI_API_KEY = 'dummy';
    sessionManager = new SessionManager();
    sessionId = sessionManager.createSession(null);
    sessionManager.initializeSession(sessionId, 'cld', {}, [], {}, 'test-client');
  });

  afterEach(() => {
    orc?.destroy();
    sessionManager.shutdown();
  });

  function makeOrc(provider, intelligence) {
    const o = new AgentOrchestrator(
      sessionManager, sessionId, jest.fn().mockResolvedValue(undefined), CONFIG, provider, intelligence
    );
    o.tokenReporter = { report: jest.fn().mockResolvedValue(undefined) };
    return o;
  }

  it('changes the model used by the next turn', async () => {
    orc = makeOrc('anthropic', 'standard');
    const create = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 }
    });
    orc.anthropic = { messages: { create } };

    await orc.startConversationAnthropicManual('first');
    orc.setIntelligence('maximum');
    await orc.startConversationAnthropicManual('second');

    expect(create.mock.calls[0][0].model).toBe('claude-sonnet-5');
    expect(create.mock.calls[1][0].model).toBe('claude-fable-5');
  });

  it('finishes an in-flight turn on the model it started with', async () => {
    // setIntelligence() arrives as a worker IPC message, so it can land between any two
    // awaits of a running turn. A turn that swapped models mid tool-use loop would bill
    // half its iterations to one model and half to another, silently.
    orc = makeOrc('anthropic', 'standard');
    let call = 0;
    const create = jest.fn().mockImplementation(async () => {
      // Change the level from underneath the turn, exactly as the IPC handler would.
      if (call++ === 0) {
        orc.setIntelligence('maximum');
        return {
          content: [{ type: 'tool_use', id: 't1', name: 'get_current_model', input: {} }],
          stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }
        };
      }
      return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    });
    orc.anthropic = { messages: { create } };
    orc.executeToolCallHelper = jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'x' }], isError: false });

    await orc.startConversationAnthropicManual('hi');

    expect(create.mock.calls.length).toBeGreaterThan(1);
    const models = create.mock.calls.map(([req]) => req.model);
    expect(new Set(models).size).toBe(1);
    expect(models[0]).toBe('claude-sonnet-5');

    // ...and the change is not lost — it applies to the next turn.
    await orc.startConversationAnthropicManual('again');
    expect(create.mock.calls[create.mock.calls.length - 1][0].model).toBe('claude-fable-5');
  });

  it('leaves conversation history and the orchestrator instance intact', async () => {
    orc = makeOrc('anthropic', 'standard');
    orc.anthropic = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 }
        })
      }
    };

    await orc.startConversationAnthropicManual('remember this');
    const before = sessionManager.getConversationContext(sessionId).length;
    const sdkSessionBefore = orc.anthropicSdkSessionId;

    orc.setIntelligence('high');

    expect(sessionManager.getConversationContext(sessionId).length).toBe(before);
    expect(orc.anthropicSdkSessionId).toBe(sdkSessionBefore);
    // No agent-switch chatter: the client asked to change one setting, not restart.
    const texts = orc.sendToClient.mock.calls.map(([m]) => m).filter(m => m.type === 'agent_text');
    expect(texts.some(m => /switched to/i.test(m.content ?? ''))).toBe(false);
  });

  it('updates the live tool profile so the next tool call uses the new lane', () => {
    orc = makeOrc('anthropic', 'standard');
    const before = selectEngineModel(orc.agentProfile, 'normal', 'build');

    orc.setIntelligence('maximum');

    expect(orc.builtInToolProvider.agentProfile).toBe(orc.agentProfile);
    expect(selectEngineModel(orc.agentProfile, 'normal', 'build')).not.toBe(before);
  });

  it('drops the Gemini context cache when the model changes', async () => {
    orc = makeOrc('google', 'standard');
    const cachesDelete = jest.fn().mockResolvedValue(undefined);
    const cachesCreate = jest.fn().mockResolvedValue({ name: 'cachedContents/abc' });
    orc.gemini = {
      models: {
        generateContent: jest.fn().mockResolvedValue({
          candidates: [{ content: { parts: [{ text: 'done' }] } }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
        })
      },
      caches: { create: cachesCreate, delete: cachesDelete }
    };

    await orc.startConversationGeminiManual('first');
    expect(cachesCreate).toHaveBeenCalledTimes(1);
    expect(cachesCreate.mock.calls[0][0].model).toBe('gemini-3.7-flash');

    orc.setIntelligence('maximum');
    await orc.startConversationGeminiManual('second');

    // Rebuilt rather than reused: a cache is bound to the model that created it.
    expect(cachesCreate).toHaveBeenCalledTimes(2);
    expect(cachesCreate.mock.calls[1][0].model).toBe('gemini-3.1-pro-preview');
  });

  it('ignores the change for a provider that does not use levels', () => {
    orc = makeOrc('zai', null);
    expect(orc.setIntelligence('maximum')).toBeNull();
    expect(orc.agentProfile.intelligence).toBeNull();
  });
});
