// Contract check (Wai, 2026-11-18: switch to Zoundhub). Some list entries must match by their
// IDs only, never by name: a Zoundhub artist whose name is shared with an artist Zoundhub rates
// low (proof the name belongs to more than one act) must not skip a person with that name on
// YouTube Music, where only the name shows. Such an entry carries idOnly: true.
// Run from the repo root: node tests/contract-id-only.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/match.js']).HM;
const SP = 'SOLEASOLEASOLEASOLEA12';

const parsed = HM.lists.parseFilterList({ artists: [
  { name: 'Solea', spotifyId: SP, idOnly: true },
  { name: 'Name Only', idOnly: true },
  { name: 'Plain Act', spotifyId: 'PLAINPLAINPLAINPLAIN12' },
] });
t('parsing keeps idOnly on an entry with an ID, and drops it (and the entry stays a name) without one', () => {
  const a = parsed.artists;
  return (a[0].idOnly === true && a[0].spotifyId === SP && a[1].idOnly === undefined && a[2].idOnly === undefined) || J(a);
});
const index = HM.match.buildIndex({ filterLists: [{ id: 'zoundhub', name: 'Zoundhub', enabled: true, mode: 'act', artists: parsed.artists }], user: HM.store.emptyUser(), threshold: null });
t('an idOnly entry never matches by name', () => {
  const m = HM.match.matchItem(index, { title: 'Song', credits: ['Solea'], channelIds: [], featured: false });
  return m === null || J(m);
});
t('an idOnly entry still matches by its Spotify ID', () => {
  const m = HM.match.matchItem(index, { title: 'Song', credits: ['Solea'], channelIds: [SP], featured: false });
  return (m && m.listId === 'zoundhub' && m.mode === 'act') || J(m);
});
t('other entries match by name as before', () => {
  const m = HM.match.matchItem(index, { title: 'Song', credits: ['Plain Act'], channelIds: [], featured: false });
  return (m && m.listId === 'zoundhub') || J(m);
});
t('an idOnly name is not "known", so an artist by that name can still be checked', () =>
  (!index.known.has(HM.text.normalize('Solea')) && index.known.has(SP)) || 'name is known');

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
