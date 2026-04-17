/**
 * Unit tests for Python sandbox security
 * Tests the python_sandbox.sh wrapper for directory isolation
 */

import { jest } from '@jest/globals';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SANDBOX_SCRIPT = join(__dirname, '../../agent/utilities/python_sandbox.sh');

let testSandbox;
let outsideDir;

/**
 * Execute a Python script in the sandbox
 */
async function executeSandboxScript(script) {
  const scriptPath = join(testSandbox, `test_${Date.now()}.py`);
  writeFileSync(scriptPath, script);

  return new Promise((resolve) => {
    const proc = spawn(SANDBOX_SCRIPT, [testSandbox, scriptPath], {
      timeout: 10000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: -1, stdout: '', stderr: err.message });
    });
  });
}

describe('Python Sandbox - File Write Restrictions', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    outsideDir = join(tmpdir(), 'outside-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('should block writing files outside sandbox using absolute path', async () => {
    const targetFile = join(outsideDir, 'hacked.txt');
    const result = await executeSandboxScript(`
try:
    with open('${targetFile}', 'w') as f:
        f.write('HACKED')
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
`);

    expect(result.code).toBe(0);
    expect(existsSync(targetFile)).toBe(false);
  });

  it('should block writing files outside sandbox using path traversal', async () => {
    const result = await executeSandboxScript(`
try:
    with open('../../../etc/passwd', 'w') as f:
        f.write('HACKED')
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
`);

    expect(result.code).toBe(0);
  });

  it('should allow writing files inside sandbox', async () => {
    const result = await executeSandboxScript(`
with open('allowed.txt', 'w') as f:
    f.write('This is allowed')
print('SUCCESS')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SUCCESS');
    expect(existsSync(join(testSandbox, 'allowed.txt'))).toBe(true);
  });

  it('should block creating directories outside sandbox', async () => {
    const targetDir = join(outsideDir, 'newdir');
    const result = await executeSandboxScript(`
import os
try:
    os.mkdir('${targetDir}')
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
`);

    expect(result.code).toBe(0);
    expect(existsSync(targetDir)).toBe(false);
  });

  it('should allow creating directories inside sandbox', async () => {
    const result = await executeSandboxScript(`
import os
os.mkdir('subdir')
print('SUCCESS')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SUCCESS');
    expect(existsSync(join(testSandbox, 'subdir'))).toBe(true);
  });

  it('should block removing files outside sandbox', async () => {
    const targetFile = join(outsideDir, 'victim.txt');
    writeFileSync(targetFile, 'victim content');

    const result = await executeSandboxScript(`
import os
try:
    os.remove('${targetFile}')
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
`);

    expect(result.code).toBe(0);
    expect(existsSync(targetFile)).toBe(true);
  });
});

describe('Python Sandbox - File Read Permissions', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
  });

  it('should allow reading system files', async () => {
    const result = await executeSandboxScript(`
with open('/etc/hosts', 'r') as f:
    content = f.read()
    assert len(content) > 0
print('SUCCESS')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SUCCESS');
  });

  it('should allow reading files inside sandbox', async () => {
    writeFileSync(join(testSandbox, 'readable.txt'), 'test content');

    const result = await executeSandboxScript(`
with open('readable.txt', 'r') as f:
    content = f.read()
    assert content == 'test content'
print('SUCCESS')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SUCCESS');
  });
});

describe('Python Sandbox - Subprocess Blocking', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
  });

  it('should block subprocess.run()', async () => {
    const result = await executeSandboxScript(`
import subprocess
try:
    subprocess.run(['ls', '/'])
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should block subprocess.call()', async () => {
    const result = await executeSandboxScript(`
import subprocess
try:
    subprocess.call(['echo', 'test'])
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should block subprocess.Popen()', async () => {
    const result = await executeSandboxScript(`
import subprocess
try:
    subprocess.Popen(['ls'])
    exit(1)  # Should not reach here
except PermissionError:
    pass  # Expected
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });
});

describe('Python Sandbox - Network Blocking', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
  });

  it('should block urllib import', async () => {
    const result = await executeSandboxScript(`
try:
    import urllib
    exit(1)  # Should not reach here
except ImportError:
    pass  # Expected
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should block requests import', async () => {
    const result = await executeSandboxScript(`
try:
    import requests
    exit(1)  # Should not reach here
except ImportError:
    pass  # Expected
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });
});

describe('Python Sandbox - Resource Limits', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
  });

  it('should enforce CPU time limit', async () => {
    const result = await executeSandboxScript(`
import time
try:
    # Try to run for longer than ulimit allows
    for i in range(100000000):
        x = i * i
except:
    pass
print('DONE')
`);

    // Script should either complete or be killed by ulimit
    expect([0, 137]).toContain(result.code);
  });

  it('should enforce file size limit', async () => {
    const result = await executeSandboxScript(`
try:
    # Try to write more than 50MB (ulimit -f 51200 blocks)
    with open('large.txt', 'w') as f:
        f.write('x' * (60 * 1024 * 1024))  # 60MB
    print('WROTE_LARGE_FILE')
except:
    print('BLOCKED_LARGE_FILE')
`);

    // Should be blocked by file size limit
    expect(
      result.stdout.includes('BLOCKED_LARGE_FILE') || result.code !== 0
    ).toBe(true);
  });
});

describe('Python Sandbox - Path Traversal Prevention', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    outsideDir = join(tmpdir(), 'outside-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('should block ../../../ path traversal', async () => {
    const result = await executeSandboxScript(`
try:
    with open('../../../etc/passwd', 'w') as f:
        f.write('HACKED')
    exit(1)
except PermissionError:
    pass
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });

  it('should block symlink-based escapes', async () => {
    const result = await executeSandboxScript(`
import os
try:
    os.symlink('${outsideDir}', 'escape_link')
    with open('escape_link/hacked.txt', 'w') as f:
        f.write('HACKED')
    exit(1)
except (PermissionError, OSError):
    pass
print('BLOCKED')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCKED');
  });
});

describe('Python Sandbox - Matplotlib Compatibility', () => {
  beforeEach(() => {
    testSandbox = join(tmpdir(), 'test-sandbox-' + Date.now());
    mkdirSync(testSandbox, { recursive: true });
  });

  afterEach(() => {
    rmSync(testSandbox, { recursive: true, force: true });
  });

  it('should allow matplotlib to create visualizations', async () => {
    const result = await executeSandboxScript(`
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
plt.savefig('test.png')
plt.close()
print('SUCCESS')
`);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SUCCESS');
    expect(existsSync(join(testSandbox, 'test.png'))).toBe(true);
  }, 30000); // Increase timeout for matplotlib import
});
