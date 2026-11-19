// scripts/build-firefox.sh writes a Firefox copy of the extension: background.scripts in
// place of the service worker, a gecko id, the same files otherwise.
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { run } from './load.mjs';
import { storeManifest } from '../scripts/store-manifest.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const chrome = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'hm-ff-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
// Build in a scratch repo with the repo layout so the test never touches dist/. The
// build reads a commit: changes made after the commit must not appear in it.
const env = { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir(), GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com' };
const vcs = (...args) => execFileSync('git', ['-C', work, ...args], { env, stdio: 'pipe' });
execFileSync('cp', ['-r', join(root, 'extension'), join(root, 'scripts'), work]);
vcs('init', '-q');
vcs('add', '-A');
vcs('commit', '-q', '-m', 'base');
const committedManifest = readFileSync(join(work, 'extension/manifest.json'), 'utf8');
writeFileSync(join(work, 'extension/src/background.js'), '// UNCOMMITTED\n' + readFileSync(join(work, 'extension/src/background.js'), 'utf8'));
writeFileSync(join(work, 'extension/untracked.txt'), 'x');
writeFileSync(join(work, 'extension/manifest.json'), committedManifest.replace(/"version": "[^"]*"/, '"version": "9.9.9"'));
execFileSync('bash', [join(work, 'scripts/build-firefox.sh')], { stdio: 'pipe', env });
const out = join(work, 'dist/firefox');
const ff = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
const archived = mkdtempSync(join(tmpdir(), 'hm-ff-arch-'));
process.on('exit', () => rmSync(archived, { recursive: true, force: true }));
execFileSync('bash', ['-c', 'git -C "$1" archive HEAD extension | tar -x -C "$2"', '_', work, archived], { env });
const background = readFileSync(join(root, 'extension/src/background.js'), 'utf8');
const imported = (background.match(/importScripts\(([^)]*)\)/) || [null, ''])[1].match(/'([^']+)'/g).map(s => 'src/' + s.slice(1, -1));

run([
  ['Firefox background is scripts, no service worker', () =>
    (Array.isArray(ff.background.scripts) && !('service_worker' in ff.background)) || JSON.stringify(ff.background)],
  ['background scripts = the core files the worker imports, then background.js', () =>
    JSON.stringify(ff.background.scripts) === JSON.stringify([...imported, 'src/background.js']) || JSON.stringify({ ff: ff.background.scripts, imported })],
  ['gecko id and a Firefox version with MV3 background scripts', () =>
    (ff.browser_specific_settings.gecko.id === 'human-music@wai-lau' && parseInt(ff.browser_specific_settings.gecko.strict_min_version, 10) >= 121) || JSON.stringify(ff.browser_specific_settings)],
  ['declares no data collection (AMO requires it for new extensions)', () =>
    JSON.stringify(ff.browser_specific_settings.gecko.data_collection_permissions) === '{"required":["none"]}' || JSON.stringify(ff.browser_specific_settings.gecko)],
  ['no management permission is requested (getSelf needs none)', () => !(ff.permissions || []).includes('management') || 'management present'],
  ['everything else matches the packed Chrome manifest (no development-only permission)', () => {
    const strip = m => { const c = { ...m }; delete c.background; delete c.browser_specific_settings; return JSON.stringify(c); };
    return strip(ff) === strip(storeManifest(chrome)) || 'manifests differ';
  }],
  ['every file the Firefox manifest names exists in the build', () => {
    const files = [...ff.background.scripts, ff.action.default_popup, ...Object.values(ff.icons), ...ff.content_scripts.flatMap(c => c.js)];
    const missing = files.filter(f => !existsSync(join(out, f)));
    return missing.length === 0 || `missing: ${missing.join(', ')}`;
  }],
  ['the build is the committed extension: archive of the ref, uncommitted edits absent', () => {
    let diff = '';
    try { execFileSync('diff', ['-r', '-x', 'manifest.json', join(archived, 'extension'), out], { stdio: 'pipe' }); } catch (e) { diff = String(e.stdout); }
    return (diff === '' && !existsSync(join(out, 'untracked.txt')) && !readFileSync(join(out, 'src/background.js'), 'utf8').includes('UNCOMMITTED')
      && ff.version === chrome.version) || diff || 'working-tree change leaked into the build';
  }],
  ['an unknown ref fails', () => {
    try { execFileSync('bash', [join(work, 'scripts/build-firefox.sh'), 'no-such-ref'], { stdio: 'pipe', env }); return 'did not fail'; } catch (e) { return true; }
  }],
  ['the Chrome package is untouched', () => JSON.stringify(JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'))) === JSON.stringify(chrome) || 'changed'],
]);
