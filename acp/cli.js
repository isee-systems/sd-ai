#!/usr/bin/env node
/**
 * npm run acp:manifest -- [--out <file>] [--offline] [--snapshot]
 *
 *   --out <file>  write the manifest there. A client's bundled fallback copy can be made this way.
 *   --offline     use acp/registry-snapshot.json instead of the live ACP Registry
 *   --snapshot    refresh acp/registry-snapshot.json from the live registry (commit the result)
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  REPO_ROOT, buildManifest, buildAgents, serializeManifest, fetchRegistry, loadRegistrySnapshot, loadPersonas,
  loadClientConfig, loadEngineBriefs, loadToolDefinitions,
} from './buildManifest.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const registry = flag('--offline') ? loadRegistrySnapshot() : await fetchRegistry();

if (flag('--snapshot')) {
  writeFileSync(join(REPO_ROOT, 'acp', 'registry-snapshot.json'), JSON.stringify(registry, null, 2) + '\n');
  console.log(`acp/registry-snapshot.json: ${registry.length} registry entries`);
}

const config = loadClientConfig();
const manifest = buildManifest({
  registry, personas: loadPersonas(), config,
  engineBriefs: await loadEngineBriefs(), toolDefinitions: await loadToolDefinitions(config.standInTools || {}),
});
const { skipped } = buildAgents(registry, config.agentOverrides, config.enabledAgents);
const bytes = serializeManifest(manifest);
console.log(`${manifest.agents.length} agents, ${manifest.personas.length} personas, serial ${manifest.serial}` +
            (skipped.length ? `; skipped (not launchable as an installed program): ${skipped.join(', ')}` : ''));

const out = value('--out');
if (out) {
  writeFileSync(out, bytes);
  console.log(`wrote ${out}`);
}
