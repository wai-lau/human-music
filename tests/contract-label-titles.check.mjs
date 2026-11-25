// Contract: Spotify-labelled verdicts match by name AND a known song on YouTube Music (Wai,
// 2026-11-25, "A"). Run from the repo root: node tests/contract-label-titles.check.mjs
//   Published entry: { labelName, verdict: 'ai', confidence, checked, spotifyId, titles: [...] } with
//     NO plain `name` (older copies drop such an entry instead of matching its name).
//   lists.js parseFilterList: keeps such an entry as { name: labelName, spotifyId, titles, verdict, confidence }.
//   match.js, YouTube Music: name matches only with a title equal (normalised: case, punctuation,
//     feat. and bracket suffixes) to a known one; a song row, the playing song or a queue row uses its
//     own title; an artist card uses the song titles shown inside it (item.innerTitles). No titles
//     known: no name match. Spotify (index site 'spotify'): ID match and name match as before.
//   ytm.js readPageItems: a top-result card exposes innerTitles; a song row exposes songTitle.
//   content.js: a tagged song reported by the dev copy carries songTitles (its own title).
//   The v0.1.8 parser and matcher never match a published entry by name.
import { execFileSync } from 'child_process';
import { runInContext, createContext } from 'vm';
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

const SP = 'S'.repeat(22);
const published = { labelName: 'Velvet Ghost', verdict: 'ai', confidence: 100, checked: '2026-11-25', spotifyId: SP, titles: ['Midnight Rain', 'Echoes'] };
const plain = { name: 'Plain Bot', verdict: 'ai', confidence: 100, checked: '2026-11-25' };
const empty = { labelName: 'Quiet Ghost', verdict: 'ai', confidence: 100, checked: '2026-11-25', spotifyId: 'Q'.repeat(22), titles: [] };

const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/page/common.js', 'src/page/ytm.js']).HM;
const list = HM.lists.parseFilterList({ name: 'Human Music verdicts', artists: [published, plain, empty] });
const mk = (site) => HM.match.buildIndex({ filterLists: [{ id: 'hm-verdicts', name: 'Human Music verdicts', enabled: true, mode: 'act', artists: list.artists }], user: HM.store.emptyUser(), threshold: 90, ...(site ? { site } : {}) });
const ytm = mk('ytm');
const song = (title, name = 'Velvet Ghost', extra = {}) => ({ title, artistLine: name, credits: [name], channelIds: [], ...extra });
const hit = (m) => (m ? m.mode : null);

await t('parser keeps a published entry: labelName becomes the name, titles and ID kept', () => {
  const a = list.artists.find((x) => x.spotifyId === SP) || {};
  return (a.name === 'Velvet Ghost' && J(a.titles) === J(['Midnight Rain', 'Echoes']) && a.verdict === 'ai' && a.confidence === 100) || J(list.artists);
});
await t('parser: a plain entry has no titles and the other entries are kept', () => {
  const a = list.artists.find((x) => x.name === 'Plain Bot') || {};
  return (!('titles' in a) && list.artists.length === 3) || J(list.artists);
});
await t('YTM: name plus a known title matches', () => hit(HM.match.matchSong(ytm, song('Midnight Rain'))) === 'act' || 'no match');
await t('YTM: title with feat. and a (Lyrics) bracket and other case still matches', () =>
  hit(HM.match.matchSong(ytm, song('midnight rain (feat. Someone) [Lyrics]'))) === 'act' || 'no match');
await t('YTM: name plus an unknown title plays', () => HM.match.matchSong(ytm, song('Brand New Song')) === null || 'matched');
await t('YTM: a namesake with other songs plays', () => HM.match.matchSong(ytm, song('Sunday Morning')) === null || 'matched');
await t('YTM: a title known for another artist does not hide this name', () => HM.match.matchSong(ytm, song('Midnight Rain', 'Someone Else')) === null || 'matched');
await t('YTM: an entry with no titles known never matches by name', () => HM.match.matchSong(ytm, song('Anything', 'Quiet Ghost')) === null || 'matched');
await t('YTM: a song row (kind song) with a known title hides', () =>
  hit(HM.match.matchItem(ytm, song('Echoes', 'Velvet Ghost', { kind: 'song', songTitle: 'Echoes' }))) === 'act' || 'no match');
await t('YTM: a card whose own title equals a known song is not a song row: plays', () =>
  HM.match.matchItem(ytm, song('Echoes', 'Velvet Ghost', { kind: 'other' })) === null || 'matched');
await t('YTM: an artist card showing a known song inside hides', () =>
  hit(HM.match.matchItem(ytm, { title: 'Velvet Ghost', credits: ['Velvet Ghost'], channelIds: [], featured: false, innerTitles: ['Other', 'Echoes'] })) === 'act' || 'no match');
await t('YTM: an artist card showing only unknown songs plays', () =>
  HM.match.matchItem(ytm, { title: 'Velvet Ghost', credits: ['Velvet Ghost'], channelIds: [], featured: false, innerTitles: ['Other'] }) === null || 'matched');
await t('YTM: an artist card with no inner songs plays', () =>
  HM.match.matchItem(ytm, { title: 'Velvet Ghost', credits: ['Velvet Ghost'], channelIds: [], featured: false }) === null || 'matched');
await t('Spotify: the Spotify ID matches without any title', () => {
  const sp = mk('spotify');
  return hit(HM.match.matchSong(sp, { title: 'Unknown', artistLine: 'Other Name', credits: ['Other Name'], channelIds: [SP] })) === 'act' || 'no match';
});
await t('Spotify: the name still matches as before', () => hit(HM.match.matchSong(mk('spotify'), song('Brand New Song'))) === 'act' || 'no match');
await t('other verdicts are unchanged: a plain verdict matches by name alone', () => hit(HM.match.matchSong(ytm, song('Whatever', 'Plain Bot'))) === 'act' || 'no match');

// Page reading
const shelf = el('ytmusic-card-shelf-renderer', {},
  el('div', { class: 'title' }, el('a', { href: 'channel/UC1111111111111111111111' }, 'Velvet Ghost')),
  el('div', { class: 'subtitle' }, 'Artist • 2M subscribers'),
  el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'title' }, 'Echoes'), el('div', { class: 'secondary-flex-columns' }, 'Song • Velvet Ghost')),
  el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'title' }, 'Midnight Rain'), el('div', { class: 'secondary-flex-columns' }, 'Song • Velvet Ghost')));
const doc = makeDocument(shelf);
const items = HM.ytm.readPageItems(doc, '/search');
await t('ytm readPageItems: the card exposes the song titles inside it', () => {
  const card = items.find((i) => i.title === 'Velvet Ghost') || {};
  return J(card.innerTitles) === J(['Echoes', 'Midnight Rain']) || J(items.map((i) => [i.title, i.innerTitles]));
});
await t('ytm readPageItems: a song row inside names its title as a song', () => {
  const row = items.find((i) => i.title === 'Echoes') || {};
  return row.songTitle === 'Echoes' || J(row);
});
await t('ytm readPageItems: an album row is no song title', () => {
  const album = makeDocument(el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'title' }, 'Echoes'), el('div', { class: 'secondary-flex-columns' }, 'Album • Velvet Ghost')));
  const r = HM.ytm.readPageItems(album, '/search')[0] || {};
  return !r.songTitle || J(r);
});

// Dev report
const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
async function startReport(songRow) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const H = ctx.HM;
  const site = {
    readSong: () => songRow, readQueue: () => [], clickNext() {}, pressNextKey() {}, clickDislike: () => false, videoDuration: () => NaN,
    videoState: () => null, seekTo() {}, removeQueueRow: async () => false, mountPlayerButtons: () => null,
    readPageItems: () => [], hideItem() {}, unhideAll() {}, readListRows: () => [], markRow() {}, unmarkRow() {},
  };
  const storage = fakeStorage({
    'hm.filterLists': [{ ...H.lists.SPOTIFY_AI_LABEL, lastRefresh: 1 }],
    'hm.settings': { ...H.settings.DEFAULTS, investigate: true, mode: 'lists', modeChosen: true },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const batches = [];
  const app = H.createApp({ doc: makeDocument(), storage, timers: clock, now: () => 1_700_000_000_000 + clock.now(), site, onUnknown: (x) => batches.push(structuredClone(x)) });
  await app.start(); await settle(clock, 60);
  return batches.flat();
}
await t('dev report: the tagged song\'s own title goes along as songTitles', async () => {
  const sent = await startReport({ title: 'Dust', artistLine: 'Label Act', credits: ['Label Act'], channelIds: [SP], aiTagged: ['Label Act'], aiTaggedIds: [SP] });
  const i = sent.find((x) => x.spotifyAiLabel) || {};
  return (J(i.songTitles) === J(['Dust'])) || J(sent);
});
await t('dev report: a title over 200 characters is cut', async () => {
  const sent = await startReport({ title: 'x'.repeat(300), artistLine: 'Label Act', credits: ['Label Act'], channelIds: [SP], aiTagged: ['Label Act'], aiTaggedIds: [SP] });
  const i = sent.find((x) => x.spotifyAiLabel) || {};
  return (Array.isArray(i.songTitles) && i.songTitles.length === 1 && i.songTitles.every((s) => s.length <= 200)) || J(sent).slice(0, 200);
});

// The v0.1.8 copy: an entry as published must never match by name.
let old = null;
try {
  const ctx = createContext({ console });
  for (const f of ['text', 'store', 'match', 'lists']) runInContext(execFileSync('git', ['show', `v0.1.8:extension/src/core/${f}.js`], { encoding: 'utf8' }), ctx);
  old = ctx.HM;
} catch (e) { fails.push('could not load the v0.1.8 files from the repo: ' + e.message); }
if (old) {
  await t('v0.1.8 copy: a published entry never matches by name', () => {
    const l = old.lists.parseFilterList(JSON.parse(J({ artists: [published] })));
    const idx = old.match.buildIndex({ filterLists: [{ id: 'hm-verdicts', name: 'v', enabled: true, mode: 'act', artists: l ? l.artists : [] }], user: old.store.emptyUser(), threshold: 90 });
    const byName = old.match.matchSong(idx, { title: 'Brand New Song', artistLine: 'Velvet Ghost', credits: ['Velvet Ghost'], channelIds: [] });
    const asItem = old.match.matchItem(idx, { title: 'Velvet Ghost', credits: ['Velvet Ghost'], channelIds: [], featured: false });
    return (byName === null && asItem === null) || J([byName, asItem]);
  });
}

console.log(fails.length ? fails.map((f) => 'FAIL ' + f).join('\n') : 'ok');
process.exit(fails.length ? 1 : 0);
