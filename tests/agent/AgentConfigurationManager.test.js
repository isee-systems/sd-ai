import { AgentConfigurationManager } from '../../agent/utilities/AgentConfigurationManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('AgentConfigurationManager', () => {
  let configManager;

  beforeEach(() => {
    const configPath = path.join(__dirname, '../../agent/config/socrates.md');
    configManager = new AgentConfigurationManager({ path: configPath });
  });

  describe('constructor', () => {
    it('should load config from MD file via path option', () => {
      expect(configManager.config).toBeDefined();
      expect(configManager.config.agent).toBeDefined();
      expect(configManager.config.agent.name).toMatch(/^Socrates/);
    });

    it('should throw error for non-existent config file', () => {
      expect(() => {
        new AgentConfigurationManager({ path: '/non/existent/path.md' });
      }).toThrow();
    });

    it('should load config from markdownContent option', () => {
      const md = `---\nname: "TestAgent"\nagent_mode: sdk\nsupported_modes:\n  - sfd\nsupported_providers:\n  - anthropic\n---\n## Instructions\nDo things.\n`;
      const mgr = new AgentConfigurationManager({ markdownContent: md });
      expect(mgr.config.agent.name).toBe('TestAgent');
      expect(mgr.configPath).toBeNull();
    });

    it('should throw for markdownContent missing required frontmatter fields', () => {
      const md = `---\nname: "NoMode"\n---\n## Instructions\nDo things.\n`;
      expect(() => new AgentConfigurationManager({ markdownContent: md })).toThrow(/agent_mode/);
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
