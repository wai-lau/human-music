import { load, run } from './load.mjs';

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a == null || b == null) return false;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!deepEqual(a[keysA[i]], b[keysB[i]])) return false;
  }
  return true;
}

const ctx = load(['src/core/text.js', 'src/core/match.js']);
const { text, match } = ctx.HM;

run([
  ['credits split: 1950 SoulClub, 1960 SoulClub & Lewis Hanton • Album • 2025', () =>
    deepEqual(text.credits('1950 SoulClub, 1960 SoulClub & Lewis Hanton • Album • 2025'),
      ['1950 soulclub, 1960 soulclub & lewis hanton', '1950 soulclub', '1960 soulclub', 'lewis hanton'])],
  ['credits: Earth, Wind & Fire • Hits', () =>
    text.credits('Earth, Wind & Fire • Hits').includes('earth, wind & fire')],
  ['credits: Daft Punk feat. Pharrell Williams', () =>
    text.credits('Daft Punk feat. Pharrell Williams').includes('pharrell williams')],
  ['credits: empty string', () => deepEqual(text.credits(''), [])],

  ['matchSong: Velvet Sundown in filter list', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }, { name: 'After Midnight' }, { name: '10mm' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'Dust on the Wind', artistLine: 'The Velvet Sundown • Floating on Echoes • 2025' });
    return m && m.rule === 'artist' && m.listId === 'soul-over-ai' && m.entry === 'The Velvet Sundown' && m.mode === 'act';
  }],
  ['matchSong: After Midnight title is not an artist', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }, { name: 'After Midnight' }, { name: '10mm' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    return match.matchSong(idx, { title: 'After Midnight', artistLine: 'Eric Clapton • Slowhand' }) === null;
  }],
  ['matchSong: After Midnight Project is not After Midnight', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }, { name: 'After Midnight' }, { name: '10mm' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    return match.matchSong(idx, { title: 'X', artistLine: 'After Midnight Project • Album' }) === null;
  }],
  ['matchSong: 10mm matches when first in credit list', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }, { name: 'After Midnight' }, { name: '10mm' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'X', artistLine: '10mm, Someone • Album' });
    return m && m.rule === 'artist';
  }],
  ['matchSong: empty artistLine does not throw', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    return match.matchSong(idx, { title: 'X', artistLine: '' }) === null;
  }],
  ['matchSong: channel ID match', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'Other', channelId: 'UCabc' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'X', artistLine: 'Real Band • A', channelIds: ['UCabc'] });
    return m && m.rule === 'channel';
  }],
  ['matchSong: spotify ID match', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'Listed', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'X', artistLine: 'Renamed Artist • Album', channelIds: ['5ExXpwxyFXhwPKYKx6ItaN'] });
    return m && m.rule === 'channel' && m.entry === 'Listed';
  }],
  ['matchSong: unknown channel ID does not match', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'Listed', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    return match.matchSong(idx, { title: 'X', artistLine: 'Real Band • A', channelIds: ['0000000000000000000000'] }) === null;
  }],
  ['matchSong: neverSkip overrides spotify ID', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'Listed', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: ['Real Band'] }
    });
    return match.matchSong(idx, { title: 'X', artistLine: 'Real Band • A', channelIds: ['5ExXpwxyFXhwPKYKx6ItaN'] }) === null;
  }],
  ['matchSong: spotify ID in watch mode list', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'watch', name: 'Watch', enabled: true, mode: 'watch',
        artists: [{ name: 'W', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'X', artistLine: 'Z • A', channelIds: ['5ExXpwxyFXhwPKYKx6ItaN'] });
    return m && m.mode === 'watch';
  }],
  ['matchSong: spotify ID disabled list ignored', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: false, mode: 'act',
        artists: [{ name: 'Listed', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    return match.matchSong(idx, { title: 'X', artistLine: 'Z • A', channelIds: ['5ExXpwxyFXhwPKYKx6ItaN'] }) === null;
  }],

  ['matchSong: user artists (case-insensitive)', () => {
    const idx = match.buildIndex({
      filterLists: [],
      user: { artists: ['Beyoncé'], songs: [], keywords: [], neverSkip: [] }
    });
    let m1 = match.matchSong(idx, { title: 'X', artistLine: 'Beyoncé • Lemonade' });
    if (!m1 || m1.listId !== 'user:artists') return 'first failed';
    let m2 = match.matchSong(idx, { title: 'X', artistLine: 'BEYONCÉ • x' });
    return m2 && m2.listId === 'user:artists';
  }],
  ['matchSong: user keywords in title', () => {
    const idx = match.buildIndex({
      filterLists: [],
      user: { artists: [], songs: [], keywords: ['after'], neverSkip: [] }
    });
    let m1 = match.matchSong(idx, { title: 'After the Rain', artistLine: 'Someone • Album' });
    if (!m1 || m1.rule !== 'keyword') return 'first failed';
    let m2 = match.matchSong(idx, { title: 'Afterpiece', artistLine: 'Someone • Album' });
    return m2 === null;
  }],
  ['matchSong: keyword boundaries', () => {
    const idx = match.buildIndex({
      filterLists: [],
      user: { artists: [], songs: [], keywords: ['beyoncé', '米津玄師', 'panic!', 'ke$ha'], neverSkip: [] }
    });
    let m1 = match.matchSong(idx, { title: 'Beyoncés', artistLine: 'Someone • Album' });
    if (m1 !== null) return 'Beyoncés matched';
    let m2 = match.matchSong(idx, { title: 'Lemon / 米津玄師', artistLine: 'Someone • Album' });
    if (!m2 || m2.rule !== 'keyword') return 'mismatch';
    let m3 = match.matchSong(idx, { title: 'X', artistLine: 'Panic! at the Disco • x' });
    if (!m3 || m3.rule !== 'keyword') return 'panic failed';
    let m4 = match.matchSong(idx, { title: 'X', artistLine: 'Ke$ha • Animal' });
    return m4 && m4.rule === 'keyword';
  }],
  ['matchSong: user songs', () => {
    const idx = match.buildIndex({
      filterLists: [],
      user: { artists: [], songs: [{ title: 'Love', artist: 'Some Band' }], keywords: [], neverSkip: [] }
    });
    let m1 = match.matchSong(idx, { title: 'Love', artistLine: 'Some Band • A' });
    if (!m1 || m1.rule !== 'song') return 'first failed';
    let m2 = match.matchSong(idx, { title: 'love', artistLine: 'Some Band • B' });
    if (!m2 || m2.rule !== 'song') return 'second failed';
    let m3 = match.matchSong(idx, { title: 'Love', artistLine: 'Other • A' });
    if (m3 !== null) return 'third matched';
    let m4 = match.matchSong(idx, { title: 'Lovely', artistLine: 'Some Band • A' });
    return m4 === null;
  }],
  ['matchSong: user songs without artist', () => {
    const idx = match.buildIndex({
      filterLists: [],
      user: { artists: [], songs: [{ title: 'Love', artist: null }], keywords: [], neverSkip: [] }
    });
    let m = match.matchSong(idx, { title: 'Love', artistLine: 'Anyone • Album' });
    return m && m.rule === 'song';
  }],
  ['matchSong: neverSkip overrides filter list', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: ['The Velvet Sundown'] }
    });
    return match.matchSong(idx, { title: 'Dust', artistLine: 'The Velvet Sundown • Album' }) === null;
  }],
  ['matchSong: disabled filter list does not match', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: false, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    return match.matchSong(idx, { title: 'Dust', artistLine: 'The Velvet Sundown • Album' }) === null;
  }],
  ['matchSong: watch mode lists match with watch mode', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'test', name: 'Test', enabled: true, mode: 'watch',
        artists: [{ name: 'The Velvet Sundown' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'Dust', artistLine: 'The Velvet Sundown • Album' });
    return m && m.mode === 'watch';
  }],
  ['matchSong: act takes precedence over watch', () => {
    const idx = match.buildIndex({
      filterLists: [
        { id: 'watch', name: 'Watch', enabled: true, mode: 'watch',
          artists: [{ name: 'Test Artist' }] },
        { id: 'act', name: 'Act', enabled: true, mode: 'act',
          artists: [{ name: 'Test Artist' }] }
      ],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchSong(idx, { title: 'X', artistLine: 'Test Artist • Album' });
    return m && m.mode === 'act';
  }],

  ['matchItem: filter list artist', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: '1950 SoulClub' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchItem(idx, {
      title: 'EP', credits: ['1950 SoulClub', 'Lewis Hanton'], channelIds: [], featured: false
    });
    return m && m.rule === 'artist';
  }],
  ['matchItem: channel ID match', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'Art', channelId: 'UCOCi_VDTQPFn9fZtfqnpVag' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchItem(idx, {
      title: 'X', credits: ['Someone'], channelIds: ['UCOCi_VDTQPFn9fZtfqnpVag'], featured: false
    });
    return m && m.rule === 'channel';
  }],
  ['matchItem: spotify ID match', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'Listed', spotifyId: '5ExXpwxyFXhwPKYKx6ItaN' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchItem(idx, {
      title: 'EP', credits: ['Someone'], channelIds: ['5ExXpwxyFXhwPKYKx6ItaN'], featured: false
    });
    return m && m.rule === 'channel';
  }],
  ['matchItem: featured mix with one human not listed', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchItem(idx, {
      title: 'Replay Mix', credits: ['The Velvet Sundown', 'ILLENIUM'], channelIds: [], featured: true
    });
    return m === null;
  }],
  ['matchItem: featured mix with all listed', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }, { name: '10mm' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] }
    });
    const m = match.matchItem(idx, {
      title: 'Mix', credits: ['The Velvet Sundown', '10mm'], channelIds: [], featured: true
    });
    return m && m.rule === 'artist';
  }],
  ['matchItem: neverSkip overrides', () => {
    const idx = match.buildIndex({
      filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act',
        artists: [{ name: 'The Velvet Sundown' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: ['The Velvet Sundown'] }
    });
    const m = match.matchItem(idx, {
      title: 'X', credits: ['The Velvet Sundown'], channelIds: [], featured: false
    });
    return m === null;
  }],
  ['credits: no split on & or , without spaces', () =>
    deepEqual(text.credits('Simon&Garfunkel,Live • Album'), ['simon&garfunkel,live'])],
  ['empty keyword never matches', () => {
    const idx = match.buildIndex({ filterLists: [], user: { artists: [], songs: [], keywords: ['', '  '], neverSkip: [] } });
    return match.matchSong(idx, { title: 'Anything', artistLine: 'Anyone • A' }) === null;
  }],
  ['list entry with an empty name never matches', () => {
    const idx = match.buildIndex({ filterLists: [{ id: 'l', name: 'L', enabled: true, mode: 'act', artists: [{ name: '' }, {}] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] } });
    return match.matchSong(idx, { title: 'X', artistLine: ' • A' }) === null;
  }],
  ['keyword matches decomposed accents', () => {
    const idx = match.buildIndex({ filterLists: [], user: { artists: [], songs: [], keywords: ['beyoncé'], neverSkip: [] } });
    return match.matchSong(idx, { title: 'Beyoncé Live', artistLine: 'X • A' })?.rule === 'keyword';
  }],
  ['mix with your own artist counts as listed', () => {
    const idx = match.buildIndex({ filterLists: [{ id: 'l', name: 'L', enabled: true, mode: 'act', artists: [{ name: 'A' }] }],
      user: { artists: ['B'], songs: [], keywords: [], neverSkip: [] } });
    return match.matchItem(idx, { title: 'Mix', credits: ['A', 'B'], channelIds: [], featured: true })?.mode === 'act';
  }],
  ['mix with a watch-only artist is a watch match', () => {
    const idx = match.buildIndex({ filterLists: [
      { id: 'a', name: 'A', enabled: true, mode: 'act', artists: [{ name: 'A' }] },
      { id: 'w', name: 'W', enabled: true, mode: 'watch', artists: [{ name: 'B' }] }],
      user: { artists: [], songs: [], keywords: [], neverSkip: [] } });
    return match.matchItem(idx, { title: 'Mix', credits: ['A', 'B'], channelIds: [], featured: true })?.mode === 'watch';
  }],
  // Each entry matches its own kind of field (Wai, 2026-11-13: "match correct fields in
  // general, e.g. album to album, artist to artist"): keywords never hit the album or year.
  ['leadCredit: the part before the first " • "', () =>
    text.leadCredit('A & B • Album • 2025') === 'A & B' && text.leadCredit(null) === '' && text.leadCredit(' Solo ') === 'Solo'],
  ['splitNames: on ", ", " & " and " feat." in any case, empties dropped', () =>
    JSON.stringify(text.splitNames('A, B & C FEAT. D')) === '["A","B","C","D"]' && JSON.stringify(text.splitNames('')) === '[]'],
  ['keyword in the album or year of the artist line: the song plays', () => {
    const idx = match.buildIndex({ filterLists: [], user: { artists: [], songs: [], keywords: ['echoes', '2025'], neverSkip: [] } });
    return match.matchSong(idx, { title: 'Real Song', artistLine: 'Real Person • Floating on Echoes • 2025' }) === null;
  }],
  ['keyword in the title or a credited artist still matches', () => {
    const idx = match.buildIndex({ filterLists: [], user: { artists: [], songs: [], keywords: ['echoes'], neverSkip: [] } });
    const t = match.matchSong(idx, { title: 'Echoes of Rain', artistLine: 'Real Person • Album • 2025' });
    const a = match.matchSong(idx, { title: 'Song', artistLine: 'Echoes Band & Friend • Album • 2025' });
    return (t?.rule === 'keyword' && a?.rule === 'keyword') || JSON.stringify({ t, a });
  }]
]);
