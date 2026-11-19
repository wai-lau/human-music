// The store packages leave out the permissions only the development copy uses. Wai, 2026-11-18:
// "keep all entries for my own version", then "don't ask for unlimited storage!" and "no cap for
// dev?": the committed manifest keeps unlimitedStorage, so the unpacked development copy keeps its
// whole log, and every packed copy (Chrome .crx, Firefox zip) has it removed and keeps up to
// HM.log.STORE_CAP entries inside Chrome's 10 MB.
// Usage: node scripts/store-manifest.mjs <manifest.json>   (rewrites the file in place)
import { readFileSync, writeFileSync } from 'node:fs';

export const DEV_ONLY_PERMISSIONS = ['unlimitedStorage'];

export function storeManifest(manifest) {
  const m = structuredClone(manifest);
  m.permissions = (m.permissions || []).filter((p) => !DEV_ONLY_PERMISSIONS.includes(p));
  return m;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/store-manifest.mjs <manifest.json>'); process.exit(2); }
  const m = storeManifest(JSON.parse(readFileSync(file, 'utf8')));
  writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
}
