import { createReadModelSectionTool, createEditModelSectionTool } from '../../../agent/tools/builtin/largeModelTools.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SESSION_ID = 'test-session';

// Canonical storage format: variable names use spaces, equations use underscores
const BASE_MODEL = {
  specs: { startTime: 0, stopTime: 100, dt: 1, timeUnits: 'Year' },
  variables: [
    { name: 'birth rate', type: 'variable', equation: 'Population * birth_fraction' },
    { name: 'death rate', type: 'variable', equation: 'Population * death_fraction' },
    { name: 'Population', type: 'stock', equation: '1000' },
    { name: 'Finance.net revenue', type: 'variable', equation: 'total_revenue - total_costs' },
    { name: 'Finance.total costs', type: 'variable', equation: 'fixed_costs + variable_costs' },
  ],
  relationships: [
    { from: 'birth rate', to: 'Population', polarity: '+' },
    { from: 'death rate', to: 'Population', polarity: '-' },
  ],
  modules: [
    { name: 'Finance', parentModule: null },
    { name: 'My Module', parentModule: null },
  ],
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(model = BASE_MODEL) {
  const dir = mkdtempSync(join(tmpdir(), 'sd-ai-test-'));
  writeFileSync(join(dir, 'model.sdjson'), JSON.stringify(model));
  return dir;
}

function makeReadTool(tempDir) {
  const sessionManager = { getSessionTempDir: () => tempDir };
  return createReadModelSectionTool(sessionManager, SESSION_ID);
}

function parseResult(result) {
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

// ─── createReadModelSectionTool ───────────────────────────────────────────────

describe('createReadModelSectionTool normalization', () => {
  let tempDir;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  describe('variableNames filter', () => {
    it('matches underscore query against space-named variables', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { variableNames: ['birth_rate'] } })
      );
      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('birth_rate'); // read tool outputs underscores
    });

    it('matches space query against space-named variables', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { variableNames: ['birth rate'] } })
      );
      expect(variables).toHaveLength(1);
    });

    it('is case-insensitive', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { variableNames: ['BIRTH_RATE'] } })
      );
      expect(variables).toHaveLength(1);
    });

    it('matches base name (without module prefix) using underscores', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { variableNames: ['net_revenue'] } })
      );
      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('Finance.net_revenue');
    });
  });

  describe('moduleName filter (variables section)', () => {
    it('matches exact module name', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { moduleName: 'Finance' } })
      );
      expect(variables).toHaveLength(2);
    });

    it('is case-insensitive', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { moduleName: 'FINANCE' } })
      );
      expect(variables).toHaveLength(2);
    });

    it('treats underscores and spaces as equivalent', async () => {
      const dir = makeTempDir({
        ...BASE_MODEL,
        variables: [{ name: 'My Module.revenue', type: 'variable', equation: '100' }],
      });
      const tool = makeReadTool(dir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { moduleName: 'My_Module' } })
      );
      expect(variables).toHaveLength(1);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('usedInEquation filter', () => {
    it('finds variables when searching with spaces (equation uses underscores)', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { usedInEquation: 'birth fraction' } })
      );
      expect(variables).toHaveLength(1);
      expect(variables[0].name).toBe('birth_rate');
    });

    it('finds variables when searching with underscores', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { usedInEquation: 'birth_fraction' } })
      );
      expect(variables).toHaveLength(1);
    });

    it('is case-insensitive', async () => {
      const tool = makeReadTool(tempDir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { usedInEquation: 'BIRTH_FRACTION' } })
      );
      expect(variables).toHaveLength(1);
    });

    it('searches arrayEquations with normalization', async () => {
      const dir = makeTempDir({
        ...BASE_MODEL,
        variables: [{
          name: 'arrayed var', type: 'variable',
          arrayEquations: [{ index: '1', equation: 'base_rate * scale' }],
        }],
      });
      const tool = makeReadTool(dir);
      const { variables } = parseResult(
        await tool.handler({ section: 'variables', filter: { usedInEquation: 'base rate' } })
      );
      expect(variables).toHaveLength(1);
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('relationshipFrom filter', () => {
    it('matches underscore query against space-stored from field', async () => {
      const tool = makeReadTool(tempDir);
      const { relationships } = parseResult(
        await tool.handler({ section: 'relationships', filter: { relationshipFrom: 'birth_rate' } })
      );
      expect(relationships).toHaveLength(1);
      expect(relationships[0].to).toBe('Population');
    });

    it('is case-insensitive', async () => {
      const tool = makeReadTool(tempDir);
      const { relationships } = parseResult(
        await tool.handler({ section: 'relationships', filter: { relationshipFrom: 'Birth Rate' } })
      );
      expect(relationships).toHaveLength(1);
    });
  });

  describe('relationshipTo filter', () => {
    it('matches underscore query against space-stored to field', async () => {
      const tool = makeReadTool(tempDir);
      const { relationships } = parseResult(
        await tool.handler({ section: 'relationships', filter: { relationshipTo: 'population' } })
      );
      expect(relationships).toHaveLength(2);
    });
  });

  describe('moduleName filter (modules section)', () => {
    it('is case-insensitive', async () => {
      const tool = makeReadTool(tempDir);
      const { modules } = parseResult(
        await tool.handler({ section: 'modules', filter: { moduleName: 'finance' } })
      );
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('Finance');
    });

    it('treats underscores and spaces as equivalent', async () => {
      const tool = makeReadTool(tempDir);
      const { modules } = parseResult(
        await tool.handler({ section: 'modules', filter: { moduleName: 'My_Module' } })
      );
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe('My Module');
    });
  });
});

// ─── createEditModelSectionTool ───────────────────────────────────────────────

describe('createEditModelSectionTool normalization', () => {
  let tempDir;
  let session;

  // sendToClient mock: captures the sent model and resolves the pending request
  // via setTimeout so the promise set up after sendToClient can be resolved.
  function makeSendToClient() {
    let capturedModel = null;
    const sendToClient = async (msg) => {
      if (msg.type === 'update_model') {
        capturedModel = JSON.parse(JSON.stringify(msg.modelData));
        setTimeout(() => {
          const pending = session.pendingModelRequests?.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            pending.resolve('ok');
          }
        }, 0);
      }
    };
    return { sendToClient, getModel: () => capturedModel };
  }

  function makeEditTool(sendToClient) {
    session = {
      mode: 'sfd',
      context: { supportsArrays: false, supportsModules: true },
      pendingModelRequests: new Map(),
    };
    const sessionManager = {
      getSession: () => session,
      getSessionTempDir: () => tempDir,
      updateClientModel: () => {},
    };
    return createEditModelSectionTool(sessionManager, SESSION_ID, sendToClient);
  }

  function resetModel(model) {
    writeFileSync(join(tempDir, 'model.sdjson'), JSON.stringify(model));
  }

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'sd-ai-test-')); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  describe('variables add', () => {
    it('normalizes underscore names to spaces', async () => {
      resetModel({ variables: [], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'add', data: [
        { name: 'birth_rate', type: 'variable', equation: '0.1' }
      ]});

      expect(getModel().variables[0].name).toBe('birth rate');
    });

    it('normalizes module-qualified names', async () => {
      resetModel({ variables: [], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'add', data: [
        { name: 'Finance.net_revenue', type: 'variable', equation: '100' }
      ]});

      expect(getModel().variables[0].name).toBe('Finance.net revenue');
    });
  });

  describe('variables update', () => {
    it('finds variable by underscore name', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'update', data: [
        { name: 'birth_rate', equation: '0.2' }
      ]});

      expect(getModel().variables[0].equation).toBe('0.2');
    });

    it('finds variable case-insensitively', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'update', data: [
        { name: 'Birth Rate', equation: '0.2' }
      ]});

      expect(getModel().variables[0].equation).toBe('0.2');
    });

    it('finds variable with mixed case and underscores', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'update', data: [
        { name: 'BIRTH_RATE', equation: '0.2' }
      ]});

      expect(getModel().variables[0].equation).toBe('0.2');
    });

    it('normalizes newName to spaces', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'update', data: [
        { name: 'birth_rate', newName: 'birth_fraction' }
      ]});

      expect(getModel().variables[0].name).toBe('birth fraction');
    });
  });

  describe('variables remove', () => {
    it('removes variable found by underscore name', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'remove', data: ['birth_rate'] });

      expect(getModel().variables).toHaveLength(0);
    });

    it('removes variable case-insensitively', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'remove', data: ['BIRTH RATE'] });

      expect(getModel().variables).toHaveLength(0);
    });

    it('removes variable with mixed case and underscores', async () => {
      resetModel({ variables: [{ name: 'birth rate', type: 'variable', equation: '0.1' }], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'variables', operation: 'remove', data: ['Birth_Rate'] });

      expect(getModel().variables).toHaveLength(0);
    });
  });

  describe('relationships add', () => {
    it('normalizes from and to to spaces', async () => {
      resetModel({ variables: [], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'add', data: [
        { from: 'birth_rate', to: 'Population', polarity: '+' }
      ]});

      expect(getModel().relationships[0].from).toBe('birth rate');
      expect(getModel().relationships[0].to).toBe('Population');
    });
  });

  describe('relationships update', () => {
    it('finds relationship by underscore from/to', async () => {
      resetModel({ variables: [], relationships: [{ from: 'birth rate', to: 'Population', polarity: '+' }], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'update', data: {
        from: 'birth_rate', to: 'Population', polarity: '-'
      }});

      expect(getModel().relationships[0].polarity).toBe('-');
    });

    it('finds relationship case-insensitively', async () => {
      resetModel({ variables: [], relationships: [{ from: 'birth rate', to: 'Population', polarity: '+' }], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'update', data: {
        from: 'BIRTH RATE', to: 'population', polarity: '-'
      }});

      expect(getModel().relationships[0].polarity).toBe('-');
    });

    it('finds relationship with mixed case and underscores', async () => {
      resetModel({ variables: [], relationships: [{ from: 'birth rate', to: 'Population', polarity: '+' }], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'update', data: {
        from: 'Birth_Rate', to: 'POPULATION', polarity: '-'
      }});

      expect(getModel().relationships[0].polarity).toBe('-');
    });
  });

  describe('relationships remove', () => {
    it('removes relationship found by underscore from/to', async () => {
      resetModel({ variables: [], relationships: [{ from: 'birth rate', to: 'Population', polarity: '+' }], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'remove', data: [
        { from: 'birth_rate', to: 'Population' }
      ]});

      expect(getModel().relationships).toHaveLength(0);
    });

    it('removes relationship case-insensitively', async () => {
      resetModel({ variables: [], relationships: [{ from: 'birth rate', to: 'Population', polarity: '+' }], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'remove', data: [
        { from: 'BIRTH RATE', to: 'POPULATION' }
      ]});

      expect(getModel().relationships).toHaveLength(0);
    });

    it('removes relationship with mixed case and underscores', async () => {
      resetModel({ variables: [], relationships: [{ from: 'birth rate', to: 'Population', polarity: '+' }], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'relationships', operation: 'remove', data: [
        { from: 'Birth_Rate', to: 'population' }
      ]});

      expect(getModel().relationships).toHaveLength(0);
    });
  });

  describe('modules add', () => {
    it('normalizes module name underscores to spaces', async () => {
      resetModel({ variables: [], relationships: [], modules: [] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'modules', operation: 'add', data: [
        { name: 'My_Module', parentModule: null }
      ]});

      expect(getModel().modules[0].name).toBe('My Module');
    });
  });

  describe('modules update', () => {
    it('normalizes module names in replacement array', async () => {
      resetModel({ variables: [], relationships: [], modules: [{ name: 'Finance', parentModule: null }] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'modules', operation: 'update', data: [
        { name: 'Finance_Sub', parentModule: 'Finance' }
      ]});

      expect(getModel().modules[0].name).toBe('Finance Sub');
    });
  });

  describe('modules remove', () => {
    it('removes module found by underscore name', async () => {
      resetModel({ variables: [], relationships: [], modules: [{ name: 'My Module', parentModule: null }] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'modules', operation: 'remove', data: ['My_Module'] });

      expect(getModel().modules).toHaveLength(0);
    });

    it('removes module case-insensitively', async () => {
      resetModel({ variables: [], relationships: [], modules: [{ name: 'Finance', parentModule: null }] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'modules', operation: 'remove', data: ['FINANCE'] });

      expect(getModel().modules).toHaveLength(0);
    });

    it('removes module with mixed case and underscores', async () => {
      resetModel({ variables: [], relationships: [], modules: [{ name: 'My Module', parentModule: null }] });
      const { sendToClient, getModel } = makeSendToClient();
      const tool = makeEditTool(sendToClient);

      await tool.handler({ section: 'modules', operation: 'remove', data: ['MY_MODULE'] });

      expect(getModel().modules).toHaveLength(0);
    });
  });
});
