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
 * An npx entry becomes the executable that package installs, a binary entry its executable name, a
 * uvx entry the package name, and the client offers the entry when that executable is installed on
 * the user's machine. For the agents listed in client.config.json "installable" the entry also says
 * how the client can install it itself ("install", see installFor): generic download and run steps,
 * exact versions and checksums only, into a folder of the client's own.
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

// What an install step may name: one exact npm version (a range or a tag would install something
// nobody looked at), an https download with its sha256, and environment variables in the launch
// rules' character set.
const PINNED_NPM = /^(@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,127}@\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const SAFE_RELATIVE_DIR = /^([A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*)?$/;

export function validPinnedPackage(spec) {
  return typeof spec === 'string' && PINNED_NPM.test(spec);
}

// A template in an install step, as clients check it: placeholders ({agent}, {temp},
// {runtime:<name>}) and between them only the launch rules' safe characters.
const TEMPLATE_PLACEHOLDER = /\{(agent|temp|runtime:[a-z0-9_-]{1,32})\}/g;
const TEMPLATE_TEXT = /^[A-Za-z0-9._=:/@+, -]*$/;
const INSIDE_INSTALL = /^\{(agent|runtime:[a-z0-9_-]{1,32})\}(\/|$)/;

export function validTemplate(text) {
  return typeof text === 'string' && text.length <= 1024 && TEMPLATE_TEXT.test(text.replace(TEMPLATE_PLACEHOLDER, ''));
}

function insideInstall(path) {
  return validTemplate(path) && INSIDE_INSTALL.test(path) && !path.split('/').includes('..');
}

/**
 * Checks an install as clients will, so a manifest never says something they would refuse: a
 * mistake in this repo, so the build fails. Each platform's byPlatform override is checked too.
 */
export function checkInstall(install, where) {
  for (const step of install.steps) {
    for (const variant of [step, ...Object.values(step.byPlatform || {}).map(o => ({ ...step, ...o }))]) {
      const bad = why => { throw new Error(`${where}: ${step.label || step.kind}: ${why}`); };
      if (!variant.label) bad('no label');
      if (variant.kind === 'download') {
        for (const a of Object.values(variant.archives || {}))
          if (!a.url?.startsWith('https://') || !SHA256.test(a.sha256 || '') || ('bin' in a && (!SAFE_RELATIVE_DIR.test(a.bin) || a.bin.split('/').includes('..'))))
            bad('archive is not https with its sha256 and a plain bin');
      } else if (variant.kind === 'run') {
        if (!insideInstall(variant.program)) bad('program is not inside the install');
        if (!(variant.args || []).every(validTemplate)) bad('an argument a client would refuse');
        if (!(variant.path || []).every(insideInstall)) bad('a path folder outside the install');
        for (const [name, value] of Object.entries(variant.env || {}))
          if (!ENV_NAME.test(name) || !validTemplate(value)) bad('an env entry a client would refuse');
      } else {
        bad(`unknown kind "${variant.kind}"`);
      }
    }
  }
  return install;
}

/**
 * Downloads a runtime the client installs for agents that need one (node for npm packages), from
 * client.config.json "runtimes", into a folder of its own that every agent on it shares. archives:
 * per registry target (darwin-aarch64, windows-x86_64, ...) the https url, its sha256, and bin, the
 * folder of the runtime's programs once the archive's single top-level folder is removed ("" for the
 * top). A bad entry is a mistake in this repo: the build fails.
 */
export function runtimeStep(name, runtime) {
  if (!runtime || typeof runtime.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(runtime.version))
    throw new Error(`runtimes.${name}: needs an exact "version"`);
  const archives = {};
  for (const [target, archive] of Object.entries(runtime.archives || {})) {
    if (!Object.values(BINARY_TARGETS).flat().includes(target))
      throw new Error(`runtimes.${name}.archives: unknown target "${target}"`);
    if (typeof archive.url !== 'string' || !archive.url.startsWith('https://') || !SHA256.test(archive.sha256 || '')
        || !SAFE_RELATIVE_DIR.test(archive.bin ?? '') || (archive.bin ?? '').split('/').includes('..'))
      throw new Error(`runtimes.${name}.archives.${target}: needs an https url, its sha256 and a plain relative bin`);
    archives[target] = { url: archive.url, sha256: archive.sha256, bin: archive.bin ?? '' };
  }
  if (!Object.keys(archives).length) throw new Error(`runtimes.${name}: no archives`);
  const host = new URL(Object.values(archives)[0].url).host;
  return {
    kind: 'download', label: `${runtime.displayName || name} ${runtime.version} (from ${host})`,
    into: 'runtime', name, version: runtime.version, strip: true, archives,
  };
}

/**
 * Installs exact npm package versions into the agent's folder, by the node runtime's own npm, from
 * the public registry, with none of the user's npm configuration (only their proxy reaches it).
 */
export function npmStep(packages) {
  const args = npmCli => [npmCli, 'install', '--prefix', '{agent}', '--omit=dev', '--no-audit', '--no-fund',
    '--no-update-notifier', '--loglevel=error', '--registry=https://registry.npmjs.org/',
    '--userconfig={temp}/npmrc-user', '--globalconfig={temp}/npmrc-global', '--cache={temp}/npm-cache', ...packages];
  return {
    kind: 'run',
    label: packages.map(p => { const at = p.lastIndexOf('@'); return `${p.slice(0, at)} ${p.slice(at + 1)}`; }).join(', ') + ' (from npmjs.com)',
    program: '{runtime:node}/bin/node',
    args: args('{runtime:node}/lib/node_modules/npm/bin/npm-cli.js'),
    clearEnv: ['npm_config_*', 'NODE_OPTIONS', 'NODE_PATH'],
    path: ['{agent}/node_modules/.bin'],
    byPlatform: { windows: { program: '{runtime:node}/node.exe', args: args('{runtime:node}/node_modules/npm/bin/npm-cli.js') } },
  };
}

/**
 * How a client installs an agent itself, or undefined when it does not (the agent is not in
 * "installable", or nothing exact to install: no pinned version, no checksum).
 *
 * Clients run two generic kinds of step, so how an agent is installed is decided here, never in a
 * client (see README.md, "Installing an assistant for the user"):
 *
 *   { kind: 'download', label, archives, into: 'agent' | 'runtime', name, version, strip }
 *   { kind: 'run', label, program, args, env, clearEnv, path, timeoutMinutes, byPlatform }
 *
 * An npx agent is node (runtimeStep) and then npm (npmStep); a binary agent its own archive
 * (archiveStep). A uvx agent would be uv's archive and then `uv tool install` into {agent}, with no
 * client change; it is not generated yet. env: variables set when the agent is launched from the
 * install (Claude Code's own updater off: the client owns that version).
 */
export function installFor(agent, installable = {}, runtimes = {}) {
  const options = installable[agent.id];
  if (!options) return undefined;
  let install;
  if (agent.distribution?.npx) {
    const packages = [agent.distribution.npx.package, ...(options.extraPackages || [])];
    if (!packages.every(validPinnedPackage)) return undefined;
    install = { steps: [runtimeStep('node', runtimes.node), npmStep(packages)] };
  } else if (agent.distribution?.binary) {
    const step = archiveStep(agent, options.sha256);
    if (!step) return undefined;
    install = { steps: [step] };
  } else {
    return undefined;
  }
  const env = options.env || {};
  for (const [name, value] of Object.entries(env)) {
    if (!ENV_NAME.test(name) || !validArgs([value]))
      throw new Error(`installable.${agent.id}.env.${name}: not NAME -> plain value`);
  }
  if (Object.keys(env).length) install.env = env;
  return checkInstall(install, `installable.${agent.id}`);
}

/**
 * A binary agent's own archive, downloaded into its folder and unpacked as the registry lays it out
 * (its cmd is relative to the archive's root, so nothing is stripped): per registry target its https
 * url, its sha256 -- the registry's, or for an entry that gives none, the one pinned for that exact
 * url in client.config.json (installable.<id>.sha256: { url: sha256 }) -- and bin, the folder its
 * program is in. A target with no checksum is left out, so a new release the registry points at is
 * not offered until its archives are pinned. Null when no target is left.
 */
export function archiveStep(agent, pinned = {}) {
  const archives = {};
  for (const [target, binary] of Object.entries(agent.distribution?.binary || {})) {
    if (!Object.values(BINARY_TARGETS).flat().includes(target)) continue;
    const url = binary.archive;
    const sha256 = binary.sha256 || pinned[url];
    const parts = (binary.cmd || '').replace(/\\/g, '/').split('/').filter(p => p && p !== '.');
    const bin = parts.slice(0, -1).join('/');
    if (typeof url !== 'string' || !url.startsWith('https://') || !SHA256.test(sha256 || '')) continue;
    if (!parts.length || !SAFE_RELATIVE_DIR.test(bin) || parts.includes('..')) continue;
    archives[target] = { url, sha256, bin };
  }
  if (!Object.keys(archives).length) return null;
  const version = agent.version ? ` ${agent.version}` : '';
  const host = new URL(Object.values(archives)[0].url).host;
  return { kind: 'download', label: `${agent.name || agent.id}${version} (from ${host})`, into: 'agent', archives };
}

/**
 * enabledAgents: the registry ids clients offer. The rest are still listed, switched off, so turning
 * one on is a config change here. Omitted, every launchable entry is on. An override's own "enabled"
 * wins over either.
 */
export function buildAgents(registry, overrides = {}, enabledAgents = undefined, { installable = {}, runtimes = {} } = {}) {
  const agents = [];
  const skipped = [];
  for (const agent of registry) {
    const [command, args] = launchFor(agent);
    const { commandByPlatform, argsByPlatform } = launchByPlatform(agent);
    const install = installFor(agent, installable, runtimes);
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
      ...(install ? { install } : {}),
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
      // supportedModes: the model types the tool works on, so a client can withhold an sfd-only
      // tool from a causal loop diagram the way sd-ai does. Absent means every mode.
      const definition = { name, description: tool.description, inputSchema, standIn: recipe };
      if (tool.supportedModes) definition.supportedModes = tool.supportedModes;
      definitions.push(definition);
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
  const { agents } = buildAgents(registry, config.agentOverrides, config.enabledAgents,
                                 { installable: config.installable, runtimes: config.runtimes });
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
