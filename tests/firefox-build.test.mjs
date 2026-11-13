// scripts/build-firefox.sh writes a Firefox copy of the extension: background.scripts in
// place of the service worker, a gecko id, the same files otherwise.
import { execFileSync } from 'child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { run } from './load.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const chrome = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'hm-ff-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
// Build into a scratch copy of the repo layout so the test never touches dist/.
execFileSync('cp', ['-r', join(root, 'extension'), join(root, 'scripts'), work]);
execFileSync('bash', [join(work, 'scripts/build-firefox.sh')], { stdio: 'pipe' });
const out = join(work, 'dist/firefox');
const ff = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const background = readFileSync(join(root, 'extension/src/background.js'), 'utf8');
const imported = (background.match(/importScripts\(([^)]*)\)/) || [null, ''])[1].match(/'([^']+)'/g).map(s => 'src/' + s.slice(1, -1));

run([
  ['Firefox background is scripts, no service worker', () =>
    (Array.isArray(ff.background.scripts) && !('service_worker' in ff.background)) || JSON.stringify(ff.background)],
  ['background scripts = the core files the worker imports, then background.js', () =>
    JSON.stringify(ff.background.scripts) === JSON.stringify([...imported, 'src/background.js']) || JSON.stringify({ ff: ff.background.scripts, imported })],
  ['gecko id and a Firefox version with MV3 background scripts', () =>
    (ff.browser_specific_settings.gecko.id === 'human-music@wai-lau' && parseInt(ff.browser_specific_settings.gecko.strict_min_version, 10) >= 121) || JSON.stringify(ff.browser_specific_settings)],
  ['everything else matches the Chrome manifest', () => {
    const strip = m => { const c = { ...m }; delete c.background; delete c.browser_specific_settings; return JSON.stringify(c); };
    return strip(ff) === strip(chrome) || 'manifests differ';
  }],
  ['every file the Firefox manifest names exists in the build', () => {
    const files = [...ff.background.scripts, ff.action.default_popup, ...Object.values(ff.icons), ...ff.content_scripts.flatMap(c => c.js)];
    const missing = files.filter(f => !existsSync(join(out, f)));
    return missing.length === 0 || `missing: ${missing.join(', ')}`;
  }],
  ['the Chrome package is untouched', () => JSON.stringify(JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))) === JSON.stringify(chrome) || 'changed'],
]);
