/**
 * Build-time data generator for the SD-AI documentation site.
 *
 * The site is a static, backend-free documentation site. Rather than fetch
 * engine / eval / agent / leaderboard data from a live sd-ai server at runtime,
 * this script discovers everything directly from the repository and calls the
 * same methods the backend routes use, emitting plain JSON into src/generated/
 * that the React app imports statically.
 *
 * Mirrors:
 *   - routes/v1/engines.js + routes/v1/engineParameters.js  -> engines.json
 *   - routes/v1/evalsList.js + routes/v1/evalsTestDetails.js -> evals.json
 *   - agent/WebSocket.js getAvailableAgents()                -> agents.json
 *   - routes/v1/leaderboard.js (+ Leaderboard page aggregation) -> leaderboards.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// frontend/scripts -> frontend -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'generated');

// GitHub "view source" base, matching the backend routes.
const GH_BASE = 'https://github.com/UB-IAD/sd-ai/tree/main';

// Run from the repo root so engine/eval modules resolve relative paths and
// node_modules exactly like the server does.
process.chdir(REPO_ROOT);

const importRepoModule = (relPath) =>
  import(pathToFileURL(path.join(REPO_ROOT, relPath)).href);

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function writeJson(name, data) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data));
  const bytes = fs.statSync(file).size;
  console.log(`  wrote ${name} (${(bytes / 1024).toFixed(1)} KB)`);
}

/* ------------------------------------------------------------------ engines */

// Same two parameters routes/v1/engineParameters.js prepends to every engine.
const BASE_PARAMETERS = [
  {
    name: 'prompt',
    type: 'string',
    required: true,
    uiElement: 'textarea',
    label: 'Prompt',
    description: 'Description of desired model or changes to model.',
  },
  {
    name: 'currentModel',
    type: 'json',
    required: false,
    defaultValue: '{"variables": [], "relationships": []}',
    uiElement: 'hidden',
    description:
      'javascript object in sd-json format representing current model to anchor changes off of',
  },
];

const RECOMMENDED_DEFAULTS = {
  sfd: 'quantitative',
  cld: 'qualitative',
  'sfd-discuss': 'seldon',
  'cld-discuss': 'seldon',
  'ltm-discuss': 'ltm-narrative',
  documentation: 'generate-documentation',
};

async function generateEngines() {
  const enginesDir = path.join(REPO_ROOT, 'engines');
  const dirs = fs
    .readdirSync(enginesDir)
    .filter((f) => fs.lstatSync(path.join(enginesDir, f)).isDirectory());

  const engines = [];
  for (const dir of dirs) {
    const enginePath = path.join(enginesDir, dir, 'engine.js');
    const base = {
      name: dir,
      isTest: dir.startsWith('test-'),
      source: `${GH_BASE}/engines/${dir}`,
    };

    if (!fs.existsSync(enginePath)) continue;

    let mod;
    try {
      mod = await importRepoModule(`engines/${dir}/engine.js`);
    } catch (e) {
      // Document the engine even if it can't be imported in this environment
      // (e.g. missing native/optional dependencies).
      console.warn(`  ! engine "${dir}" failed to import: ${e.message}`);
      engines.push({
        ...base,
        supports: [],
        available: false,
        description: null,
        link: null,
        parameters: null,
        importError: e.message,
      });
      continue;
    }

    const EngineClass = mod.default;

    let supports = [];
    try {
      supports = EngineClass.supportedModes() || [];
    } catch {
      supports = [];
    }

    let description = null;
    try {
      description = EngineClass.description ? EngineClass.description() : null;
    } catch {
      description = null;
    }

    let link = null;
    try {
      link = EngineClass.link ? EngineClass.link() : null;
    } catch {
      link = null;
    }

    // Full parameter schema, exactly as routes/v1/engineParameters.js returns
    // it (base parameters + engine additionalParameters()). No fields dropped.
    let parameters = null;
    let paramsError = null;
    try {
      const instance = new EngineClass();
      parameters = [...BASE_PARAMETERS, ...instance.additionalParameters()];
    } catch (e) {
      paramsError = e.message;
    }

    engines.push({
      ...base,
      supports,
      available: supports.length > 0,
      description,
      link: link || null,
      parameters,
      ...(paramsError ? { paramsError } : {}),
    });
  }

  // Sort alphabetically, then force qualitative to the top (matches the route's
  // backward-compat behavior). No special treatment for experimental/mentor.
  engines.sort((a, b) => a.name.localeCompare(b.name));
  const qi = engines.findIndex((e) => e.name === 'qualitative');
  if (qi >= 0) engines.unshift(engines.splice(qi, 1)[0]);

  return { engines, recommendedDefaults: RECOMMENDED_DEFAULTS };
}

/* -------------------------------------------------------------------- evals */

async function generateEvals() {
  const catDir = path.join(REPO_ROOT, 'evals', 'categories');
  const names = fs
    .readdirSync(catDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace('.js', ''));

  const categories = [];
  for (const name of names) {
    let mod;
    try {
      mod = await importRepoModule(`evals/categories/${name}.js`);
    } catch (e) {
      console.warn(`  ! eval category "${name}" failed to import: ${e.message}`);
      continue;
    }

    const groups = Object.keys(mod.groups).map((groupName) => ({
      name: groupName,
      // Full test objects (name, prompt, expectations, additionalParameters, ...)
      // so the eval detail page works entirely offline.
      tests: mod.groups[groupName],
    }));

    let firstTestUrl = null;
    const firstGroup = Object.keys(mod.groups)[0];
    if (firstGroup && mod.groups[firstGroup].length > 0) {
      const firstTest = mod.groups[firstGroup][0].name;
      firstTestUrl = `/evals/${encodeURIComponent(name)}/${encodeURIComponent(
        firstGroup
      )}/${encodeURIComponent(firstTest)}`;
    }

    let description = '';
    try {
      description = mod.description ? mod.description() : '';
    } catch {
      description = '';
    }

    let link = null;
    try {
      link = mod.link ? mod.link() : null;
    } catch {
      link = null;
    }

    categories.push({
      name,
      groups,
      description,
      link,
      source: `${GH_BASE}/evals/categories/${name}.js`,
      firstTestUrl,
    });
  }

  return { categories };
}

/* ------------------------------------------------------------------- agents */

function agentSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Label a phase for multi-file agents (e.g. athena_CLD -> "CLD").
function phaseLabel(fileId, modes) {
  const suffix = fileId.includes('_') ? fileId.split('_').pop() : null;
  if (suffix && /^[A-Za-z]+$/.test(suffix)) return suffix.toUpperCase();
  if (modes && modes.length) return modes.join('/').toUpperCase();
  return fileId;
}

async function generateAgents() {
  const { AgentConfigurationManager } = await importRepoModule(
    'agent/utilities/AgentConfigurationManager.js'
  );

  // Only document agents that are checked into the repo (git-tracked). This
  // naturally excludes untracked/experimental configs and keeps local dev
  // consistent with the CI build.
  const tracked = execSync('git ls-files agent/config', { cwd: REPO_ROOT })
    .toString()
    .trim()
    .split('\n')
    .filter((f) => f.endsWith('.md'));

  // Group files that share a display name into a single agent (e.g. the two
  // Athena phase files collapse into one "Athena" entry).
  const byName = new Map();

  for (const rel of tracked) {
    const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    const { metadata, content: body } = AgentConfigurationManager.parseContent(content);
    if (!metadata.name) continue;

    const fileId = path.basename(rel, '.md');
    const modes = metadata.supported_modes || [];
    const phase = {
      id: fileId,
      label: phaseLabel(fileId, modes),
      supported_modes: modes,
      description: metadata.description || '',
      systemPrompt: body.trim(),
      source: `${GH_BASE}/${rel}`,
    };

    if (!byName.has(metadata.name)) {
      byName.set(metadata.name, {
        name: metadata.name,
        role: metadata.role || null,
        version: metadata.version || null,
        agent_mode: metadata.agent_mode || null,
        max_iterations: metadata.max_iterations || 20,
        _modes: new Set(),
        phases: [],
      });
    }
    const entry = byName.get(metadata.name);
    modes.forEach((m) => entry._modes.add(m));
    entry.phases.push(phase);
  }

  const agents = [...byName.values()]
    .map((a) => ({
      id: agentSlug(a.name),
      name: a.name,
      role: a.role,
      version: a.version,
      agent_mode: a.agent_mode,
      max_iterations: a.max_iterations,
      supported_modes: [...a._modes],
      description: a.phases[0]?.description || '',
      phases: a.phases,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { agents };
}

/* -------------------------------------------------------------- leaderboards */

// Port of the Leaderboard page's processLeaderboardData: reduce the (huge)
// full-results files to the small per-engine aggregate the UI actually renders.
function processLeaderboard(data) {
  const engineStats = {};
  const categories = new Set();
  const categoryFirstTests = {};

  for (const test of data.results) {
    const engineConfigName = test.engineConfigName;
    const engineName = test.engineConfig.engine;
    const llmModel = test.engineConfig.additionalParameters?.underlyingModel || 'N/A';

    if (!categoryFirstTests[test.category]) {
      categoryFirstTests[test.category] = {
        category: test.category,
        group: test.group,
        testName: test.testParams.name,
      };
    }

    if (!engineStats[engineConfigName]) {
      engineStats[engineConfigName] = { speeds: [], engineName, llmModel };
    }

    if (!(test.category in engineStats[engineConfigName])) {
      categories.add(test.category);
      engineStats[engineConfigName][test.category] = { passes: 0, count: 0 };
    }

    engineStats[engineConfigName][test.category].passes += test.pass ? 1 : 0;
    engineStats[engineConfigName][test.category].count += 1;
    engineStats[engineConfigName].speeds.push(test.duration);
  }

  const engines = Object.entries(engineStats).map(([configName, stats]) => {
    let totalPasses = 0;
    let totalCount = 0;
    const scores = Object.fromEntries(
      Object.keys(stats)
        .filter((e) => !['speeds', 'engineName', 'llmModel'].includes(e))
        .map((category) => {
          totalPasses += stats[category].passes;
          totalCount += stats[category].count;
          return [category, stats[category].passes / stats[category].count];
        })
    );

    const score = totalPasses / totalCount;
    const speed =
      stats.speeds.reduce((sum, a) => sum + a, 0) / stats.speeds.length / 1000;

    return { configName, engineName: stats.engineName, llmModel: stats.llmModel, speed, score, ...scores };
  });

  engines.sort((a, b) => b.score - a.score);

  return { engines, categories: Array.from(categories), categoryFirstTests };
}

function generateLeaderboards() {
  const modes = ['cld', 'sfd', 'discussion'];
  const out = {};
  for (const mode of modes) {
    const fp = path.join(REPO_ROOT, 'evals', 'results', `leaderboard_${mode}_full_results.json`);
    if (!fs.existsSync(fp)) {
      console.warn(`  ! no leaderboard results for "${mode}"`);
      out[mode] = null;
      continue;
    }
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    out[mode] = processLeaderboard(data);
  }
  return out;
}

/* --------------------------------------------------------------------- main */

async function main() {
  ensureOutDir();

  console.log('Generating engines.json ...');
  writeJson('engines.json', await generateEngines());

  console.log('Generating evals.json ...');
  writeJson('evals.json', await generateEvals());

  console.log('Generating agents.json ...');
  writeJson('agents.json', await generateAgents());

  console.log('Generating leaderboards.json ...');
  writeJson('leaderboards.json', generateLeaderboards());

  console.log('Done.');
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
