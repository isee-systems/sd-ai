import { AgentConfigurationManager } from '../../agent/utilities/AgentConfigurationManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AgentConfigurationManager', () => {
  let configManager;

  beforeEach(() => {
    const configPath = path.join(__dirname, '../../agent/config/ganos-lal.yaml');
    configManager = new AgentConfigurationManager(configPath);
  });

  describe('constructor', () => {
    it('should load config from YAML file', () => {
      expect(configManager.config).toBeDefined();
      expect(configManager.config.agent).toBeDefined();
      expect(configManager.config.agent.name).toBe('Ganos Lal');
    });

    it('should throw error for non-existent config file', () => {
      expect(() => {
        new AgentConfigurationManager('/non/existent/path.yaml');
      }).toThrow();
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt with model type context', () => {
      const modelType = 'cld';

      const prompt = configManager.buildSystemPrompt(modelType);

      expect(prompt).toContain('Ganos Lal');
      expect(prompt).toContain('CLD');
      expect(prompt).toContain('Causal Loop Diagram');
    });

    it('should include SFD context when model type is sfd', () => {
      const prompt = configManager.buildSystemPrompt('sfd');

      expect(prompt).toContain('SFD');
      expect(prompt).toContain('Stock Flow Diagram');
    });
  });
});
