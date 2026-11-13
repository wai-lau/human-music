// Contract check for Task 8b (content wiring: hiding page items, player buttons). Run from the repo root:
//   node tests/contract-content-hide.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e && e.stack || e}`); } };
const CORE = ['src/core/text.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/ytm.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

function boot({ settings = {}, user = {}, artists = ['The Velvet Sundown', '1950 SoulClub', '10mm'], mode = 'act' } = {}) {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  const SOA = { ...ctx.HM.lists.SOUL_OVER_AI, mode, lastRefresh: 1, count: artists.length };
  const storage = fakeStorage({
    'hm.filterLists': [SOA],
    'hm.list.soul-over-ai': { artists: artists.map(name => ({ name })) },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, lookahead: 0, ...settings },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [], ...user },
  });
  return { ctx, storage };
}

const card = (title, subtitle) => el('ytmusic-two-row-item-renderer', {}, el('div', { class: 'title' }, title), el('div', { class: 'subtitle' }, subtitle));
function page({ path = '/search', title = 'Fine Song', artist = 'Some Person', items = [] } = {}) {
  const clicks = { next: 0 };
  const ti = el('div', { class: 'ytmusicTrackInfoTitle' }, title);
  const by = el('div', { class: 'ytmusicTrackInfoByline' }, `${artist} • Album • 2025`);
  const next = el('button', { 'aria-label': 'Next' });
  const goNext = () => { clicks.next++; ti.textContent = `Next ${clicks.next}`; by.textContent = 'Someone Else • X'; };
  next.addEventListener('click', goNext);
  const doc = makeDocument(el('ytmusic-miniplayer', {}, ti, by, el('dislike-button-view-model', {}, el('button', { 'aria-pressed': 'false' })), next),
    el('div', { id: 'contents' }, ...items));
  doc.location.pathname = path;
  doc.addEventListener('keydown', e => { if (e.key === 'j') goNext(); });
  return { doc, clicks };
}
async function app(b, p, clock = fakeClock()) {
  const a = b.ctx.HM.createApp({ doc: p.doc, storage: b.storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await a.start();
  await settle(clock, 60);
  await a.flush();
  return { a, clock };
}
const log = b => b.storage.data['hm.log'] || [];
const hidden = p => [...p.doc.querySelectorAll('[data-hm-hidden]')].map(e => e.querySelector('.title').textContent);
const pass = async ({ a, clock }, p) => { p.doc.body.append(el('span')); await settle(clock, 60); await a.flush(); };

await t('search: listed artist hidden, logged once', async () => {
  const b = boot(); const p = page({ items: [card('Midnight Bloom', 'EP • 1950 SoulClub, 1960 SoulClub & Lewis Hanton • 2025'), card('Otis Blue', 'Album • Otis Redding')] });
  const r = await app(b, p);
  await pass(r, p); await pass(r, p);
  const hid = log(b).filter(e => e.event === 'hidden');
  return (J(hidden(p)) === J(['Midnight Bloom']) && hid.length === 1 && hid[0].title === 'Midnight Bloom' && hid[0].listName === 'Soul Over AI') || J({ hidden: hidden(p), log: log(b) });
});
await t('logged once a day even after unhide and hide again', async () => {
  const b = boot(); const p = page({ items: [card('X', 'Album • 10mm')] });
  const r = await app(b, p);
  await b.storage.set({ 'hm.settings': { ...b.ctx.HM.settings.DEFAULTS, lookahead: 0, paused: true } }); await settle(r.clock, 60);
  await b.storage.set({ 'hm.settings': { ...b.ctx.HM.settings.DEFAULTS, lookahead: 0, paused: false } }); await settle(r.clock, 60); await r.a.flush();
  return (J(hidden(p)) === J(['X']) && log(b).filter(e => e.event === 'hidden').length === 1) || J({ hidden: hidden(p), log: log(b).map(e => e.event) });
});
await t('watch list never hides', async () => {
  const b = boot({ mode: 'watch' }); const p = page({ items: [card('X', 'Album • 10mm')] });
  await app(b, p);
  return J(hidden(p)) === '[]' || J(hidden(p));
});
await t('paused shows everything again', async () => {
  const b = boot(); const p = page({ items: [card('X', 'Album • 10mm')] });
  const r = await app(b, p);
  const before = J(hidden(p));
  await b.storage.set({ 'hm.settings': { ...b.ctx.HM.settings.DEFAULTS, paused: true } }); await settle(r.clock, 60);
  const item = p.doc.querySelector('ytmusic-two-row-item-renderer');
  return (before === J(['X']) && J(hidden(p)) === '[]' && item.hidden === false) || J({ before, after: hidden(p) });
});
await t('hiding switched off shows everything; off from the start hides nothing', async () => {
  const b = boot(); const p = page({ items: [card('X', 'Album • 10mm')] });
  const r = await app(b, p);
  await b.storage.set({ 'hm.settings': { ...b.ctx.HM.settings.DEFAULTS, hidePageItems: false } }); await settle(r.clock, 60);
  const b2 = boot({ settings: { hidePageItems: false } }); const p2 = page({ items: [card('X', 'Album • 10mm')] });
  await app(b2, p2);
  return (J(hidden(p)) === '[]' && J(hidden(p2)) === '[]') || J([hidden(p), hidden(p2)]);
});
await t('never skip after hiding shows it again', async () => {
  const b = boot(); const p = page({ items: [card('X', 'Album • 10mm')] });
  const r = await app(b, p);
  await b.storage.set({ 'hm.user': { artists: [], songs: [], keywords: [], neverSkip: ['10mm'] } }); await settle(r.clock, 60);
  return J(hidden(p)) === '[]' || J(hidden(p));
});
await t('other pages untouched', async () => {
  const b = boot(); const p = page({ path: '/browse/MPREb_x', items: [card('X', 'Album • 10mm')] });
  await app(b, p);
  return J(hidden(p)) === '[]' || J(hidden(p));
});
await t('mix with a person in it stays', async () => {
  const b = boot(); const p = page({ path: '/', items: [card('Replay Mix', 'The Velvet Sundown, ILLENIUM'), card('All AI Mix', 'The Velvet Sundown, 10mm')] });
  await app(b, p);
  return J(hidden(p)) === J(['All AI Mix']) || J(hidden(p));
});
await t('player buttons: Block artist adds the whole credit, then skips', async () => {
  const b = boot({ artists: [] }); const p = page({ title: 'Song', artist: 'Band A & Band B' });
  const r = await app(b, p);
  const btns = [...p.doc.querySelectorAll('#hm-player-buttons button')];
  if (btns.length !== 1) return `buttons ${btns.length}`;
  btns.find(x => x.getAttribute('aria-label') === 'Block artist').click();
  await settle(r.clock, 60); r.a.checkPlaying(); await r.a.flush();
  return (J(b.storage.data['hm.user'].artists) === J(['Band A & Band B']) && p.clicks.next === 1) || J({ user: b.storage.data['hm.user'], next: p.clicks.next });
});
await t('only a Block artist button (no Block song)', async () => {
  const b = boot(); const p = page({ title: 'Song', artist: 'Band A' });
  await app(b, p);
  const labels = [...p.doc.querySelectorAll('#hm-player-buttons button')].map(x => x.getAttribute('aria-label'));
  return J(labels) === J(['Block artist']) || J(labels);
});
await t('player buttons off: none, and turning off removes them', async () => {
  const b = boot({ settings: { playerButtons: false } }); const p = page();
  await app(b, p);
  const none = p.doc.querySelectorAll('#hm-player-buttons').length === 0;
  const b2 = boot(); const p2 = page();
  const r2 = await app(b2, p2);
  const had = p2.doc.querySelectorAll('#hm-player-buttons').length === 1;
  await b2.storage.set({ 'hm.settings': { ...b2.ctx.HM.settings.DEFAULTS, playerButtons: false } }); await settle(r2.clock, 60);
  return (none && had && p2.doc.querySelectorAll('#hm-player-buttons').length === 0) || J({ none, had });
});
await t('hiding pass over 100 items under 30 ms', async () => {
  const b = boot({ artists: Array.from({ length: 1375 }, (_, i) => `Listed ${i}`) });
  const items = Array.from({ length: 100 }, (_, i) => card(`Item ${i}`, `Album • Person ${i}, Other ${i}`));
  const p = page({ path: '/', items });
  const r = await app(b, p);
  const t0 = performance.now(); await pass(r, p); const ms = performance.now() - t0;
  return ms < 30 + 20 || `${ms.toFixed(1)} ms (includes ~20 ms of test settling)`;
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
