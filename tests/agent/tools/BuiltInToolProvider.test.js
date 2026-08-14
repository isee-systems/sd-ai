/**
 * Unit tests for BuiltInToolProvider's MCP-server tool filtering.
 *
 * Regression guard for the Anthropic Agent SDK pathway: query() runs with
 * permissionMode 'bypassPermissions', under which `allowedTools` does NOT remove
 * a tool the model can see — it only pre-approves. So session-fixed gating
 * (supportedModes, sandbox grant, media capability) MUST happen at MCP
 * registration time; a tool left on the server stays advertised and callable
 * regardless of the query's allowedTools.
 *
 * Model-SIZE gating is the opposite case and is tested as such below: the server is
 * built once per query and the model changes during it, so those gates are enforced
 * when the handler runs, not when the tool is registered.
 */
import { BuiltInToolProvider } from '../../../agent/tools/BuiltInToolProvider.js';
import { modelStateGate } from '../../../agent/tools/toolAvailability.js';
import { MediaStore } from '../../../agent/utilities/MediaStore.js';
import config from '../../../config.js';

// A session that can actually do media, which takes both halves: the client said it
// can display images, AND it registered a tool that takes a handle. See
// toolAvailability.js — a flag on its own is not enough, because a generated image
// with nowhere to go is a billed call the model can do nothing with.
const MEDIA_SESSION = {
  supportsMedia: true,
  clientTools: [{ name: 'write_interface_media', media: { inputs: ['image'] } }]
};

function makeProvider(session = {}, canWriteToLocalSandbox = false) {
  const sessionManager = {
    getSession: () => session,
    getSessionTempDir: () => '/tmp/sess_test', // VisualizationEngine requires a temp dir
  };
  const sendToClient = async () => {};
  // The media store is a required dependency: generate_image and view_media are
  // built from it at registration time. Constructed here rather than faked because
  // it is a thin handle over a directory and these tests never read a picture.
  const mediaStore = new MediaStore(sessionManager, 'sess_test');
  return new BuiltInToolProvider(sessionManager, 'sess_test', sendToClient, 'anthropic', mediaStore, canWriteToLocalSandbox);
}

// MCP's McpServer stores registered tools keyed by name on _registeredTools.
async function registeredToolNames(provider, mode) {
  const { instance } = await provider.getMcpServer(mode);
  return new Set(Object.keys(instance._registeredTools));
}

describe('BuiltInToolProvider.getMcpServer — mode filtering', () => {
  it('omits sfd-only tools (e.g. draw_causal_loop_diagram) in cld mode', async () => {
    const names = await registeredToolNames(makeProvider(), 'cld', 0);
    // sfd-only tools must NOT be registered in cld mode
    expect(names.has('draw_causal_loop_diagram')).toBe(false);
    expect(names.has('generate_quantitative_model')).toBe(false);
    expect(names.has('create_visualization')).toBe(false);
    expect(names.has('generate_ltm_narrative')).toBe(false);
    // cld-supported tools remain available
    expect(names.has('generate_qualitative_model')).toBe(true); // cld-only
    expect(names.has('get_feedback_information')).toBe(true);    // both modes
  });

  it('registers sfd-only tools in sfd mode and omits cld-only tools', async () => {
    const names = await registeredToolNames(makeProvider(), 'sfd', 0);
    expect(names.has('draw_causal_loop_diagram')).toBe(true);
    expect(names.has('generate_quantitative_model')).toBe(true);
    expect(names.has('generate_qualitative_model')).toBe(false); // cld-only
  });

});

describe('BuiltInToolProvider — sandbox write gating', () => {
  it('applies the grant to the ADK tool list', async () => {
    // getAdkTools is where the grant is observable: unlike the SDK route below, ADK
    // has no native Write/Edit, so these builtins are the only write tools it has.
    const denied = (await makeProvider({}, false).getAdkTools('sfd', 0)).map(t => t.name);
    const granted = (await makeProvider({}, true).getAdkTools('sfd', 0)).map(t => t.name);
    expect(denied).not.toContain('write_file');
    expect(denied).not.toContain('edit_file');
    expect(granted).toContain('write_file');
    expect(granted).toContain('edit_file');
    // Reading is never gated — get_variable_data's output has to be readable back.
    expect(denied).toContain('read_file');
  });

  it('leaves the rest of the toolset alone', async () => {
    const names = await registeredToolNames(makeProvider({}, false), 'sfd');
    expect(names.has('get_current_model')).toBe(true);
    expect(names.has('run_model')).toBe(true);
  });
});

describe('BuiltInToolProvider.getMcpServer — tools the Agent SDK provides natively', () => {
  // read_file, write_file and edit_file all have native SDK equivalents (Read, Write,
  // Edit), so registering them here would hand the model two tools for one job and
  // route writes around the SDK's own file tracking. Excluded at registration rather
  // than via allowedTools, which bypassPermissions ignores.
  //
  // The consequence worth pinning: granting can_write_to_local_sandbox must NOT change
  // what an sdk-mode agent sees on this server. Merlin's grant reaches it through the
  // native Write/Edit/Bash in the query's tool list, not through here.
  it('never registers the three file builtins, granted or not', async () => {
    for (const grant of [true, false]) {
      for (const mode of ['sfd', 'cld']) {
        const names = await registeredToolNames(makeProvider({}, grant), mode);
        expect(names.has('read_file')).toBe(false);
        expect(names.has('write_file')).toBe(false);
        expect(names.has('edit_file')).toBe(false);
      }
    }
  });

  it('registers an identical tool set whether or not the agent may write', async () => {
    const granted = await registeredToolNames(makeProvider({}, true), 'sfd');
    const denied = await registeredToolNames(makeProvider({}, false), 'sfd');
    expect([...granted].sort()).toEqual([...denied].sort());
  });
});

describe('BuiltInToolProvider — model-state gating', () => {
  // The bug: an agent that inserted an assembly into an empty model spent the rest of
  // that turn unable to edit an equation, because the SDK's MCP server is built once
  // per query and had been built while the model was still empty. A tool that cannot
  // be used is withheld — but withholding is only half of it, since the model changes
  // mid-turn and the list has to change with it.
  const EMPTY_MODEL = { variables: [], relationships: [] };
  const ONE_VARIABLE = { variables: [{ name: 'population', type: 'stock', equation: '100' }] };

  const callTool = async (session, toolName, args = {}) => {
    const provider = makeProvider(session);
    return provider.getTools().tools[toolName].handler(args);
  };

  // What tools/list would return: MCP filters disabled tools out of it.
  const liveToolNames = async (provider, mode) => {
    const { instance } = await provider.getMcpServer(mode);
    return new Set(Object.entries(instance._registeredTools)
      .filter(([, tool]) => tool.enabled)
      .map(([name]) => name));
  };

  it('withholds a tool the model cannot support yet, in both directions', async () => {
    const empty = await liveToolNames(makeProvider({ clientModel: EMPTY_MODEL }), 'sfd');
    expect(empty.has('edit_variables')).toBe(false);
    expect(empty.has('generate_quantitative_model')).toBe(true);

    const huge = await liveToolNames(
      makeProvider({ clientModel: ONE_VARIABLE, modelTokenCount: config.agentMaxTokensForEngines + 1 }), 'sfd');
    expect(huge.has('edit_variables')).toBe(true);
    expect(huge.has('generate_quantitative_model')).toBe(false);
  });

  it('restores a withheld tool when the model gains content mid-query', async () => {
    // The reported failure, start to finish: the turn opens on an empty model, an
    // assembly lands, and the agent must be able to edit it without waiting for the
    // next turn — which on this route means without rebuilding the server.
    const session = { clientModel: EMPTY_MODEL };
    const provider = makeProvider(session);
    const { instance } = await provider.getMcpServer('sfd');

    expect(instance._registeredTools.edit_variables.enabled).toBe(false);

    session.clientModel = ONE_VARIABLE;
    session.modelTokenCount = null;
    provider.syncModelStateGates();

    expect(instance._registeredTools.edit_variables.enabled).toBe(true);
  });

  it('withdraws the engines when the model outgrows them mid-query', async () => {
    const session = { clientModel: ONE_VARIABLE };
    const provider = makeProvider(session);
    const { instance } = await provider.getMcpServer('sfd');

    expect(instance._registeredTools.generate_quantitative_model.enabled).toBe(true);

    session.modelTokenCount = config.agentMaxTokensForEngines + 1;
    provider.syncModelStateGates();

    expect(instance._registeredTools.generate_quantitative_model.enabled).toBe(false);
  });

  // The backstop behind the withholding: a list is only as current as its last
  // rebuild, and a call can land just after the model moved under it.
  it('refuses a targeted edit on an empty model, naming what to do instead', async () => {
    const result = await callTool({ clientModel: EMPTY_MODEL }, 'edit_variables',
      { operation: 'update', data: [{ name: 'population' }] });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/generate_quantitative_model/);
  });

  it('allows a targeted edit as soon as the model holds anything at all', async () => {
    // One variable is enough — far below the 250-token floor this used to require,
    // which is what withheld editing right after an assembly was inserted.
    const gate = modelStateGate({ requiresModelContent: true }, { clientModel: ONE_VARIABLE });
    expect(gate).toBeNull();
  });

  it('refuses an engine call once the model outgrows the engines, mid-turn', async () => {
    const result = await callTool(
      { clientModel: ONE_VARIABLE, modelTokenCount: config.agentMaxTokensForEngines + 1 },
      'generate_quantitative_model',
      { prompt: 'anything', difficulty: 'normal' }
    );

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/edit_variables/);
  });
});

describe('BuiltInToolProvider.getMcpServer — media conversion', () => {
  // The bug this guards: the MCP registration returned a tool's envelope raw, so a
  // tool answering with a picture handed MCP our internal {type:'media'} block. MCP
  // validates content against its own union (text | image | audio | resource_link |
  // resource) and rejected the whole call with invalid_union — the model got an
  // error instead of the image it had just generated.
  //
  // Exercised through view_media, a real registered built-in that returns a media
  // block deterministically and needs no network. The converter itself was never the
  // broken part; the registration path was, so the test has to go through it.
  const MCP_CONTENT_TYPES = new Set(['text', 'image', 'audio', 'resource_link', 'resource']);

  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  async function registeredHandler(provider, toolName) {
    const { instance } = await provider.getMcpServer('sfd', 0);
    // MCP 1.29 keeps the registered function on `handler`.
    return instance._registeredTools[toolName].handler;
  }

  it('converts a media handle block into an MCP image block', async () => {
    const provider = makeProvider(MEDIA_SESSION);
    const meta = provider.mediaStore.put(PNG_1x1, { name: 'drawn.png', mimeType: 'image/png' });

    const handler = await registeredHandler(provider, 'view_media');
    const result = await handler({ mediaId: meta.mediaId }, {});

    // The assertion that would have caught the production failure.
    for (const block of result.content) {
      expect(MCP_CONTENT_TYPES.has(block.type)).toBe(true);
    }
    expect(result.content.find(b => b.type === 'image')).toEqual({
      type: 'image',
      data: PNG_1x1.toString('base64'),
      mimeType: 'image/png'
    });
  });

  it('names the handle in the text block beside the picture', async () => {
    const provider = makeProvider(MEDIA_SESSION);
    const meta = provider.mediaStore.put(PNG_1x1, { name: 'drawn.png', mimeType: 'image/png' });

    const handler = await registeredHandler(provider, 'view_media');
    const result = await handler({ mediaId: meta.mediaId }, {});

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(meta.mediaId);
  });

  it('throws on an error result so the SDK surfaces it, rather than returning isError', async () => {
    const provider = makeProvider(MEDIA_SESSION);
    const handler = await registeredHandler(provider, 'view_media');

    await expect(handler({ mediaId: 'med_0123456789abcdef' }, {}))
      .rejects.toThrow(/not an image this session is holding/);
  });
});

describe('BuiltInToolProvider.getMcpServer — media capability gating', () => {
  // The intersection this closes: generate_image and view_media declare
  // supportedModes ['sfd','cld'], which is every mode, so the mode filter never
  // withheld them from anyone. A modeling session with Merlin or Socrates was
  // offered an image generator whose output had nowhere to go.
  it('withholds both media tools from a session that never declared media', async () => {
    for (const mode of ['sfd', 'cld']) {
      const names = await registeredToolNames(makeProvider(), mode);
      expect(names.has('generate_image')).toBe(false);
      expect(names.has('view_media')).toBe(false);
      // The gate is specific to media — everything else still registers.
      expect(names.has('get_current_model')).toBe(true);
    }
  });

  it('registers both media tools in either mode once the client can use them', async () => {
    for (const mode of ['sfd', 'cld']) {
      const names = await registeredToolNames(makeProvider(MEDIA_SESSION), mode);
      expect(names.has('generate_image')).toBe(true);
      expect(names.has('view_media')).toBe(true);
    }
  });

  it('withholds them from a media-capable client with no media-capable tool', async () => {
    // This is Stella in a plain modeling session: supportsMedia is unconditionally
    // true because the client can decode images, but its media tools are registered
    // only for interface authoring. Neither side special-cases the agent — the empty
    // contract is what withholds the tools.
    const names = await registeredToolNames(makeProvider({
      supportsMedia: true,
      clientTools: [{ name: 'run_model', inputSchema: { type: 'object', properties: {} } }]
    }), 'sfd');
    expect(names.has('generate_image')).toBe(false);
    expect(names.has('view_media')).toBe(false);
  });

  it('withholds them when tools could use media but the client never declared it', async () => {
    // The flag is the gate, not an optimisation over the tool contracts: a client
    // that cannot render an image does not get one generated for it.
    const names = await registeredToolNames(makeProvider({
      clientTools: [{ name: 'write_interface_media', media: { inputs: ['image'] } }]
    }), 'sfd');
    expect(names.has('generate_image')).toBe(false);
    expect(names.has('view_media')).toBe(false);
  });

  it('offers view_media but not generate_image when the client only returns media', async () => {
    // read_interface_media / capture_interface_preview hand pictures back without
    // taking any. Handles exist and are worth looking at again, but there is still
    // nowhere to put something newly drawn.
    const names = await registeredToolNames(makeProvider({
      supportsMedia: true,
      clientTools: [{ name: 'capture_interface_preview', media: { returnsMedia: true } }]
    }), 'sfd');
    expect(names.has('view_media')).toBe(true);
    expect(names.has('generate_image')).toBe(false);
  });
});
