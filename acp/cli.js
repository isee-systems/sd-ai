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
  loadClientConfig, loadEngineBriefs, loadToolDefinitions, resolveInstalls,
} from './buildManifest.js';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const registry = flag('--offline') ? loadRegistrySnapshot() : await fetchRegistry();

if (flag('--snapshot')) {
  writeFileSync(join(REPO_ROOT, 'acp', 'registry-snapshot.json'), JSON.stringify(registry, null, 2) + '\n');
  console.log(`acp/registry-snapshot.json: ${registry.length} registry entries`);
}

// Live, the newest of everything that moves on (runtimes, companion packages, archives' checksums);
// offline, as configured.
const config = flag('--offline') ? loadClientConfig()
  : await resolveInstalls(registry, loadClientConfig(), { log: message => console.log(message), hashDeadlineMs: 30 * 60 * 1000 });
const manifest = buildManifest({
  registry, personas: loadPersonas(), config,
  engineBriefs: await loadEngineBriefs(), toolDefinitions: await loadToolDefinitions(config.standInTools || {}),
});
const { skipped, notInstallable } = buildAgents(registry, config.agentOverrides, config.enabledAgents,
                                                { installable: config.installable, runtimes: config.runtimes });
if (notInstallable.length) console.warn(`listed as installable but not offered (no exact version or checksum): ${notInstallable.join(', ')}`);
const bytes = serializeManifest(manifest);
console.log(`${manifest.agents.length} agents, ${manifest.personas.length} personas, serial ${manifest.serial}` +
            (skipped.length ? `; skipped (not launchable as an installed program): ${skipped.join(', ')}` : ''));

const out = value('--out');
if (out) {
  writeFileSync(out, bytes);
  console.log(`wrote ${out}`);
}
