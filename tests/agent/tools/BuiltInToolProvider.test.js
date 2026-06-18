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
import config from '../../../config.js';

function makeProvider() {
  const sessionManager = {
    getSession: () => ({}),
    getSessionTempDir: () => '/tmp/sess_test', // VisualizationEngine requires a temp dir
  };
  const sendToClient = async () => {};
  return new BuiltInToolProvider(sessionManager, 'sess_test', sendToClient, 'anthropic');
}

// MCP's McpServer stores registered tools keyed by name on _registeredTools.
async function registeredToolNames(provider, mode, modelTokenCount) {
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
