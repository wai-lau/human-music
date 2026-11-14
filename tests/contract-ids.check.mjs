// Contract check: filter lists keep each artist's YouTube channel ID and Spotify artist ID,
// and matching uses them. Run from the repo root:
//   node tests/contract-ids.check.mjs   (tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { lists, match } = load(['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js']).HM;
const fails = [];
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const J = v => JSON.stringify(sortKeys(v));
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const YT = 'UCOCi_VDTQPFn9fZtfqnpVag';
const SP = '5ExXpwxyFXhwPKYKx6ItaN';

// Soul Over AI records carry 'youtube' and 'spotify' fields.
eq('soul over ai ids kept', lists.parseFilterList([
  { name: '10mm', youtube: YT, spotify: SP, apple: '123', removed: false },
  { name: 'NoIds' },
  { name: 'BadIds', youtube: 'not-a-channel', spotify: 'short' },
  { name: 'Gone', youtube: YT, spotify: SP, removed: true },
]), { artists: [{ name: '10mm', channelId: YT, spotifyId: SP }, { name: 'NoIds' }, { name: 'BadIds' }] });
eq('channelId field still wins over youtube', lists.parseFilterList([{ name: 'A', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', youtube: YT }]).artists[0].channelId, 'UCaaaaaaaaaaaaaaaaaaaaaa');
// Human Music's own format carries channelId and spotifyId.
eq('own format ids kept', lists.parseFilterList({ name: 'HM', artists: [{ name: 'A', channelId: YT, spotifyId: SP }, { name: 'B', spotifyId: 'nope!' }] }),
  { artists: [{ name: 'A', channelId: YT, spotifyId: SP }, { name: 'B' }] });

const list = (artists, extra = {}) => ({ id: 'soul-over-ai', name: 'Soul Over AI', url: 'u', enabled: true, mode: 'act', builtIn: true, artists, ...extra });
const EMPTY = { artists: [], songs: [], keywords: [], neverSkip: [] };
const idx = (lists2, user = {}) => match.buildIndex({ filterLists: lists2, user: { ...EMPTY, ...user } });
const ix = idx([list([{ name: 'Listed Name', spotifyId: SP, channelId: YT }])]);

t('spotify id matches a song whatever its name', () => {
  const m = match.matchSong(ix, { title: 'X', artistLine: 'Renamed Artist • Album', channelIds: [SP] });
  return (m && m.rule === 'channel' && m.entry === 'Listed Name' && m.mode === 'act') || J(m);
});
t('youtube channel id still matches', () => (match.matchSong(ix, { title: 'X', artistLine: 'Other • A', channelIds: [YT] })?.rule === 'channel') || 'no match');
t('spotify id matches a page item', () => (match.matchItem(ix, { title: 'EP', credits: ['Someone'], channelIds: [SP], featured: false })?.rule === 'channel') || 'no match');
t('an unknown id does not match', () => match.matchSong(ix, { title: 'X', artistLine: 'Real Band • A', channelIds: ['0000000000000000000000'] }) === null || 'matched');
t('never skip still wins over an id', () => match.matchSong(idx([list([{ name: 'Listed Name', spotifyId: SP }])], { neverSkip: ['Real Band'] }), { title: 'X', artistLine: 'Real Band • A', channelIds: [SP] }) === null || 'matched');
t('watch list id match is watch mode', () => (match.matchSong(idx([list([{ name: 'N', spotifyId: SP }], { mode: 'watch' })]), { title: 'X', artistLine: 'Z • A', channelIds: [SP] })?.mode === 'watch') || 'not watch');
t('disabled list id ignored', () => match.matchSong(idx([list([{ name: 'N', spotifyId: SP }], { enabled: false })]), { title: 'X', artistLine: 'Z • A', channelIds: [SP] }) === null || 'matched');

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
