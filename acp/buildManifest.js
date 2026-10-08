/**
 * Builds the ACP manifest -- the data that tells a client application which ACP assistants it can offer
 * (Claude Code, Codex, Gemini CLI, ...), how to launch each one, and which sd-ai agents (Socrates,
 * Merlin, Themis, Athena) it can load as personas.
 *
 * Sources, all inside this repo or public:
 *   - agent/config/*.md      -> personas (this repo's own agent prompts, so they never drift)
 *   - the ACP Registry       -> agents (github.com/agentclientprotocol/registry), fetched live,
 *                               with acp/registry-snapshot.json as the offline fallback
 *   - acp/client.config.json -> everything else (overrides, defaults, tooltips, permissions)
 *
 * The client never downloads or runs a package manager: an npx entry becomes the executable that
 * package installs, a binary entry its executable name, a uvx entry the package name. The client
 * offers an entry only when that executable is installed on the user's machine.
 *
 * Pure apart from fetchRegistry/loadPersonas; signing is in signManifest.js.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '..');
/**
 * The manifest protocol (see README.md, "Protocol"). Bump only for a change a client that speaks the
 * previous protocol would misread; additions within a protocol need no bump, because clients ignore
 * what they do not know. When it is bumped, keep building the old protocol (BUILDERS) for as long as
 * those clients are supported, and raise compatibility.minProtocol when they are not.
 */
export const PROTOCOL = 1;

const REGISTRY_INDEX = 'https://api.github.com/repos/agentclientprotocol/registry/contents/';
const REGISTRY_RAW = 'https://raw.githubusercontent.com/agentclientprotocol/registry/main/';
const NPM_REGISTRY = 'https://registry.npmjs.org/';

// The launch rules clients apply: a bare executable name, and arguments a shell could not misread.
// An entry that breaks them would be dropped by the client anyway; dropping it here keeps the manifest
// honest about what clients will offer.
const BARE_COMMAND = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const UNSAFE_ARG = /[\x00-\x1f;&|<>`$"'^%!()\\*?[\]{}~]/;

export function validCommand(command) {
  return typeof command === 'string' && BARE_COMMAND.test(command);
}

export function validArgs(args) {
  return Array.isArray(args) && args.every(a => typeof a === 'string' && a.length > 0 && a.length <= 256 && !UNSAFE_ARG.test(a));
}

// "Agent" means sd-ai's agents (Socrates, Merlin, ...); the assistant is named for itself.
export function displayName(name) {
  return name.replace(/\s+(Agent|ACP|CLI Agent)$/, '').trim() || name;
}

// "@scope/name@1.2.3" -> "@scope/name"; "name==1.0" -> "name"
export function stripVersion(pkg) {
  if (pkg.startsWith('@')) {
    const [scope, rest] = pkg.slice(1).split('/');
    return '@' + scope + '/' + rest.split('@')[0];
  }
  return pkg.split(/@|==|>=|<=|~=/)[0];
}

/** The executable a package's `bin` installs, or null when it installs none or several. */
export function binFromPackageJson(pkg, packageJson) {
  const bin = packageJson?.bin;
  if (typeof bin === 'string') return stripVersion(pkg).split('/').pop();
  if (bin && typeof bin === 'object') {
    const names = Object.keys(bin);
    if (names.length === 1) return names[0];
    const acp = names.filter(n => n.includes('acp'));
    if (acp.length === 1) return acp[0];
  }
  return null;
}

async function fetchJson(url, timeoutMs = 15000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'sd-ai-acp-manifest' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function npmBin(pkg) {
  const name = stripVersion(pkg);
  const version = pkg.slice(name.length).replace(/^@/, '') || 'latest';
  try {
    const meta = await fetchJson(NPM_REGISTRY + name.replace('/', '%2F') + '/' + version);
    return binFromPackageJson(pkg, meta);
  } catch {
    return null;
  }
}

/** Fetches every agent.json in the ACP Registry, with its npm executable resolved. */
export async function fetchRegistry() {
  const index = await fetchJson(REGISTRY_INDEX);
  const ids = index.filter(e => e.type === 'dir' && !e.name.startsWith('.')).map(e => e.name);
  const agents = (await Promise.all(ids.map(async id => {
    try {
      return await fetchJson(REGISTRY_RAW + id + '/agent.json');
    } catch {
      return null;
    }
  }))).filter(Boolean);
  // The npm executable is not in the registry; record it so the snapshot is self-sufficient.
  await Promise.all(agents.map(async agent => {
    if (agent.distribution?.npx) agent._npmBin = await npmBin(agent.distribution.npx.package);
  }));
  return agents.sort((a, b) => a.id.localeCompare(b.id));
}

export function loadRegistrySnapshot() {
  return JSON.parse(readFileSync(join(HERE, 'registry-snapshot.json'), 'utf8'));
}

// A binary target's executable as the client names it: no directory (registry cmds use / and \), and
// no Windows extension, which the client's search adds back (.exe, then a .cmd / .bat shim).
export function binaryCommand(cmd) {
  return (cmd || '').split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i, '');
}

// Client platform -> registry targets, the first one present used (the arm build on mac, x86 elsewhere).
const BINARY_TARGETS = {
  mac: ['darwin-aarch64', 'darwin-x86_64'],
  windows: ['windows-x86_64', 'windows-aarch64'],
  linux: ['linux-x86_64', 'linux-aarch64'],
};

/**
 * A binary entry's executable and arguments on each platform where they differ from the mac ones, e.g.
 * Antigravity's agy_acp_server.exe on Windows and its --uid= on linux. Clients use them as
 * "commandByPlatform" and "argsByPlatform".
 */
export function launchByPlatform(agent) {
  const binary = agent.distribution?.binary;
  const commandByPlatform = {};
  const argsByPlatform = {};
  if (!binary) return { commandByPlatform, argsByPlatform };
  const [command, args] = launchFor(agent);
  for (const [platform, targets] of Object.entries(BINARY_TARGETS)) {
    const target = targets.map(t => binary[t]).find(Boolean);
    if (!target) continue;
    const name = binaryCommand(target.cmd);
    if (name && name !== command && validCommand(name)) commandByPlatform[platform] = name;
    const platformArgs = target.args || [];
    if (JSON.stringify(platformArgs) !== JSON.stringify(args) && validArgs(platformArgs)) argsByPlatform[platform] = platformArgs;
  }
  return { commandByPlatform, argsByPlatform };
}

/** [command, args, how] for a registry entry; command is null when the client cannot launch it. */
export function launchFor(agent) {
  const dist = agent.distribution || {};
  if (dist.binary) {
    const target = dist.binary['darwin-aarch64'] || Object.values(dist.binary)[0] || {};
    return [binaryCommand(target.cmd), target.args || [], 'binary'];
  }
  if (dist.npx) return [agent._npmBin || null, dist.npx.args || [], 'npm:' + stripVersion(dist.npx.package)];
  if (dist.uvx) {
    const pkg = stripVersion(dist.uvx.package);
    return [pkg, dist.uvx.args || [], 'uv:' + pkg];
  }
  return [null, [], 'no distribution the client can use'];
}

/**
 * enabledAgents: the registry ids clients offer. The rest are still listed, switched off, so turning
 * one on is a config change here. Omitted, every launchable entry is on. An override's own "enabled"
 * wins over either.
 */
export function buildAgents(registry, overrides = {}, enabledAgents = undefined) {
  const agents = [];
  const skipped = [];
  for (const agent of registry) {
    const [command, args] = launchFor(agent);
    const { commandByPlatform, argsByPlatform } = launchByPlatform(agent);
    const entry = {
      id: agent.id,
      displayName: displayName(agent.name || agent.id),
      enabled: Array.isArray(enabledAgents) ? enabledAgents.includes(agent.id) : true,
      command,
      ...(Object.keys(commandByPlatform).length ? { commandByPlatform } : {}),
      args,
      ...(Object.keys(argsByPlatform).length ? { argsByPlatform } : {}),
      installUrl: agent.website || agent.repository || '',
      signInText: '',
      platforms: ['mac', 'windows', 'linux'],
      ...(overrides[agent.id] || {}),
    };
    if (!validCommand(entry.command) || !validArgs(entry.args)) {
      skipped.push(agent.id);
      continue;
    }
    agents.push(entry);
  }
  return { agents, skipped };
}

/** One sd-ai agent config (frontmatter + prompt) as a client persona. */
export function parsePersona(fileName, text) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!match) return null;
  const [, front, body] = match;
  const meta = {};
  const modes = [];
  let inModes = false;
  for (const line of front.split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && inModes) {
      modes.push(item[1].trim());
      continue;
    }
    inModes = false;
    const kv = /^([A-Za-z_]+):\s*"?(.*?)"?\s*$/.exec(line);
    if (kv) {
      meta[kv[1]] = kv[2];
      inModes = kv[1] === 'supported_modes' && kv[2] === '';
    }
  }
  const stem = basename(fileName, '.md');
  const persona = {
    id: stem.toLowerCase(),
    name: meta.name || stem,
    description: meta.description || '',
    mode: modes.length === 1 ? modes[0] : '',
    instructions: body.trim(),
  };
  if (meta.role) persona.role = meta.role;
  return persona;
}

export function loadPersonas(configDir = join(REPO_ROOT, 'agent', 'config')) {
  if (!existsSync(configDir)) return [];
  return readdirSync(configDir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => parsePersona(name, readFileSync(join(configDir, name), 'utf8')))
    .filter(Boolean);
}

/**
 * The briefs of the LLM engines behind sd-ai's tools, straight from the engines, so the client's
 * stand-ins do the job the way sd-ai's engines do. Over ACP the user's own assistant is the model:
 * The client hands it the brief with the model, loop dominance and behavior, and it does the work.
 */
export async function loadEngineBriefs() {
  const join = (...parts) => parts.filter(p => typeof p === 'string' && p.trim()).join('\n\n');
  const briefs = {};
  try {
    const { default: Seldon } = await import('../engines/seldon/SeldonBrain.js');
    briefs.mentor = join(Seldon.MENTOR_SYSTEM_PROMPT, Seldon.DEFAULT_FEEDBACK_PROMPT, Seldon.DEFAULT_BEHAVIOR_PROMPT);
    briefs.seldon = join(Seldon.DEFAULT_SYSTEM_PROMPT, Seldon.DEFAULT_FEEDBACK_PROMPT, Seldon.DEFAULT_BEHAVIOR_PROMPT);
  } catch { /* engine not present in this build: no brief */ }
  try {
    const { default: AcrossRuns } = await import('../engines/seldon-ile-user/SeldonILEUserBrain.js');
    briefs.acrossRuns = join(AcrossRuns.DEFAULT_SYSTEM_PROMPT, AcrossRuns.DEFAULT_FEEDBACK_PROMPT, AcrossRuns.DEFAULT_BEHAVIOR_PROMPT);
  } catch { /* ignore */ }
  try {
    const { default: Ltm } = await import('../engines/ltm-narrative/LTMNarrativeBrain.js');
    briefs.ltmNarrative = join(Ltm.DEFAULT_SYSTEM_PROMPT, Ltm.DEFAULT_FEEDBACK_PROMPT, Ltm.DEFAULT_BEHAVIOR_PROMPT);
  } catch { /* ignore */ }
  try {
    const { default: Quantitative } = await import('../engines/quantitative/QuantitativeEngineBrain.js');
    briefs.quantitative = join(Quantitative.DEFAULT_SYSTEM_PROMPT);
  } catch { /* ignore */ }
  try {
    const { default: Qualitative } = await import('../engines/qualitative/QualitativeEngineBrain.js');
    briefs.qualitative = join(Qualitative.DEFAULT_SYSTEM_PROMPT, Qualitative.DEFAULT_FEEDBACK_PROMPT);
  } catch { /* ignore */ }
  return briefs;
}

/**
 * The real definitions -- name, description, input schema -- of the sd-ai tools a client stands in
 * for over ACP, straight from this repo's tool code, each with its stand-in recipe from
 * client.config.json "standInTools" (howToRespond, brief, include, acceptsImage), so the
 * agent prompts see exactly the tools they were written for.
 */
export async function loadToolDefinitions(recipes) {
  const { z } = await import('zod');
  const builtin = await import('../agent/tools/builtin/index.js');
  const definitions = [];
  for (const [name, recipe] of Object.entries(recipes || {})) {
    const factory = builtin[factoryName(name)];
    let tool = null;
    try {
      tool = typeof factory === 'function' ? factory() : null;   // factories use their arguments only in handlers
    } catch {
      tool = null;
    }
    if (!tool?.description || !tool?.inputSchema) continue;
    try {
      const inputSchema = z.toJSONSchema(tool.inputSchema);
      delete inputSchema.$schema;
      // A tool whose result is a picture the assistant draws takes it back as imagePath.
      if (recipe.acceptsImage) {
        inputSchema.properties = {
          ...inputSchema.properties,
          imagePath: { type: 'string', description: 'The SVG or PNG you drew. Omit it on the first call to be told how to draw it.' },
        };
      }
      // standIn: how a client serves this tool without sd-ai's server -- see client.config.json.
      definitions.push({ name, description: tool.description, inputSchema, standIn: recipe });
    } catch { /* a schema zod cannot express as JSON Schema: leave the tool out */ }
  }
  return definitions;
}

// discuss_model_with_seldon -> createDiscussModelWithSeldonTool, as the builtin index names them.
function factoryName(toolName) {
  const special = { create_visualization: 'createVisualizationTool' };
  if (special[toolName]) return special[toolName];
  return 'create' + toolName.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join('') + 'Tool';
}

export function loadClientConfig() {
  return JSON.parse(readFileSync(join(HERE, 'client.config.json'), 'utf8'));
}

/**
 * The manifest object. serial must only ever grow (the client rejects an older one, so an old manifest
 * cannot be replayed to re-enable a switched-off agent); the build time in seconds does that.
 */
export function buildManifest({ registry, personas, config, engineBriefs = {}, toolDefinitions = [], now = new Date() }) {
  const { agents } = buildAgents(registry, config.agentOverrides, config.enabledAgents);
  return {
    // The envelope: the same in every protocol, forever, so any client can read it.
    protocol: 1,
    serial: Math.floor(now.getTime() / 1000),
    issuedAt: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    compatibility: buildCompatibility(config.compatibility),
    // The body (protocol 1).
    agents,
    personas,
    defaultPersona: config.defaultPersona || 'socrates',
    instructions: config.instructions || '',
    // For the client's stand-ins for sd-ai's tools: their definitions, and the engine briefs they hand
    // the user's assistant.
    standInTools: toolDefinitions,
    engineBriefs,
    tools: config.tools || {},
    permissions: config.permissions || { default: 'ask', autoAllow: [] },
    configOptions: config.configOptions || {},
    flags: config.flags || {},
  };
}

/**
 * How the server cuts clients off: a client speaking a protocol below minProtocol, or a build of a
 * client older than minClientVersions[client id], offers none of the user's assistants and shows
 * message (and url). Clients read this whatever protocol the body is in.
 */
export function buildCompatibility(compatibility = {}) {
  const minProtocol = Number.isInteger(compatibility.minProtocol) && compatibility.minProtocol > 0 ? compatibility.minProtocol : 1;
  const minClientVersions = {};
  for (const [client, version] of Object.entries(compatibility.minClientVersions || {})) {
    if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version))
      throw new Error(`compatibility.minClientVersions.${client}: "${version}" is not a dotted version number`);
    minClientVersions[client] = version;
  }
  return { minProtocol, minClientVersions, message: compatibility.message || '', url: compatibility.url || '' };
}

/** A builder per protocol this server still serves. */
export const BUILDERS = { 1: buildManifest };

/**
 * The protocol to answer a request in. A client that does not say speaks protocol 1 (the first
 * clients). One the server has cut off gets the newest manifest: its envelope tells the client so.
 * Otherwise the newest protocol the server builds that the client speaks.
 */
export function protocolFor(requested, minProtocol = 1, built = Object.keys(BUILDERS).map(Number)) {
  const newest = Math.max(...built);
  const asked = /^\d+$/.test(String(requested ?? '')) ? Number(requested) : 1;
  if (asked < minProtocol) return newest;
  const spoken = built.filter(p => p <= asked);
  return spoken.length ? Math.max(...spoken) : newest;
}

/** The exact bytes that are served. */
export function serializeManifest(manifest) {
  return Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
