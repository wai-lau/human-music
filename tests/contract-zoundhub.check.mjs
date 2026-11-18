// Contract check (Wai, 2026-11-18: switch to Zoundhub now). HM.lists.fromZoundhub turns
// Zoundhub's data file (zoundhub.com/data/artists-all.json: { reference_year, total, artists:
// [{ id, name, rating, deezer, debut, ... }] }) into a Human Music list. Zoundhub calls its rating
// "an AI signal, not a verified classification", and rating 4 includes real people, so:
// - only rating 5 with Deezer's own AI label (deezer === true) is used;
// - a debut before 2020 is left out (Wai: "pre-2020, auto-allow");
// - a name that also belongs to an artist Zoundhub rates 1-3, or 4 without the Deezer label,
//   matches by Spotify ID only (idOnly), never by name.
// Run from the repo root: node tests/contract-zoundhub.check.mjs
const { load } = await import(process.cwd() + '/tests/load.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js']).HM;
const id = (c) => c.repeat(22);
const z = (name, o = {}) => ({ id: id(o.c || name[0]), slug: name.toLowerCase(), name, rating: 5, deezer: true, debut: '2025', ...o });
const data = { reference_year: 2026, total: 9, artists: [
  z('Clear Bot', { c: 'A' }),
  z('Rated Four', { c: 'B', rating: 4 }),
  z('No Deezer', { c: 'C', deezer: false }),
  z('Deezer Unknown', { c: 'D', deezer: null }),
  z('Old Act', { c: 'E', debut: '2016' }),
  z('No Debut', { c: 'F', debut: null }),
  z('Solea', { c: 'G' }),
  z('solea ', { c: 'H', rating: 2, deezer: false }),
  z('Bad Id', { id: 'nope' }),
] };
const list = HM.lists.fromZoundhub(data);

t('only rating 5 with the Deezer AI label, from 2020 on (or no debut given), with a valid Spotify ID', () =>
  J(list.artists.map((a) => a.name).sort()) === J(['Clear Bot', 'No Debut', 'Solea'].sort()) || J(list.artists));
t('entries carry the Spotify ID; a name shared with a low-rated artist is ID-only', () => {
  const by = Object.fromEntries(list.artists.map((a) => [a.name, a]));
  return (by['Clear Bot'].spotifyId === id('A') && by['Clear Bot'].idOnly === undefined && by.Solea.idOnly === true && by.Solea.spotifyId === id('G')) || J(list.artists);
});
t('the result is a list Human Music reads as it is', () => {
  const parsed = HM.lists.parseFilterList(list);
  return (parsed && parsed.artists.length === 3 && parsed.artists.find((a) => a.name === 'Solea').idOnly === true) || J(parsed);
});
t('not Zoundhub data, or nothing usable: null', () =>
  [null, {}, { artists: 'x' }, { artists: [] }, [1, 2]].every((d) => HM.lists.fromZoundhub(d) === null) || 'not null');
t('parseFilterList reads Zoundhub data directly too', () => {
  const parsed = HM.lists.parseFilterList(data);
  return (parsed && J(parsed.artists.map((a) => a.name).sort()) === J(['Clear Bot', 'No Debut', 'Solea'].sort())) || J(parsed);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
