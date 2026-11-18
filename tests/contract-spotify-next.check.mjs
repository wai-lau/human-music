// Contract check (review 2026-11-17, page side, findings 4 and 12): two ways Spotify could act
// on a person's song.
// 1. Spotify's "key" for Next is the Next button itself (scripted keys are ignored), so the
//    skipper's 750 ms fallback pressed Next a second time whenever Spotify took longer than
//    that to show the next song: the person's song after it was skipped too. On Spotify one
//    press is all, and nothing seeks while the next song is still on its way (up to 2 s here).
// 2. A search row's title is the track's name, not an artist: a person's track called
//    "Closure" (a name on Soul Over AI) was read as credited to Closure.
// Run from the repo root: node tests/contract-spotify-next.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const LISTED = 'LISTEDLISTEDLISTEDLIST';

async function slowSpotify(lag) {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'Listed Act', spotifyId: LISTED }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, lookahead: 0 },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const songs = [['AI Song', 'Listed Act', LISTED], ['Person 1', 'Some Person', 'PERSONPERSONPERSONPERS'], ['Person 2', 'Other Person', 'OTHEROTHEROTHEROTHEROT']];
  let cur = 0; let nexts = 0; let target = 0; let seeks = 0;
  const title = el('a', { 'data-testid': 'context-item-link' }, songs[0][0]);
  const byline = el('div', { 'data-testid': 'context-item-info-subtitles' });
  const show = () => { const [tt, a, id] = songs[cur]; title.textContent = tt; byline.textContent = ''; byline.append(el('a', { href: '/artist/' + id }, a)); };
  show();
  const next = el('button', { 'data-testid': 'control-button-skip-forward' });
  next.addEventListener('click', () => { nexts++; target = Math.min(target + 1, songs.length - 1); const to = target; clock.setTimeout(() => { cur = Math.max(cur, to); show(); }, lag); });
  const range = el('input', { type: 'range', max: '200000' });
  range.addEventListener('change', () => { seeks++; });
  const video = el('video');
  Object.defineProperty(video, 'paused', { get: () => false });
  Object.defineProperty(video, 'currentTime', { get: () => 1 + clock.now() / 1000, set() {} });
  const doc = makeDocument(el('div', { 'data-testid': 'now-playing-widget' }, title, byline), next, video,
    el('div', { 'data-testid': 'playback-duration' }, '3:20'), el('div', { 'data-testid': 'playback-progressbar' }, range));
  doc.location.hostname = 'open.spotify.com';
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => clock.now(), site: ctx.HM.spotify });
  await app.start();
  for (let i = 0; i < 60; i++) await settle(clock, 100);
  await app.flush();
  return { nexts, seeks, playing: songs[cur][0] };
}

for (const lag of [300, 800, 1200, 2000]) {
  await t(`Spotify taking ${lag} ms to show the next song: one Next, no seek, the person's song plays`, async () => {
    const r = await slowSpotify(lag);
    return (r.nexts === 1 && r.seeks === 0 && r.playing === 'Person 1') || J(r);
  });
}

await t('a Spotify search row titled like a listed artist is credited only to its linked artist', () => {
  const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/page/common.js', 'src/page/spotify.js']).HM;
  const index = HM.match.buildIndex({ filterLists: [{ id: 'soul-over-ai', name: 'Soul Over AI', enabled: true, mode: 'act', artists: [{ name: 'Closure', spotifyId: 'CLOSURECLOSURECLOSUREC' }] }], user: HM.store.emptyUser(), threshold: null });
  const row = el('div', { 'data-encore-id': 'listRow' }, el('div', { 'data-encore-id': 'listRowTitle' }, 'Closure'), el('a', { href: '/artist/PERSONPERSONPERSONPERS' }, 'Some Person'));
  const items = HM.spotify.readPageItems(makeDocument(el('main', {}, row)), '/search/closure');
  const got = items.map((i) => ({ credits: i.credits, ids: i.channelIds, match: HM.match.matchItem(index, i) }));
  return (got.length === 1 && J(got[0].credits) === J(['Some Person']) && J(got[0].ids) === J(['PERSONPERSONPERSONPERS']) && got[0].match === null) || J(got);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
