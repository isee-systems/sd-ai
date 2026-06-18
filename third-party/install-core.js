import { execSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Cross-platform "core only" install: installs the core app plus the
// visualization-engine, skipping every other third-party component. Setting an
// env var inline (`VAR=value npm install`) is POSIX-shell-only, so we set it
// here and shell out to npm instead, which works on Windows too.

const __dirname = dirname(fileURLToPath(import.meta.url));

const KEEP = 'visualization-engine';

// A component is any subdirectory with an install script. Compute the skip list
// dynamically so it never goes stale when components are added or removed.
const skip = readdirSync(__dirname, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== KEEP)
  .filter((entry) =>
    existsSync(join(__dirname, entry.name, 'install.sh')) ||
    existsSync(join(__dirname, entry.name, 'install.bat'))
  )
  .map((entry) => entry.name);

execSync('npm install', {
  stdio: 'inherit',
  env: { ...process.env, SKIP_THIRD_PARTY_COMPONENTS: skip.join(',') },
});
