// Runs every tests/contract-*.check.mjs (the lead's contract checks, written from the
// plan and spec independently of each module's own tests) from the repo root.
import { readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { run } from './load.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const checks = readdirSync(join(root, 'tests')).filter(f => /^contract-.*\.check\.mjs$/.test(f)).sort();

run(checks.map(f => [f, () => {
  try {
    execFileSync(process.execPath, [join('tests', f)], { cwd: root, encoding: 'utf8', timeout: 120000 });
    return true;
  } catch (e) {
    return (String(e.stdout || '') + String(e.stderr || '')).trim().split('\n')
      .filter(l => l.includes('FAIL') || l.includes('Error')).slice(0, 5).join(' | ') || e.message;
  }
}]));
