/**
 * Unit tests for the shared built-in tool availability predicate.
 *
 * This predicate exists because the same checks used to be inlined at seven call
 * sites — the SDK's MCP server, ADK, both manual loops, OpenRouter's agent and its
 * manual twin, plus the SDK's allowedTools list. These tests pin the predicate
 * itself; BuiltInToolProvider.test.js pins that the registration path actually
 * calls it.
 */
import { isToolAvailable, mediaCapability } from '../../../agent/tools/toolAvailability.js';

const SINK_TOOL = { name: 'write_interface_media', media: { inputs: ['image'] } };
const SOURCE_TOOL = { name: 'capture_interface_preview', media: { returnsMedia: true } };
const PLAIN_TOOL = { name: 'run_model' };

const GENERATE_IMAGE = { supportedModes: ['sfd', 'cld'], requiresMedia: 'sink' };
const VIEW_MEDIA = { supportedModes: ['sfd', 'cld'], requiresMedia: 'any' };

describe('mediaCapability', () => {
  it('reads both halves off the session independently', () => {
    expect(mediaCapability({ supportsMedia: true, clientTools: [SINK_TOOL, SOURCE_TOOL] }))
      .toEqual({ declared: true, hasSink: true, hasSource: true });
  });

  it('treats a missing flag as no, rather than as unknown', () => {
    // Every client that predates media omits the field entirely. Silence has to
    // mean no, or the gate does nothing on exactly the clients it protects.
    expect(mediaCapability({ clientTools: [SINK_TOOL] }).declared).toBe(false);
    expect(mediaCapability({ supportsMedia: 'yes', clientTools: [] }).declared).toBe(false);
  });

  it('does not count an empty inputs array as a sink', () => {
    expect(mediaCapability({ clientTools: [{ media: { inputs: [] } }] }).hasSink).toBe(false);
  });

  it('survives a session that does not exist yet', () => {
    expect(mediaCapability(null)).toEqual({ declared: false, hasSink: false, hasSource: false });
    expect(mediaCapability({})).toEqual({ declared: false, hasSink: false, hasSource: false });
  });
});

describe('isToolAvailable — media gating', () => {
  const sfd = extra => ({ mode: 'sfd', modelTokenCount: 0, ...extra });

  it('requires the flag AND a sink for generate_image', () => {
    expect(isToolAvailable(GENERATE_IMAGE, sfd({ session: { supportsMedia: true, clientTools: [SINK_TOOL] } }))).toBe(true);
    // Flag alone — nowhere to put the picture.
    expect(isToolAvailable(GENERATE_IMAGE, sfd({ session: { supportsMedia: true, clientTools: [PLAIN_TOOL] } }))).toBe(false);
    // Sink alone — the client never said it can render one.
    expect(isToolAvailable(GENERATE_IMAGE, sfd({ session: { clientTools: [SINK_TOOL] } }))).toBe(false);
    expect(isToolAvailable(GENERATE_IMAGE, sfd({ session: {} }))).toBe(false);
  });

  it('accepts either a sink or a source for view_media', () => {
    expect(isToolAvailable(VIEW_MEDIA, sfd({ session: { supportsMedia: true, clientTools: [SINK_TOOL] } }))).toBe(true);
    expect(isToolAvailable(VIEW_MEDIA, sfd({ session: { supportsMedia: true, clientTools: [SOURCE_TOOL] } }))).toBe(true);
    expect(isToolAvailable(VIEW_MEDIA, sfd({ session: { supportsMedia: true, clientTools: [PLAIN_TOOL] } }))).toBe(false);
    expect(isToolAvailable(VIEW_MEDIA, sfd({ session: { clientTools: [SOURCE_TOOL] } }))).toBe(false);
  });

  it('leaves a tool with no media requirement alone', () => {
    const plain = { supportedModes: ['sfd', 'cld'] };
    expect(isToolAvailable(plain, sfd({ session: {} }))).toBe(true);
    expect(isToolAvailable(plain, sfd({ session: null }))).toBe(true);
    expect(isToolAvailable(plain, {})).toBe(true);
  });
});

describe('isToolAvailable — sandbox write gating', () => {
  const WRITE_FILE = { supportedModes: ['sfd', 'cld'], requiresSandboxWrite: true };
  const READ_FILE = { supportedModes: ['sfd', 'cld'] };

  it('offers a write tool only to an agent that was granted the sandbox', () => {
    expect(isToolAvailable(WRITE_FILE, { mode: 'sfd', canWriteToLocalSandbox: true })).toBe(true);
    expect(isToolAvailable(WRITE_FILE, { mode: 'sfd', canWriteToLocalSandbox: false })).toBe(false);
  });

  it('treats an omitted grant as no grant', () => {
    // The predicate has seven call sites. Fail-closed is the failure mode worth
    // having: a call site that forgets to pass the grant hands the model one tool
    // fewer, rather than handing an ungranted agent a writable filesystem.
    expect(isToolAvailable(WRITE_FILE, { mode: 'sfd' })).toBe(false);
    expect(isToolAvailable(WRITE_FILE, {})).toBe(false);
  });

  it('leaves reading alone in both directions', () => {
    // get_variable_data writes simulation output to disk and the SFD instructions
    // require the model to read those numbers back before interpreting them. An
    // agent that could neither write nor read would be unable to describe its own
    // results, which is not what the flag is for.
    expect(isToolAvailable(READ_FILE, { mode: 'sfd', canWriteToLocalSandbox: false })).toBe(true);
    expect(isToolAvailable(READ_FILE, { mode: 'sfd' })).toBe(true);
  });

  it('applies the write gate alongside the others, not instead of them', () => {
    const sfdOnlyWrite = { supportedModes: ['sfd'], requiresSandboxWrite: true };
    expect(isToolAvailable(sfdOnlyWrite, { mode: 'cld', canWriteToLocalSandbox: true })).toBe(false);
    expect(isToolAvailable(sfdOnlyWrite, { mode: 'sfd', canWriteToLocalSandbox: true })).toBe(true);
  });
});

describe('isToolAvailable — pre-existing gates still apply', () => {
  const mediaSession = { supportsMedia: true, clientTools: [SINK_TOOL] };

  it('honours supportedModes', () => {
    const sfdOnly = { supportedModes: ['sfd'] };
    expect(isToolAvailable(sfdOnly, { mode: 'sfd' })).toBe(true);
    expect(isToolAvailable(sfdOnly, { mode: 'cld' })).toBe(false);
    // No mode supplied means no mode filtering, as before.
    expect(isToolAvailable(sfdOnly, {})).toBe(true);
  });

  it('honours the model token range', () => {
    expect(isToolAvailable({ maxModelTokens: 100 }, { modelTokenCount: 101 })).toBe(false);
    expect(isToolAvailable({ maxModelTokens: 100 }, { modelTokenCount: 100 })).toBe(true);
    expect(isToolAvailable({ minModelTokens: 100 }, { modelTokenCount: 99 })).toBe(false);
    expect(isToolAvailable({ minModelTokens: 100 }, { modelTokenCount: 100 })).toBe(true);
  });

  it('applies mode and media gates together, not as alternatives', () => {
    const cldOnlyImage = { supportedModes: ['cld'], requiresMedia: 'sink' };
    expect(isToolAvailable(cldOnlyImage, { mode: 'sfd', session: mediaSession })).toBe(false);
    expect(isToolAvailable(cldOnlyImage, { mode: 'cld', session: mediaSession })).toBe(true);
  });

  it('rejects a missing tool definition instead of throwing', () => {
    expect(isToolAvailable(undefined, { mode: 'sfd' })).toBe(false);
  });
});
