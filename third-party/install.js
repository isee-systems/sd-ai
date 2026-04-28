import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (process.platform === 'win32') {
  execSync(`"${join(__dirname, 'install.bat')}"`, { stdio: 'inherit', shell: true });
} else {
  execSync(`bash "${join(__dirname, 'install.sh')}"`, { stdio: 'inherit' });
}
