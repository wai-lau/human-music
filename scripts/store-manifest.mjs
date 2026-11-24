// The store packages leave out what only the development copy uses. Wai, 2026-11-18:
// "keep all entries for my own version", then "don't ask for unlimited storage!" and "no cap for
// dev?": the committed manifest keeps unlimitedStorage, so the unpacked development copy keeps its
// whole log, and every packed copy (Chrome .crx, Firefox zip) has it removed and keeps up to
// HM.log.STORE_CAP entries inside Chrome's 10 MB.
// Packed copies also drop the dormant audio-capture code and the owner's personal list backup
// (lists/my-lists.json, which scripts/save-lists.sh fills): friends get neither.
// Usage: node scripts/store-manifest.mjs <manifest.json>   (rewrites the staged folder in place)
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEV_ONLY_PERMISSIONS = ['unlimitedStorage'];
export const DEV_ONLY_SCRIPTS = ['src/core/capture.js', 'src/core/fingerprint.js'];
export const DEV_ONLY_LISTS = 'lists/my-lists.json';

export function storeManifest(manifest) {
  const m = structuredClone(manifest);
  m.permissions = (m.permissions || []).filter((p) => !DEV_ONLY_PERMISSIONS.includes(p));
  return m;
}

// The content scripts without the dev-only audio files.
export function storeScripts(manifest) {
  const m = structuredClone(manifest);
  for (const cs of m.content_scripts || []) cs.js = (cs.js || []).filter((f) => !DEV_ONLY_SCRIPTS.includes(f));
  return m;
}

export function storeIndex(index) {
  const i = structuredClone(index);
  i.files = (i.files || []).filter((f) => !(f && f.file === 'my-lists.json'));
  return i;
}

// Rewrites a staged extension folder in place: manifest, dev-only files, the lists index.
export function stripStagedTree(dir) {
  const mp = join(dir, 'manifest.json');
  const m = storeScripts(storeManifest(JSON.parse(readFileSync(mp, 'utf8'))));
  writeFileSync(mp, JSON.stringify(m, null, 2) + '\n');
  // dev-copy never reaches a git archive (gitignored), but a copied working tree can carry it.
  for (const f of [...DEV_ONLY_SCRIPTS, DEV_ONLY_LISTS, 'dev-copy']) rmSync(join(dir, f), { force: true });
  const ip = join(dir, 'lists/index.json');
  let index = null;
  try { index = JSON.parse(readFileSync(ip, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (index) writeFileSync(ip, JSON.stringify(storeIndex(index), null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/store-manifest.mjs <manifest.json>'); process.exit(2); }
  stripStagedTree(dirname(file));
}
