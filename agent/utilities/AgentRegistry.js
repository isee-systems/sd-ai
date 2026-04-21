import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../../utilities/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * AgentRegistry
 * Scans the agent/config directory and provides a list of available agents
 */

/**
 * Parse YAML frontmatter from MD file
 * @param {string} content - The file content
 * @returns {object} Parsed metadata
 */
function parseFrontmatter(content) {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return {};
  }

  const metadata = {};
  const lines = match[1].split('\n');
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for array item
    if (trimmed.startsWith('- ') && currentArray) {
      currentArray.push(trimmed.substring(2).trim());
    }
    // Check for key-value pair
    else if (trimmed.includes(':')) {
      const colonIndex = trimmed.indexOf(':');
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      if (value === '') {
        // This might be starting an array
        currentKey = key;
        currentArray = [];
        metadata[key] = currentArray;
      } else {
        // Simple value - remove quotes if present
        let parsedValue = value.replace(/^["']|["']$/g, '');
        // Try to parse as number
        if (!isNaN(parsedValue) && parsedValue !== '') {
          parsedValue = Number(parsedValue);
        }
        metadata[key] = parsedValue;
        currentKey = null;
        currentArray = null;
      }
    }
  }

  return metadata;
}

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
      // Skip non-MD files
      if (!file.endsWith('.md')) {
        continue;
      }

      try {
        const filePath = join(configDir, file);
        const content = readFileSync(filePath, 'utf8');
        const metadata = parseFrontmatter(content);

        // Extract agent metadata
        if (metadata.name) {
          const agentId = file.replace(/\.md$/, '');
          agents.push({
            id: agentId,
            name: metadata.name,
            description: metadata.description || '',
            version: metadata.version || '1.0',
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
  const configFile = `${agentId}.md`;
  const filePath = join(configDir, configFile);

  try {
    const content = readFileSync(filePath, 'utf8');
    const metadata = parseFrontmatter(content);
    return { agent: metadata };
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
