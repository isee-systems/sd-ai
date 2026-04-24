import { AgentConfigurationManager } from '../../agent/utilities/AgentConfigurationManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AgentConfigurationManager', () => {
  let configManager;

  beforeEach(() => {
    const configPath = path.join(__dirname, '../../agent/config/ganos-lal.md');
    configManager = new AgentConfigurationManager(configPath);
  });

  describe('constructor', () => {
    it('should load config from MD file', () => {
      expect(configManager.config).toBeDefined();
      expect(configManager.config.agent).toBeDefined();
      expect(configManager.config.agent.name).toBe('Ganos Lal');
    });

    it('should throw error for non-existent config file', () => {
      expect(() => {
        new AgentConfigurationManager('/non/existent/path.md');
      }).toThrow();
    });
  });

  describe('buildSystemPrompt', () => {
    it('should build system prompt with model type context', () => {
      const mode = 'cld';

      const prompt = configManager.buildSystemPrompt(mode);

      expect(prompt).toContain('CLD');
      expect(prompt).toContain('Causal Loop Diagram');
    });

    it('should include SFD context when model type is sfd', () => {
      const prompt = configManager.buildSystemPrompt('sfd');

      expect(prompt).toContain('SFD');
      expect(prompt).toContain('Stock Flow Diagram');
    });

    it('should include universal instructions', () => {
      const prompt = configManager.buildSystemPrompt('sfd');

      expect(prompt).toContain('CRITICAL: Text Generation');
      expect(prompt).toContain('NEVER use emojis');
      expect(prompt).toContain('Feedback Loop Analysis');
    });
  });
});
