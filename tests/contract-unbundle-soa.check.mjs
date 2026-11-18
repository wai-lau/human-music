// Contract check (Wai, 2026-11-12: "In the future, the extension should be bundled without the
// lists, it should auto-download and import from 'known lists' that it is shipped with"). Soul Over
// AI's frozen copy (1,375 names) leaves the package: the extension downloads it like its other
// built-in lists (it is off on new installs since Zoundhub replaced it). The research tools keep
// the copy at research/calibration/soul-over-ai.json. The owner's own lists backup (my-lists.json,
// imported only by her development copy) stays.
// Run from the repo root: node tests/wip-contract-unbundle-soa.check.mjs
const { readFileSync, existsSync } = await import('fs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const root = process.cwd();

t('the package has no Soul Over AI copy', () => !existsSync(root + '/extension/lists/soul-over-ai.json') || 'still packed');
t('index.json imports no filter list, only the owner\'s backup', () => {
  const idx = JSON.parse(readFileSync(root + '/extension/lists/index.json', 'utf8'));
  return (idx.files.every((f) => f.kind !== 'filter-list') && idx.files.some((f) => f.file === 'my-lists.json')) || J(idx.files);
});
t('the research copy is kept, with all its artists', () => {
  const p = root + '/research/calibration/soul-over-ai.json';
  if (!existsSync(p)) return 'missing';
  const d = JSON.parse(readFileSync(p, 'utf8'));
  return ((d.artists || d).length >= 1375) || 'short';
});
t('the investigator CLI reads the research copy', () => /research\/calibration\/soul-over-ai\.json|calibration\/soul-over-ai\.json/.test(readFileSync(root + '/research/investigator/src/cli.mjs', 'utf8')) || 'cli still points at the extension');

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
