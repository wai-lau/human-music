// Contract check (Wai, 2026-11-21: "Add a feature to drop all UI changes like the skip button").
// One setting, plainPages (default false), shown in the popup's Behaviour tab as a switch with
// id "plain-pages", leaves the music pages looking untouched: no Block artist button on the player
// and no greyed-out rows with the skip glyph. Everything else keeps working: listed songs are still
// skipped and removed from the queue, the log still fills, and hiding listed artists on home and
// search keeps its own switch (hidePageItems). Turning it on in a running tab takes the button off
// and un-greys the rows at the next pass; turning it off puts them back.
// Interface:
//   HM.settings.DEFAULTS.plainPages === false; HM.settings.sanitize keeps a boolean plainPages and
//   turns anything else into false.
//   extension/src/content.js: the greying pass and the player-button pass both treat plainPages as off.
//   extension/popup/popup.html: <input type="checkbox" id="plain-pages"> in the Behaviour tab;
//   extension/popup/popup.js: the TOGGLES map gives 'plain-pages': 'plainPages'.
// Run from the repo root: node tests/contract-plain-pages.check.mjs
const { readFileSync } = await import('fs');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const VS = 'UCLeR-eGh2OFy9ydX7IUcOTw';
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const row = (title, artist, channel) => el('ytmusic-responsive-list-item-renderer', {},
  el('div', { class: 'left-items' }, el('ytmusic-thumbnail-renderer', { class: 'thumbnail' }, el('img'))),
  el('div', { class: 'title' }, title),
  el('a', { href: `channel/${channel}` }, artist));

// A YouTube Music page with the mini player (the song playing) and a playlist of rows.
function page(rows, { title = 'Fine', artist = 'Some Person' } = {}) {
  const clicks = { next: 0 };
  const ti = el('div', { class: 'ytmusicTrackInfoTitle' }, title);
  const by = el('div', { class: 'ytmusicTrackInfoByline' }, `${artist} • Album • 2025`);
  const setSong = (a, b) => { ti.textContent = a; by.textContent = `${b} • Album • 2025`; };
  // clicks.next counts every Next, by button or by YouTube Music's 'j' shortcut (which the skip uses).
  const goNext = () => { clicks.next++; setSong(`Next ${clicks.next}`, 'Some Person'); };
  const next = el('button', { 'aria-label': 'Next' });
  next.addEventListener('click', goNext);
  const doc = makeDocument(el('ytmusic-miniplayer', {}, ti, by, next), el('div', { id: 'contents' }, ...rows));
  doc.addEventListener('keydown', (e) => { if (e.key === 'j') goNext(); });
  doc.location.hostname = 'music.youtube.com';
  doc.location.pathname = '/playlist';
  return { doc, clicks, setSong };
}
async function start(p, settings = {}) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, enabled: true, mode: 'act', lastRefresh: 1 }],
    // By name: the mini player shows only the artist's name (the rows also link the channel).
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, ...settings },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc: p.doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  return { ctx, storage, clock, app };
}
const marked = (r) => r.hasAttribute('data-hm-marked');
const button = (doc) => !!doc.querySelector('#hm-player-buttons');

const HM = load(['src/core/settings.js']).HM;
await t('settings: plainPages defaults to false; sanitize keeps a boolean, else false', () =>
  (HM.settings.DEFAULTS.plainPages === false && HM.settings.sanitize({ plainPages: true }).plainPages === true
    && HM.settings.sanitize({ plainPages: 'yes' }).plainPages === false && HM.settings.sanitize({}).plainPages === false)
  || J([HM.settings.DEFAULTS.plainPages, HM.settings.sanitize({ plainPages: true }).plainPages, HM.settings.sanitize({ plainPages: 'yes' }).plainPages]));

await t('plainPages off (the default): a listed row is greyed and the button is there', async () => {
  const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
  const p = page([r]);
  await start(p);
  return (marked(r) && button(p.doc)) || J({ marked: marked(r), button: button(p.doc) });
});
await t('plainPages on: no greyed row, no button', async () => {
  const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
  const p = page([r]);
  await start(p, { plainPages: true, playerButtons: true });
  return (!marked(r) && !r.querySelector('.hm-mark') && !button(p.doc)) || J({ marked: marked(r), glyph: !!r.querySelector('.hm-mark'), button: button(p.doc) });
});
await t('turned on in a running tab: the button goes and the row is put back; turned off: both return', async () => {
  const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
  const p = page([r]);
  const s = await start(p);
  const before = marked(r) && button(p.doc);
  await s.storage.set({ 'hm.settings': { ...s.ctx.HM.settings.DEFAULTS, plainPages: true } });
  await settle(s.clock, 2000); await settle(s.clock, 100); await s.app.flush();
  const plain = !marked(r) && !r.querySelector('.hm-mark') && !button(p.doc);
  await s.storage.set({ 'hm.settings': { ...s.ctx.HM.settings.DEFAULTS, plainPages: false } });
  await settle(s.clock, 2000); await settle(s.clock, 100); await s.app.flush();
  const back = marked(r) && button(p.doc);
  return (before && plain && back) || J({ before, plain, back });
});
await t('plainPages on: a listed song playing is still skipped', async () => {
  const p = page([], { title: 'Dust on the Wind', artist: 'The Velvet Sundown' });
  await start(p, { plainPages: true });
  return p.clicks.next === 1 || 'next ' + p.clicks.next;
});
await t('popup: a Plain pages switch in Behaviour, saved as plainPages', () => {
  const html = readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8');
  const js = readFileSync(process.cwd() + '/extension/popup/popup.js', 'utf8');
  const behaviour = html.slice(html.indexOf('id="tab-behaviour"'));
  return (/<input type="checkbox" id="plain-pages">/.test(behaviour) && /'plain-pages':\s*'plainPages'/.test(js)) || 'missing switch or mapping';
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
