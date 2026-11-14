import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const EXT = join(fileURLToPath(import.meta.url), '..', '..', 'extension');

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
} catch (e) {
  console.log(`FAIL read manifest: ${e.message}`);
  process.exit(1);
}

const cases = [
  ['manifest_version', () => manifest.manifest_version === 3],
  ['name', () => manifest.name === 'Human Music'],
  // scripting: put the content script into YouTube Music tabs already open when the
  // extension installs or reloads (Chrome does not, and cut-off copies stop working).
  // As few as the job needs (Wai, 2026-11-13: "minimize required permissions"): storage for
  // the lists, scripting to reach music tabs already open after an update, the two sites.
  ['permissions', () => JSON.stringify(manifest.permissions.slice().sort()) === '["scripting","storage"]'],
  ['host_permissions: the two music sites only', () =>
    JSON.stringify(manifest.host_permissions.slice().sort()) === '["https://music.youtube.com/*","https://open.spotify.com/*"]'],
  ['no optional host permissions', () => !('optional_host_permissions' in manifest)],
  ['background', () => manifest.background.service_worker === 'src/background.js'],
  ['action', () => manifest.action.default_popup === 'popup/popup.html'],
  ['content_scripts matches', () =>
    deepEqual(manifest.content_scripts[0].matches, ['https://music.youtube.com/*'])],
  ['content_scripts js', () =>
    deepEqual(manifest.content_scripts[0].js, [
      'src/core/text.js',
      'src/core/match.js',
      'src/core/lists.js',
      'src/core/settings.js',
      'src/core/log.js',
      'src/core/lookahead.js',
      'src/core/skipper.js',
      'src/page/ytm.js',
      'src/content.js'
    ])],
  ['all manifest files exist', () => {
    const files = [
      ...manifest.content_scripts[0].js,
      manifest.background.service_worker,
      manifest.action.default_popup,
      ...Object.values(manifest.icons)
    ];
    for (const f of files) {
      if (f.endsWith('.png')) continue;
      if (!existsSync(join(EXT, f))) return `missing: ${f}`;
    }
    return true;
  }]
];

let passed = 0;
let failed = 0;
for (const [label, fn] of cases) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`PASS ${label}`);
      passed++;
    } else {
      console.log(`FAIL ${label}: ${result}`);
      failed++;
    }
  } catch (e) {
    console.log(`FAIL ${label}: ${e.message}`);
    failed++;
  }
}
console.log(`${passed}/${cases.length} pass`);
if (failed > 0) process.exit(1);
