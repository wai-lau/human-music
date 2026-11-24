// scripts/verify-pack.mjs fails a package that carries what friends must not get, and
// scripts/store-manifest.mjs stages a clean one from the committed extension/.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { run } from './load.mjs';
import { verifyTree, verifyArchive } from '../scripts/verify-pack.mjs';
import { stripStagedTree } from '../scripts/store-manifest.mjs';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const scratch = mkdtempSync(join(tmpdir(), 'hm-verify-test-'));
process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const fake = (patch = {}, files = []) => {
  const d = join(scratch, 'fake' + n++);
  mkdirSync(join(d, 'lists'), { recursive: true });
  const m = { manifest_version: 3, version: '1.2.3', permissions: ['scripting', 'storage'], background: { service_worker: 'src/background.js' },
    content_scripts: [{ matches: ['https://music.youtube.com/*'], js: ['src/content.js'] }], ...patch };
  writeFileSync(join(d, 'manifest.json'), JSON.stringify(m));
  writeFileSync(join(d, 'lists/index.json'), JSON.stringify({ files: [] }));
  for (const f of files) { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), 'x'); }
  return d;
};
const has = (problems, re) => problems.some(p => re.test(p)) || JSON.stringify(problems);
const ff = { background: { scripts: ['src/background.js'] }, browser_specific_settings: { gecko: { id: 'a@b' } } };

// A staged copy of the real extension, packed the way the scripts do.
const staged = join(scratch, 'staged');
cpSync(join(root, 'extension'), staged, { recursive: true, filter: s => !s.endsWith('/dev-copy') });
stripStagedTree(staged);
const real = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8'));
const stagedProblems = verifyTree(staged, { version: real.version });

run([
  ['a good tree has no problems', () => verifyTree(fake(), { version: '1.2.3' }).length === 0 || 'problems'],
  ['dev-copy is refused', () => has(verifyTree(fake({}, ['dev-copy'])), /dev-copy/)],
  ['lists/my-lists.json is refused', () => has(verifyTree(fake({}, ['lists/my-lists.json'])), /my-lists/)],
  ['my-lists.json in the lists index is refused', () => {
    const d = fake(); writeFileSync(join(d, 'lists/index.json'), JSON.stringify({ files: [{ file: 'my-lists.json', kind: 'backup' }] }));
    return has(verifyTree(d), /index/);
  }],
  ['capture.js and fingerprint.js files are refused', () => {
    const p = verifyTree(fake({}, ['src/core/capture.js', 'src/core/fingerprint.js']));
    return (has(p, /capture/) === true && has(p, /fingerprint/) === true) || JSON.stringify(p);
  }],
  ['the manifest listing capture.js is refused', () => has(verifyTree(fake({ content_scripts: [{ js: ['src/core/capture.js'] }] })), /capture/)],
  ['unlimitedStorage (any extra permission) is refused', () => has(verifyTree(fake({ permissions: ['scripting', 'storage', 'unlimitedStorage'] })), /permissions/)],
  ['a missing permission is refused', () => has(verifyTree(fake({ permissions: ['storage'] })), /permissions/)],
  ['a wrong version is refused', () => has(verifyTree(fake(), { version: '1.2.4' }), /version/)],
  ['Firefox: a service_worker is refused', () => has(verifyTree(fake({ ...ff, background: { service_worker: 'x.js' } }), { firefox: true }), /service_worker/)],
  ['Firefox: no gecko id is refused', () => has(verifyTree(fake({ background: { scripts: ['a.js'] } }), { firefox: true }), /gecko/)],
  ['a good Firefox tree passes', () => verifyTree(fake(ff), { firefox: true }).length === 0 || 'problems'],
  ['a missing manifest is a problem, not a crash', () => verifyTree(join(scratch, 'nothing')).length > 0],
  ['a bad zip is refused', () => {
    const d = fake({}, ['lists/my-lists.json']);
    const z = join(scratch, 'bad.zip');
    execFileSync('python3', ['-I', '-c', 'import sys,shutil; shutil.make_archive(sys.argv[1], "zip", sys.argv[2])', z.slice(0, -4), d]);
    return has(verifyArchive(z, { firefox: false }), /my-lists/);
  }],
  ['the staged real extension passes verify-pack at its own version', () => stagedProblems.length === 0 || JSON.stringify(stagedProblems)],
  ['staging removed the dev-only files and the index entry', () =>
    (!existsSync(join(staged, 'lists/my-lists.json')) && !existsSync(join(staged, 'src/core/capture.js')) && !existsSync(join(staged, 'src/core/fingerprint.js')) && !readFileSync(join(staged, 'lists/index.json'), 'utf8').includes('my-lists')) || 'files remain'],
  ['the committed extension, unstaged, is refused (so the check can fail)', () => has(verifyTree(join(root, 'extension'), { version: real.version }), /permissions|capture|my-lists/)],
  ['the committed manifest sets minimum_chrome_version 110', () => real.minimum_chrome_version === '110' || String(real.minimum_chrome_version)],
]);
