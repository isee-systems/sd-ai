/**
 * Unit tests for BuiltInToolProvider's MCP-server tool filtering.
 *
 * Regression guard for the Anthropic Agent SDK pathway: query() runs with
 * permissionMode 'bypassPermissions', under which `allowedTools` does NOT remove
 * a tool the model can see — it only pre-approves. So supportedModes and
 * model-token gating MUST happen at MCP registration time; a tool left on the
 * server stays advertised and callable regardless of the query's allowedTools.
 * These tests assert getMcpServer omits tools whose supportedModes / token
 * constraints don't match (mirroring getAdkTools and the manual pathways).
 */
import { BuiltInToolProvider } from '../../../agent/tools/BuiltInToolProvider.js';
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

function makeProvider(session = {}) {
  const sessionManager = {
    getSession: () => session,
    getSessionTempDir: () => '/tmp/sess_test', // VisualizationEngine requires a temp dir
  };
  const sendToClient = async () => {};
  // The media store is a required dependency: generate_image and view_media are
  // built from it at registration time. Constructed here rather than faked because
  // it is a thin handle over a directory and these tests never read a picture.
  const mediaStore = new MediaStore(sessionManager, 'sess_test');
  return new BuiltInToolProvider(sessionManager, 'sess_test', sendToClient, 'anthropic', mediaStore);
}

// MCP's McpServer stores registered tools keyed by name on _registeredTools.
async function registeredToolNames(provider, mode, modelTokenCount = 0) {
  const { instance } = await provider.getMcpServer(mode, modelTokenCount);
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

  it('never registers read_file (the Agent SDK provides a native Read)', async () => {
    // Excluded at registration, not just allowedTools — bypassPermissions would
    // otherwise leave it callable alongside native Read in either mode.
    const sfd = await registeredToolNames(makeProvider(), 'sfd', 0);
    const cld = await registeredToolNames(makeProvider(), 'cld', 0);
    expect(sfd.has('read_file')).toBe(false);
    expect(cld.has('read_file')).toBe(false);
  });
});

describe('BuiltInToolProvider.getMcpServer — model-token filtering', () => {
  it('omits engine tools when the model exceeds maxModelTokens', async () => {
    const huge = config.agentMaxTokensForEngines + 1;
    const names = await registeredToolNames(makeProvider(), 'sfd', huge);
    expect(names.has('generate_quantitative_model')).toBe(false);
  });

  it('gates targeted-edit tools on minModelTokens', async () => {
    const below = await registeredToolNames(makeProvider(), 'sfd', 0);
    expect(below.has('edit_variables')).toBe(false); // minimum not met at 0 tokens

    const above = await registeredToolNames(makeProvider(), 'sfd', config.agentTargetedEditingMinimum + 1);
    expect(above.has('edit_variables')).toBe(true);
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
