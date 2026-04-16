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
      const sessionConfig = {};
      const runtimeDirectives = '';
      const modelType = 'cld';

      const prompt = configManager.buildSystemPrompt(sessionConfig, runtimeDirectives, modelType);

      expect(prompt).toContain('Ganos Lal');
      expect(prompt).toContain('CLD');
      expect(prompt).toContain('Causal Loop Diagram');
    });

    it('should include SFD context when model type is sfd', () => {
      const prompt = configManager.buildSystemPrompt({}, '', 'sfd');

      expect(prompt).toContain('SFD');
      expect(prompt).toContain('Stock Flow Diagram');
    });

    it('should include runtime directives when provided', () => {
      const directives = { temporaryInstructions: ['Use metric units only'] };
      const prompt = configManager.buildSystemPrompt({}, directives, 'cld');

      expect(prompt).toContain('Use metric units only');
    });

    it('should include instructions from config', () => {
      const prompt = configManager.buildSystemPrompt({}, '', 'cld');

      expect(prompt).toContain('patient');
      expect(prompt).toContain('mentor');
    });

    it('should include tool policies from config', () => {
      const prompt = configManager.buildSystemPrompt({}, '', 'cld');

      expect(prompt).toContain('discuss_with_mentor');
    });
  });

  describe('agent configurations', () => {
    it('should load Myrddin config correctly', () => {
      const configPath = path.join(__dirname, '../../agent/config/myrddin.yaml');
      const myrddinConfig = new AgentConfigurationManager(configPath);

      expect(myrddinConfig.config.agent.name).toBe('Myrddin');
      expect(myrddinConfig.config.agent.description).toContain('Expert Modeler');
    });

    it('should have different constraints for different agents', () => {
      const ganosConfig = configManager;
      const myrConfig = new AgentConfigurationManager(path.join(__dirname, '../../agent/config/myrddin.yaml'));

      const ganosPrompt = ganosConfig.buildSystemPrompt({}, {}, 'sfd');
      const myrPrompt = myrConfig.buildSystemPrompt({}, {}, 'sfd');

      // Ganos is patient mentor
      expect(ganosPrompt).toContain('Ganos Lal');
      expect(ganosPrompt).toContain('patient');

      // Myrddin is expert modeler
      expect(myrPrompt).toContain('Myrddin');
      expect(myrPrompt).toContain('efficient');
    });
  });

  describe('model type enforcement', () => {
    it('should include model type rules in system prompt', () => {
      const prompt = configManager.buildSystemPrompt({}, '', 'cld');

      expect(prompt).toContain('CRITICAL MODEL TYPE RULES');
      expect(prompt).toContain('CANNOT be changed');
    });
  });
});
