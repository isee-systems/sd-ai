/**
 * Holds the ACP manifest this deployment serves. Built once when the server starts -- so every
 * deploy rebuilds it from the code it ships with -- and refreshed periodically so ACP Registry
 * changes reach the client without a deploy. Not signed: clients rely on HTTPS to this server.
 */

import logger from '../utilities/logger.js';
import {
  BUILDERS, protocolFor, serializeManifest, fetchRegistry, loadRegistrySnapshot, loadPersonas, loadClientConfig,
  loadEngineBriefs, loadToolDefinitions, hashMissingArchives,
} from './buildManifest.js';

const REFRESH_MS = 6 * 60 * 60 * 1000;

let current = null;   // { [protocol]: { bytes, serial, protocol }, minProtocol }
let building = null;
let hashing = false;

export async function rebuild({ live = true, registry = null } = {}) {
  if (!registry) {
    try {
      registry = live ? await fetchRegistry() : loadRegistrySnapshot();
    } catch (error) {
      logger.warn(`[acp] ACP Registry unavailable (${error.message}); using acp/registry-snapshot.json`);
      registry = loadRegistrySnapshot();
    }
  }

  const config = loadClientConfig();
  const inputs = {
    registry, personas: loadPersonas(), config,
    engineBriefs: await loadEngineBriefs(), toolDefinitions: await loadToolDefinitions(config.standInTools || {}),
  };
  // Every protocol this server still serves, from the same inputs and with the same serial.
  const now = new Date();
  const built = { minProtocol: 1 };
  for (const [protocol, build] of Object.entries(BUILDERS)) {
    const manifest = build({ ...inputs, now });
    const bytes = serializeManifest(manifest);
    built[protocol] = { bytes, serial: manifest.serial, protocol: Number(protocol) };
    built.minProtocol = manifest.compatibility.minProtocol;
    logger.info(`[acp] manifest protocol ${protocol} ready: ${manifest.agents.length} agents, ${manifest.personas.length} personas, serial ${manifest.serial}`);
  }
  current = built;
  hashInBackground(registry, config.installable);
  return current;
}

/**
 * A binary agent whose registry archives carry no checksum (Antigravity) is installable only once
 * this server has hashed them: done here, after the manifest is already served, and the manifest
 * built again when it learns any -- so a vendor's new release is offered within minutes, with
 * nobody pinning hashes by hand.
 */
function hashInBackground(registry, installable) {
  if (hashing) return;
  hashing = true;
  hashMissingArchives(registry, installable, { log: message => logger.info(`[acp] ${message}`) })
    .then(learned => (learned ? rebuild({ registry }) : null))
    .catch(error => logger.error(`[acp] hashing archives failed: ${error.message}`))
    .finally(() => { hashing = false; });
}

/** Builds in the background; the route answers 503 until the first build is done. */
export function start() {
  building = rebuild().catch(error => logger.error(`[acp] manifest build failed: ${error.message}`));
  const timer = setInterval(() => {
    rebuild().catch(error => logger.error(`[acp] manifest refresh failed: ${error.message}`));
  }, REFRESH_MS);
  timer.unref();
  return building;
}

/** The manifest to answer a client that speaks requestedProtocol (see protocolFor). */
export function currentManifest(requestedProtocol) {
  if (!current) return null;
  return current[protocolFor(requestedProtocol, current.minProtocol, Object.keys(BUILDERS).map(Number))];
}
