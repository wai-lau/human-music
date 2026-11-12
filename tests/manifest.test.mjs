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
  ['permissions', () => JSON.stringify(manifest.permissions.sort()) === '["alarms","storage"]'],
  ['host_permissions', () =>
    manifest.host_permissions.includes('https://music.youtube.com/*') &&
    manifest.host_permissions.includes('https://raw.githubusercontent.com/xoundbyte/soul-over-ai/*')],
  ['optional_host_permissions', () =>
    deepEqual(manifest.optional_host_permissions, ['https://*/*'])],
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