// Contract check (hardening 2026-11-24): a band's name is never split into people, generic or
// shared names never match alone, an ID beats a name, a mix hides only when every artist is
// listed, an artist-less user song never hides an album card, and a stale byline never skips.
// Run from the repo root: node tests/contract-name-safety.check.mjs (tests/contracts.test.mjs runs it)
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e && e.stack || e}`); } };
const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'];
const HM = load(CORE, { setTimeout, clearTimeout }).HM;
const { match } = HM;
const EMPTY = { artists: [], songs: [], keywords: [], neverSkip: [] };
const list = (artists, extra = {}) => ({ id: 'l', name: 'L', enabled: true, mode: 'act', artists: artists.map(a => typeof a === 'string' ? { name: a } : a), ...extra });
const idx = (lists, user = {}, threshold) => match.buildIndex({ filterLists: lists, user: { ...EMPTY, ...user }, threshold });
const song = (i, title, artistLine, extra = {}) => match.matchSong(i, { title, artistLine, ...extra });
const UC1 = 'UC1111111111111111111111', UC2 = 'UC2222222222222222222222';

// 1. band names are not split into people
await t('Fire does not match Earth, Wind & Fire', () => song(idx([list(['Fire'])]), 'x', 'Earth, Wind & Fire • Album') === null || 'matched');
await t('Simon does not match Simon & Garfunkel', () => song(idx([list(['Simon'])]), 'x', 'Simon & Garfunkel • x') === null || 'matched');
await t('Tyler does not match Spotify Tyler, The Creator', () => song(idx([list(['Tyler'])]), 'x', 'Tyler, The Creator', { credits: ['Tyler, The Creator'], channelIds: ['4V8LLVI7PbaPR0K2TGSxFF'] }) === null || 'matched');
await t('Tyler does not match the text line Tyler, The Creator', () => song(idx([list(['Tyler'])]), 'x', 'Tyler, The Creator • Album') === null || 'matched');
await t('the whole band still matches', () => song(idx([list(['Earth, Wind & Fire'])]), 'x', 'Earth, Wind & Fire • Album') !== null || 'no match');
await t('linked artists match one by one (Spotify names array)', () => song(idx([list(['AI Act'])]), 'x', 'AI Act, Real Person', { credits: ['AI Act', 'Real Person'] }) !== null || 'no match');
await t('feat. still splits', () => song(idx([list(['AI Act'])]), 'x', 'Real Person feat. AI Act • A') !== null || 'no match');
await t('YTM readSong: byline links give one credit each', () => {
  const by = el('div', { class: 'ytmusicTrackInfoByline' }, el('a', { href: `channel/${UC1}` }, 'Earth'), ' & ', el('a', { href: `channel/${UC2}` }, 'AI Act'), ' • Album');
  const doc = makeDocument(el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'T'), by));
  const s = HM.ytm.readSong(doc);
  return J(s.credits) === J(['Earth', 'AI Act']) || J(s);
});
await t('Spotify readSong passes the real names array', () => {
  const doc = makeDocument(el('div', { 'data-testid': 'now-playing-widget-v2' }, el('a', { 'data-testid': 'context-item-link' }, 'Song'),
    el('div', { 'data-testid': 'now-playing-widget-v2-byline' }, el('a', { href: '/artist/4V8LLVI7PbaPR0K2TGSxFF' }, 'Tyler, The Creator'))));
  const s = HM.spotify.readSong(doc);
  return J(s.credits) === J(['Tyler, The Creator']) || J(s);
});
const textCard = line => makeDocument(el('ytmusic-two-row-item-renderer', {}, el('div', { class: 'title' }, 'Album'), el('div', { class: 'subtitle' }, line)));
await t('YTM text card: Earth, Wind & Fire is not hidden by Fire', () => {
  const [item] = HM.ytm.readPageItems(textCard('Album • Earth, Wind & Fire'), '/');
  return match.matchItem(idx([list(['Fire'])]), item) === null || 'matched';
});
await t('YTM text card: a listed whole act still hides', () => {
  const [item] = HM.ytm.readPageItems(textCard('Album • Earth, Wind & Fire'), '/');
  return match.matchItem(idx([list(['Earth, Wind & Fire'])]), item) !== null || 'no match';
});

// 2. generic names
for (const g of ['The', 'a', 'VA', 'Various Artists', 'Unknown Artist', 'Artist', 'YouTube Music', 'Spotify', 'x', '...', '!!']) {
  await t(`generic list name "${g}" is never indexed`, () => song(idx([list([g])]), 'x', `${g} • Album`) === null || 'matched');
}
await t('your own list is exempt', () => song(idx([], { artists: ['VA'] }), 'x', 'VA • A') !== null || 'no match');
await t('a generic entry still matches by ID', () => song(idx([list([{ name: 'Unknown', channelId: UC1 }])]), 'x', 'Somebody', { channelIds: [UC1] }) !== null || 'no match');

// 3. name OR ID (Wai's decision; the 2026-11-24 veto that let a second channel play was reverted 2026-11-25)
const SP_A = '4V8LLVI7PbaPR0K2TGSxFF', SP_B = 'aaaaaaaaaaaaaaaaaaaaaa';
await t('Spotify: same name, different ID still matches by name (namesakes go to Never skip)', () => song(idx([list([{ name: 'Drift', spotifyId: SP_A }])]), 'x', 'Drift', { channelIds: [SP_B] }) !== null || 'no match');
await t('Spotify: same name, same ID matches', () => song(idx([list([{ name: 'Drift', spotifyId: SP_A }])]), 'x', 'Drift', { channelIds: [SP_A] }) !== null || 'no match');
await t('Spotify: song with no ID still matches by name', () => song(idx([list([{ name: 'Drift', spotifyId: SP_A }])]), 'x', 'Drift', { channelIds: [] }) !== null || 'no match');
await t('YouTube: same name, different channel still matches (an artist has several channels)', () => song(idx([list([{ name: 'Drift', channelId: UC1 }])]), 'x', 'Drift', { channelIds: [UC2] }) !== null || 'no match');
await t('Breaking Rust: listed under one channel, linked under another, is matched', () => song(idx([list([{ name: 'Breaking Rust', channelId: 'UCODbKiVoR8lWDPl39uf803Q' }])]), 'Walk My Walk', 'Breaking Rust', { channelIds: ['UCTH2Iy0erLYQSPRILNaG2sg'] }) !== null || 'no match');
await t('verdicts: a name that is also human is ID-only', () => {
  const l = list([{ name: 'Drift', verdict: 'ai', confidence: 0.99, channelId: UC1 }, { name: 'Drift', verdict: 'human', confidence: 0.9, channelId: UC2 }], { id: 'hm-verdicts' });
  const i = idx([l], {}, 0.5);
  return (song(i, 'x', 'Drift') === null && song(i, 'x', 'Other', { channelIds: [UC1] }) !== null) || 'wrong';
});
await t('verdicts: an unsure same name is ID-only', () => {
  const l = list([{ name: 'Drift', verdict: 'ai', confidence: 0.99 }, { name: 'Drift', verdict: 'unsure', confidence: 0.4 }], { id: 'hm-verdicts' });
  return song(idx([l], {}, 0.5), 'x', 'Drift') === null || 'matched';
});
await t('verdicts: a lone ai name still matches', () => song(idx([list([{ name: 'Drift', verdict: 'ai', confidence: 0.99 }], { id: 'hm-verdicts' })], {}, 0.5), 'x', 'Drift') !== null || 'no match');

// 4. multi-credit cards are mixes
await t('YTM linked card: one of two listed does not hide', () => {
  const doc = makeDocument(el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'title-column' }, el('div', { class: 'title' }, 'Duet')),
    el('div', { class: 'secondary-flex-columns' }, 'Song • ', el('a', { href: `channel/${UC1}` }, 'AI Act'), ' & ', el('a', { href: `channel/${UC2}` }, 'Real Person'))));
  const [item] = HM.ytm.readPageItems(doc, '/search');
  const one = match.matchItem(idx([list(['AI Act'])]), item);
  const both = match.matchItem(idx([list(['AI Act', 'Real Person'])]), item);
  return (item.featured === true && one === null && both !== null) || J({ f: item.featured, one, both });
});
await t('Spotify card with two artists: one listed does not hide', () => {
  const doc = makeDocument(el('div', { 'data-encore-id': 'listRow' }, el('a', { href: `/track/${'t'.repeat(22)}` }, el('span', { 'data-encore-id': 'listRowTitle' }, 'Duet')),
    el('a', { href: `/artist/${SP_A}` }, 'AI Act'), el('a', { href: `/artist/${SP_B}` }, 'Real Person')));
  const [item] = HM.spotify.readPageItems(doc, '/');
  return (item.featured === true && match.matchItem(idx([list(['AI Act'])]), item) === null && match.matchItem(idx([list(['AI Act', 'Real Person'])]), item) !== null) || 'wrong';
});

// 5. artist-less user songs match song rows only
await t('an artist-less user song does not hide an album card', () => {
  const i = idx([], { songs: [{ title: 'Greatest Hits' }] });
  const card = extra => match.matchItem(i, { title: 'Greatest Hits', credits: ['Someone'], channelIds: [], featured: false, ...extra });
  return (card({ kind: 'other' }) === null && card({}) === null && card({ kind: 'song' }) !== null && song(i, 'Greatest Hits', 'Someone • A') !== null) || 'wrong';
});

// 6. a stale byline never skips
const rt = load(CORE, { setTimeout, clearTimeout });
runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), rt);
async function playing(initialArtist) {
  const SOA = { ...rt.HM.lists.SOUL_OVER_AI, mode: 'act', lastRefresh: 1, count: 1 };
  const storage = fakeStorage({ 'hm.filterLists': [SOA], 'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] }, 'hm.settings': { ...rt.HM.settings.DEFAULTS }, 'hm.user': { ...EMPTY } });
  const clicks = { next: 0 };
  const by = el('div', { class: 'ytmusicTrackInfoByline' }, `${initialArtist} • Album • 2025`);
  const next = el('button', { 'aria-label': 'Next' });
  next.addEventListener('click', () => { clicks.next++; });
  const doc = makeDocument(el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'New Song'), by, el('dislike-button-view-model', {}, el('button', { 'aria-pressed': 'false' })), next));
  doc.addEventListener('keydown', e => { if (e.key === 'j') clicks.next++; });
  const clock = fakeClock();
  const tick = async ms => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
  const a = rt.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await a.start(); await tick(0);
  return { a, clicks, by, tick };
}
await t('a byline that lags the title is not acted on', async () => {
  const p = await playing('The Velvet Sundown'); // still the last song's artist
  const early = p.clicks.next;
  p.by.textContent = 'Some Person • New Album • 2025'; // the byline catches up 100 ms later
  await p.tick(100); await p.tick(170); await p.tick(100); await p.tick(100);
  return (early === 0 && p.clicks.next === 0) || J({ early, next: p.clicks.next });
});
await t('a steady match is still skipped, after 150 ms', async () => {
  const p = await playing('The Velvet Sundown');
  const early = p.clicks.next;
  await p.tick(260); await p.a.flush();
  return (early === 0 && p.clicks.next === 1) || J({ early, next: p.clicks.next });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
