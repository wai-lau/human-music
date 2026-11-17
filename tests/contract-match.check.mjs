// Contract check for Task 2 (text + matching). Run from the repo root:
//   node tests/contract-match.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { load } = await import(process.cwd() + '/tests/load.mjs');
const ctx = load(['src/core/text.js', 'src/core/match.js']);
const { text, match } = ctx.HM;
const fails = [];
const J = v => JSON.stringify(v);
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = (label, fn) => { try { const r = fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const pick = m => m && { listId: m.listId, listName: m.listName, rule: m.rule, entry: m.entry, mode: m.mode };
const EMPTY = { artists: [], songs: [], keywords: [], neverSkip: [] };
const SOA = (artists, extra = {}) => ({ id: 'soul-over-ai', name: 'Soul Over AI', url: 'u', enabled: true, mode: 'act', builtIn: true,
  lastRefresh: null, count: 0, lastError: null, artists, ...extra });
const idx = (filterLists, user = {}) => match.buildIndex({ filterLists, user: { ...EMPTY, ...user } });
const ms = (i, title, artistLine, channelIds) => pick(match.matchSong(i, channelIds ? { title, artistLine, channelIds } : { title, artistLine }));

// text
eq('credits example', text.credits('1950 SoulClub, 1960 SoulClub & Lewis Hanton • Album • 2025'),
  ['1950 soulclub, 1960 soulclub & lewis hanton', '1950 soulclub', '1960 soulclub', 'lewis hanton']);
eq('credits empty', text.credits(''), []);
t('credits feat', () => text.credits('Daft Punk feat. Pharrell Williams').includes('pharrell williams') || 'missing');
t('credits non-string', () => J(text.credits(undefined)) === '[]' || 'not []');
eq('normalize', text.normalize('  Beyoncé \t  X '), 'beyoncé x');
t('wholeWord flags', () => (text.wholeWord('a').flags.includes('i') && text.wholeWord('a').flags.includes('u')) || 'flags');
t('wholeWord Beyoncés', () => !text.wholeWord('beyoncé').test('Beyoncés') || 'matched');
t('wholeWord ke$ha', () => text.wholeWord('ke$ha').test('Ke$ha • Animal') || 'no match');
t('wholeWord cjk', () => text.wholeWord('米津玄師').test('Lemon / 米津玄師') || 'no match');
t('wholeWord panic!', () => text.wholeWord('panic!').test('Panic! at the Disco • x') || 'no match');

// filter lists
const soa = idx([SOA([{ name: 'The Velvet Sundown' }, { name: 'After Midnight' }, { name: '10mm' }, { name: 'Other', channelId: 'UCabc' }])]);
eq('velvet full match', ms(soa, 'Dust on the Wind', 'The Velvet Sundown • Floating on Echoes • 2025'),
  { listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'artist', entry: 'The Velvet Sundown', mode: 'act' });
eq('title is not an artist', ms(soa, 'After Midnight', 'Eric Clapton • Slowhand'), null);
eq('exact credit only', ms(soa, 'X', 'After Midnight Project • Album'), null);
eq('10mm in list', ms(soa, 'X', '10mm, Someone • Album')?.rule, 'artist');
t('empty artist line', () => match.matchSong(soa, { title: 'X', artistLine: '' }) === null || 'not null');
t('missing artist line', () => match.matchSong(soa, { title: 'X' }) === null || 'not null');
t('missing title', () => match.matchSong(soa, { artistLine: 'Nobody • A' }) === null || 'not null');
eq('channel', ms(soa, 'X', 'Real Band • A', ['UCabc']), { listId: 'soul-over-ai', listName: 'Soul Over AI', rule: 'channel', entry: 'Other', mode: 'act' });
eq('disabled list', ms(idx([SOA([{ name: 'The Velvet Sundown' }], { enabled: false })]), 'X', 'The Velvet Sundown • A'), null);
eq('watch list', ms(idx([SOA([{ name: 'Band' }], { mode: 'watch' })]), 'X', 'Band • A')?.mode, 'watch');
eq('act beats watch', ms(idx([SOA([{ name: 'Band' }], { id: 'w', name: 'W', mode: 'watch' }), SOA([{ name: 'Band' }])]), 'X', 'Band • A')?.mode, 'act');

// user lists
eq('user artist', ms(idx([], { artists: ['Beyoncé'] }), 'X', 'BEYONCÉ • Lemonade'),
  { listId: 'user:artists', listName: 'Your artists', rule: 'artist', entry: 'Beyoncé', mode: 'act' });
eq('keyword', ms(idx([], { keywords: ['after'] }), 'After the Rain', 'Band • A'),
  { listId: 'user:keywords', listName: 'Your keywords', rule: 'keyword', entry: 'after', mode: 'act' });
eq('keyword not inside word', ms(idx([], { keywords: ['after'] }), 'Afterpiece', 'Band • A'), null);
eq('keyword in artist line', ms(idx([], { keywords: ['remix'] }), 'X', 'DJ Remix Crew • A')?.rule, 'keyword');
eq('song', ms(idx([], { songs: [{ title: 'Love', artist: 'Some Band' }] }), 'love', 'Some Band • B'),
  { listId: 'user:songs', listName: 'Your songs', rule: 'song', entry: 'Love', mode: 'act' });
eq('song other artist', ms(idx([], { songs: [{ title: 'Love', artist: 'Some Band' }] }), 'Love', 'Other • A'), null);
eq('song lovely', ms(idx([], { songs: [{ title: 'Love', artist: 'Some Band' }] }), 'Lovely', 'Some Band • A'), null);
eq('song any artist', ms(idx([], { songs: [{ title: 'Love', artist: null }] }), 'Love', 'Anyone • A')?.rule, 'song');
eq('songs before artists', ms(idx([SOA([{ name: 'Some Band' }])], { songs: [{ title: 'Love', artist: null }], artists: ['Some Band'] }), 'Love', 'Some Band • A')?.rule, 'song');
eq('user before filter list', ms(idx([SOA([{ name: 'Some Band' }])], { artists: ['Some Band'] }), 'X', 'Some Band • A')?.listId, 'user:artists');
eq('neverSkip wins', ms(idx([SOA([{ name: 'The Velvet Sundown' }])], { neverSkip: ['The Velvet Sundown'], artists: ['The Velvet Sundown'] }), 'X', 'The Velvet Sundown • A'), null);

// page items
const it = (i, title, credits, channelIds, featured) => pick(match.matchItem(i, { title, credits, channelIds, featured }));
eq('item artist', it(idx([SOA([{ name: '1950 SoulClub' }])]), 'EP', ['1950 SoulClub', 'Lewis Hanton'], [], false)?.rule, 'artist');
eq('item channel', it(idx([SOA([{ name: 'Z', channelId: 'UCOCi_VDTQPFn9fZtfqnpVag' }])]), 'X', ['Someone'], ['UCOCi_VDTQPFn9fZtfqnpVag'], false)?.rule, 'channel');
const mix = idx([SOA([{ name: 'The Velvet Sundown' }, { name: '10mm' }])]);
eq('mix with a human', it(mix, 'Replay Mix', ['The Velvet Sundown', 'ILLENIUM'], [], true), null);
eq('mix all listed', it(mix, 'Mix', ['The Velvet Sundown', '10mm'], [], true)?.rule, 'artist');
eq('mix ignores keywords', it(idx([], { keywords: ['mix'] }), 'Mix', ['A', 'B'], [], true), null);
eq('item neverSkip', it(idx([SOA([{ name: 'A' }])], { neverSkip: ['B'] }), 'X', ['A', 'B'], [], false), null);

// speed
const big = idx([SOA(Array.from({ length: 1375 }, (_, i) => ({ name: `Artist Number ${i}` })))], { keywords: ['remix', 'sped up'] });
const t0 = performance.now();
for (let i = 0; i < 2000; i++) match.matchSong(big, { title: `Song ${i}`, artistLine: `Band ${i}, Other ${i} & Third • Album • 2024` });
const avg = (performance.now() - t0) / 2000;
if (!(avg < 6)) fails.push(`speed: ${avg.toFixed(3)} ms per new song`);

// Review 2026-11-17: a song title that is only spaces must never match a row whose title is
// empty (queue rows before their text is drawn, items with no title).
{
  const idx = match.buildIndex({ filterLists: [], user: { artists: [], songs: [{ title: "   ", artist: null }, { title: '', artist: null }], keywords: [], neverSkip: [] }, threshold: null });
  const a = match.matchSong(idx, { title: '', artistLine: 'Real Person' });
  const b = match.matchItem(idx, { title: '', credits: ['Real Person'], channelIds: [], featured: false });
  if (a || b) fails.push('blank song title matched: ' + JSON.stringify({ a, b }));
}
console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : `probe ok (${avg.toFixed(3)} ms per song)`);
process.exit(fails.length ? 1 : 0);
