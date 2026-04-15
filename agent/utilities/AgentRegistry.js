import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import logger from '../../utilities/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * AgentRegistry
 * Scans the agent/config directory and provides a list of available agents
 */

/**
 * Get all available agents by scanning the config directory
 * @returns {Array} Array of agent definitions
 */
export function getAvailableAgents() {
  const configDir = join(__dirname, '../config');
  const agents = [];

  try {
    const files = readdirSync(configDir);

    for (const file of files) {
      // Skip non-YAML files
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) {
        continue;
      }

      try {
        const filePath = join(configDir, file);
        const content = readFileSync(filePath, 'utf8');
        const config = yaml.load(content);

        // Extract agent metadata
        if (config.agent) {
          const agentId = file.replace(/\.(yaml|yml)$/, '');
          agents.push({
            id: agentId,
            name: config.agent.name,
            description: config.agent.description,
            version: config.agent.version || '1.0',
            configFile: file
          });
        }
      } catch (error) {
        logger.warn(`Failed to load agent config from ${file}:`, error.message);
      }
    }

    logger.log(`Found ${agents.length} agent(s)`);
    return agents;
  } catch (error) {
    logger.error('Failed to scan agent config directory:', error);
    return [];
  }
}

/**
 * Get agent config by ID
 * @param {string} agentId - The agent ID (filename without extension)
 * @returns {object|null} Agent configuration or null if not found
 */
export function getAgentConfig(agentId) {
  const configDir = join(__dirname, '../config');
  const configFile = `${agentId}.yaml`;
  const filePath = join(configDir, configFile);

  try {
    const content = readFileSync(filePath, 'utf8');
    const config = yaml.load(content);
    return config;
  } catch (error) {
    logger.error(`Failed to load agent config for ${agentId}:`, error);
    return null;
  }
}

/**
 * Get default agent ID
 * @returns {string} The default agent ID
 */
export function getDefaultAgentId() {
  // Try to use ganos-lal as default, fall back to first available
  const agents = getAvailableAgents();
  const ganosLal = agents.find(a => a.id === 'ganos-lal');
  if (ganosLal) {
    return 'ganos-lal';
  }
  return agents.length > 0 ? agents[0].id : null;
}
