import {
  buildManifest, buildAgents, parsePersona, loadPersonas, loadRegistrySnapshot, loadClientConfig, serializeManifest,
  validCommand, validArgs, buildCompatibility, protocolFor, PROTOCOL, BUILDERS, displayName, stripVersion, binFromPackageJson,
  binaryCommand, launchByPlatform,
} from '../../acp/buildManifest.js';

describe('ACP manifest', () => {
  test('personas come from this repo\'s own agent configs', () => {
    const personas = loadPersonas();
    const ids = personas.map(p => p.id);
    expect(ids).toEqual(expect.arrayContaining(['socrates', 'merlin', 'themis']));
    const socrates = personas.find(p => p.id === 'socrates');
    expect(socrates.name).toBe('Socrates');
    expect(socrates.role).toBe('Coach');
    expect(socrates.instructions).not.toMatch(/^---/);   // frontmatter is metadata, not prompt
  });

  test('parsePersona reads frontmatter and single-mode agents', () => {
    const p = parsePersona('athena_CLD.md', '---\nname: "Athena"\nrole: "Guide"\nsupported_modes:\n  - cld\n---\nBe helpful.\n');
    expect(p).toEqual({ id: 'athena_cld', name: 'Athena', role: 'Guide', description: '', mode: 'cld', instructions: 'Be helpful.' });
    expect(parsePersona('x.md', 'no frontmatter')).toBeNull();
  });

  test('commands and arguments follow the client launch rules', () => {
    for (const bad of ['/usr/bin/claude', 'a;b', 'a&&b', '`id`', '$(id)', 'a b', '', '-x', '../x', 'claude\n'])
      expect(validCommand(bad)).toBe(false);
    for (const good of ['claude-agent-acp', 'codex-acp', 'gemini', 'x.cmd']) expect(validCommand(good)).toBe(true);
    expect(validArgs(['--acp', 'serve'])).toBe(true);
    expect(validArgs(['& calc'])).toBe(false);
  });

  test('only the configured agents are enabled; the rest are listed switched off', () => {
    const registry = [
      { id: 'claude-acp', name: 'Claude Agent', distribution: { npx: { package: '@x/claude-agent-acp' } }, _npmBin: 'claude-agent-acp' },
      { id: 'goose', name: 'Goose', distribution: { binary: { 'darwin-aarch64': { cmd: './goose', args: ['acp'] } } } },
    ];
    const { agents } = buildAgents(registry, { goose: {} }, ['claude-acp']);
    expect(agents.find(a => a.id === 'claude-acp').enabled).toBe(true);
    expect(agents.find(a => a.id === 'goose').enabled).toBe(false);
    expect(buildAgents(registry, { goose: { enabled: true } }, []).agents.find(a => a.id === 'goose').enabled).toBe(true);
    expect(buildAgents(registry).agents.every(a => a.enabled)).toBe(true);
  });

  test('registry entries become launchable agents, with configured overrides', () => {
    const registry = [
      { id: 'claude-acp', name: 'Claude Agent', distribution: { npx: { package: '@x/claude-agent-acp@1.0.0' } }, _npmBin: 'claude-agent-acp' },
      { id: 'gemini', name: 'Gemini CLI', distribution: { npx: { package: '@google/gemini-cli@1', args: ['--acp'] } }, _npmBin: 'gemini' },
      { id: 'multi', name: 'Multi', distribution: { npx: { package: 'multi' } }, _npmBin: null },
      { id: 'bin', name: 'Bin ACP', distribution: { binary: { 'darwin-aarch64': { cmd: './bin-acp', args: ['acp'] } } } },
    ];
    const { agents, skipped } = buildAgents(registry, loadClientConfig().agentOverrides);
    expect(skipped).toEqual(['multi']);
    const claude = agents.find(a => a.id === 'claude');
    expect(claude.displayName).toBe('Claude');
    expect(claude.executableEnv).toEqual({ CLAUDE_CODE_EXECUTABLE: 'claude' });
    expect(agents.find(a => a.id === 'gemini').args).toEqual(['--acp']);
    expect(agents.find(a => a.id === 'bin')).toMatchObject({ command: 'bin-acp', displayName: 'Bin' });
  });

  test('a binary agent launched differently on a platform says so in commandByPlatform / argsByPlatform', () => {
    const agy = { id: 'antigravity-acp', name: 'Google Antigravity', distribution: { binary: {
      'darwin-aarch64': { cmd: './agy_acp_server.par' },
      'linux-x86_64': { cmd: './agy_acp_server.par', args: ['--uid='] },
      'windows-x86_64': { cmd: './agy_acp_server.exe' },
    } } };
    const cursor = { id: 'cursor', name: 'Cursor', distribution: { binary: {
      'darwin-aarch64': { cmd: './dist-package/cursor-agent' },
      'windows-x86_64': { cmd: './dist-package\\cursor-agent.cmd' },
    } } };
    const { agents } = buildAgents([agy, cursor]);
    expect(agents.find(a => a.id === 'antigravity-acp')).toMatchObject({
      command: 'agy_acp_server.par', commandByPlatform: { windows: 'agy_acp_server' },
      args: [], argsByPlatform: { linux: ['--uid='] },
    });
    // Same name everywhere once the Windows extension is gone: nothing to say.
    expect(agents.find(a => a.id === 'cursor').commandByPlatform).toBeUndefined();
    expect(agents.find(a => a.id === 'cursor').argsByPlatform).toBeUndefined();
    expect(binaryCommand('./bin\\devin.exe')).toBe('devin');
    expect(binaryCommand('./coco-1.0/cortex')).toBe('cortex');
    expect(launchByPlatform({ distribution: { npx: { package: 'x' } } })).toEqual({ commandByPlatform: {}, argsByPlatform: {} });
  });

  test('helpers', () => {
    expect(displayName('Claude Agent')).toBe('Claude');
    expect(stripVersion('@scope/name@1.2.3')).toBe('@scope/name');
    expect(stripVersion('fast-agent-acp==0.10.1')).toBe('fast-agent-acp');
    expect(binFromPackageJson('p', { bin: { 'p-acp': 'x', other: 'y' } })).toBe('p-acp');
    expect(binFromPackageJson('p', { bin: { a: 'x', b: 'y' } })).toBeNull();
  });

  test('the committed snapshot builds a complete manifest whose serial grows', () => {
    const config = loadClientConfig();
    const registry = loadRegistrySnapshot();
    const earlier = buildManifest({ registry, personas: loadPersonas(), config, now: new Date('2026-01-01T00:00:00Z') });
    const later = buildManifest({ registry, personas: loadPersonas(), config, now: new Date('2026-01-02T00:00:00Z') });
    expect(later.serial).toBeGreaterThan(earlier.serial);
    expect(earlier.protocol).toBe(1);
    expect(earlier.compatibility).toEqual({ minProtocol: 1, minClientVersions: {}, message: '', url: '' });
    expect(earlier.defaultPersona).toBe('socrates');
    expect(earlier.agents.some(a => a.id === 'claude')).toBe(true);
    // Minimal: the manifest sets nothing in the agents' own settings and hides none of their choices
    // (bypass-permission modes included); each starts as the user configured it.
    expect(earlier.configOptions.defaults ?? {}).toEqual({});
    expect(earlier.configOptions.hide ?? {}).toEqual({});
    expect(earlier.agents.filter(a => a.enabled).map(a => a.id).sort())
      .toEqual(['amp-acp', 'antigravity-acp', 'auggie', 'claude', 'cline', 'codex-acp', 'cursor', 'devin',
                'factory-droid', 'gemini', 'github-copilot-cli', 'glm-acp-agent', 'goose', 'junie', 'kilo', 'kimi',
                'minimax-code', 'mistral-vibe', 'opencode', 'qwen-code']);
  });

  test('the protocol is versioned and every supported protocol has a builder', () => {
    expect(BUILDERS[PROTOCOL]).toBeDefined();
    const registry = loadRegistrySnapshot();
    const manifest = buildManifest({ registry, personas: [], config: loadClientConfig() });
    // The envelope every client reads, whatever protocol the body is in.
    for (const key of ['protocol', 'serial', 'issuedAt', 'compatibility']) expect(manifest).toHaveProperty(key);
  });

  test('requests are answered in the protocol the client speaks', () => {
    expect(protocolFor(undefined, 1, [1])).toBe(1);        // first clients send none
    expect(protocolFor('1', 1, [1, 2])).toBe(1);
    expect(protocolFor('2', 1, [1, 2])).toBe(2);
    expect(protocolFor('9', 1, [1, 2])).toBe(2);           // a client newer than the server
    expect(protocolFor('1', 2, [1, 2])).toBe(2);           // cut off: the newest envelope says so
    expect(protocolFor('junk', 1, [1])).toBe(1);
  });

  test('clients can be cut off by protocol or by version', () => {
    expect(buildCompatibility({ minProtocol: 2, minClientVersions: { app: '4.3' }, message: 'Update', url: 'https://x' }))
      .toEqual({ minProtocol: 2, minClientVersions: { app: '4.3' }, message: 'Update', url: 'https://x' });
    expect(() => buildCompatibility({ minClientVersions: { app: 'latest' } })).toThrow();
    expect(buildCompatibility({ minProtocol: 0 }).minProtocol).toBe(1);
  });
});
