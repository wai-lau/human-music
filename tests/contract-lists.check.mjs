// Lead-side probe for Task 3 (lists and backups). Run from the repo root:
//   node --input-type=module -e "$(cat .mates/probes/task3.mjs)"
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { lists } = load(['src/core/text.js', 'src/core/lists.js']).HM;
const fails = [];
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const J = v => JSON.stringify(sortKeys(v));
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const eqf = (label, fn, want) => { try { eq(label, fn(), want); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const throws = (label, fn, msg) => { try { fn(); fails.push(`${label}: did not throw`); } catch (e) { if (msg && e.message !== msg) fails.push(`${label}: message ${J(e.message)}`); } };

eq('SOUL_OVER_AI', lists.SOUL_OVER_AI, { id: 'soul-over-ai', name: 'Soul Over AI',
  url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json',
  enabled: true, mode: 'act', builtIn: true, lastRefresh: null, count: 0, lastError: null });
eq('FREQUENCIES', lists.FREQUENCIES, { '6h': 21600000, '12h': 43200000, daily: 86400000, weekly: 604800000, manual: Infinity });
t('manual is Infinity', () => lists.FREQUENCIES.manual === Infinity || String(lists.FREQUENCIES.manual));

eq('soul over ai records', lists.parseFilterList([{ name: 'A', removed: false }, { name: 'B', removed: true }, { name: 'C' }]), { artists: [{ name: 'A' }, { name: 'C' }] });
eq('strings', lists.parseFilterList(['A', 'B']), { artists: [{ name: 'A' }, { name: 'B' }] });
eq('own format', lists.parseFilterList({ name: 'HM', updated: '2026-11-11', artists: [{ name: 'A', channelId: 'UC1' }] }), { artists: [{ name: 'A', channelId: 'UC1' }] });
eq('html', lists.parseFilterList('<html>'), null);
eq('foo', lists.parseFilterList({ foo: 1 }), null);
eq('null', lists.parseFilterList(null), null);
eq('empty array', lists.parseFilterList([]), { artists: [] });
eq('bad names dropped', lists.parseFilterList([{ name: '' }, { name: 5 }, {}, null, 'X', '']), { artists: [{ name: 'X' }] });
eq('channelId only if non-empty string', lists.parseFilterList([{ name: 'A', channelId: '' }, { name: 'B', channelId: 7 }]), { artists: [{ name: 'A' }, { name: 'B' }] });

eq('due never fetched', lists.isRefreshDue(null, 'manual', 0), true);
eq('due daily edge', [lists.isRefreshDue(0, 'daily', 86400000), lists.isRefreshDue(0, 'daily', 86399999)], [true, false]);
eq('manual never due', lists.isRefreshDue(0, 'manual', 1e12), false);
eq('unknown is daily', [lists.isRefreshDue(0, 'bogus', 86400000), lists.isRefreshDue(0, 'bogus', 86399999)], [true, false]);
eq('6h', lists.isRefreshDue(0, '6h', 21600000), true);

const old = lists.importBackup({ blockedArtists: ['A'], blockedKeywords: ['k'],
  blockedTracks: ['Old Song', { title: 'T', artist: 'Manual Entry' }, { title: 'U', artist: 'Band • Album' }] });
t('old backup keys', () => J(Object.keys(old)) === '["user"]' || J(Object.keys(old)));
eq('old backup user', old.user, { artists: ['A'], songs: [{ title: 'Old Song', artist: null }, { title: 'T', artist: null }, { title: 'U', artist: 'Band' }], keywords: ['k'], neverSkip: [] });
eq('old backup partial', lists.importBackup({ blockedArtists: ['A'] }).user, { artists: ['A'], songs: [], keywords: [], neverSkip: [] });
eq('old track empty artist', lists.importBackup({ blockedTracks: [{ title: 'T', artist: '' }, { title: 'V' }] }).user.songs, [{ title: 'T', artist: null }, { title: 'V', artist: null }]);

const state = {
  user: { artists: ['A'], songs: [{ title: 'S', artist: null }], keywords: ['k'], neverSkip: ['N'] },
  settings: { lookahead: 4, autoSkip: true },
  filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://x/y.json', enabled: false, mode: 'watch', builtIn: true }],
};
const exp = lists.exportBackup(state);
t('export format', () => (exp.format === 'human-music-backup' && exp.version === 1) || J(exp));
eq('round trip', lists.importBackup(JSON.parse(J(exp))), state);
const fat = lists.exportBackup({ ...state, filterLists: [{ ...state.filterLists[0], lastRefresh: 5, count: 9, lastError: 'e', artists: [{ name: 'Z' }] }] });
eq('export strips list data', fat.filterLists, state.filterLists);
t('export has no artist data', () => !J(fat).includes('"Z"') || 'artist Z leaked');
eq('own format fills user', lists.importBackup({ format: 'human-music-backup', version: 1, user: { artists: ['A'] }, settings: {}, filterLists: [] }).user,
  { artists: ['A'], songs: [], keywords: [], neverSkip: [] });

throws('empty object', () => lists.importBackup({}), 'Not a Human Music or YTM blocker backup');
throws('string', () => lists.importBackup('x'), 'Not a Human Music or YTM blocker backup');
throws('null', () => lists.importBackup(null), 'Not a Human Music or YTM blocker backup');
throws('wrong version', () => lists.importBackup({ format: 'human-music-backup', version: 2, user: {} }));

const U = (o) => ({ artists: [], songs: [], keywords: [], neverSkip: [], ...o });
eq('merge artists', lists.mergeUser(U({ artists: ['A'] }), U({ artists: ['a', 'B'] })).artists, ['A', 'B']);
eq('merge songs', lists.mergeUser(U({ songs: [{ title: 'Love', artist: null }] }),
  U({ songs: [{ title: 'love', artist: null }, { title: 'Love', artist: 'X' }] })).songs,
  [{ title: 'Love', artist: null }, { title: 'Love', artist: 'X' }]);
eq('merge all four', Object.keys(lists.mergeUser(U({}), U({ neverSkip: ['n'] }))).sort(), ['artists', 'keywords', 'neverSkip', 'songs']);

// review findings (lead, 2026-11-12)
eqf('due with undefined lastRefresh', () => lists.isRefreshDue(undefined, 'daily', 0), true);
eqf('own format without user/settings/filterLists', () => lists.importBackup({ format: 'human-music-backup', version: 1 }),
  { user: { artists: [], songs: [], keywords: [], neverSkip: [] }, settings: {}, filterLists: [] });
eqf('old tracks with empty title dropped', () => lists.importBackup({ blockedTracks: ['', '  ', { title: '', artist: 'X' }, { artist: 'Y' }, 'Keep'] }).user.songs, [{ title: 'Keep', artist: null }]);
eqf('old non-text entries dropped', () => lists.importBackup({ blockedArtists: ['A', 5, null, '', '  '], blockedKeywords: [{}, 'k'] }).user, { artists: ['A'], songs: [], keywords: ['k'], neverSkip: [] });
eqf('own non-text entries dropped', () => lists.importBackup({ format: 'human-music-backup', version: 1,
  user: { artists: [5, 'B', ''], keywords: [null], neverSkip: ['N', 3], songs: [{ title: 'S', artist: null }, { title: 7 }, null, { title: 'T', artist: 'Band' }] }, settings: {}, filterLists: [] }).user,
  { artists: ['B'], songs: [{ title: 'S', artist: null }, { title: 'T', artist: 'Band' }], keywords: [], neverSkip: ['N'] });

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
