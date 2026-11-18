// Contract check (review 2026-11-17, page side, finding 7): a list refresh that changes
// nothing (the worker rewrites the list data, then its record) made the tab log the playing
// song again ("watched" or "played" once per refresh) and showed every hidden item until the
// next pass hid it again (a flicker on each refresh).
// Run from the repo root: node tests/contract-refresh-quiet.check.mjs
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

async function refreshes(variant) {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, mode: variant === 'watch' ? 'watch' : 'act', lastRefresh: 1, count: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, autoSkip: variant !== 'autoSkipOff' },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const doc = makeDocument(
    el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'Dust on the Wind'), el('div', { class: 'ytmusicTrackInfoByline' }, 'The Velvet Sundown • Album')),
    el('ytmusic-responsive-list-item-renderer', { id: 'hid' }, el('div', { class: 'title' }, 'X'), el('a', { href: 'channel/UC1111111111111111111111' }, 'The Velvet Sundown')));
  doc.location.pathname = '/';
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  const shown = [];
  for (let i = 0; i < 3; i++) {
    await storage.set({ 'hm.list.soul-over-ai': structuredClone(storage.data['hm.list.soul-over-ai']) });
    const metas = structuredClone(storage.data['hm.filterLists']); metas[0].lastRefresh = 2 + i;
    await storage.set({ 'hm.filterLists': metas });
    await settle(clock); // the reload has run; the next pass has not
    shown.push(!doc.querySelector('#hid').hasAttribute('data-hm-hidden'));
    await settle(clock, 60); await app.flush();
  }
  return { events: (storage.data['hm.log'] || []).map((e) => e.event), shown };
}

await t('watch-only: a quiet refresh logs the playing song once, and nothing hidden is shown', async () => {
  const r = await refreshes('watch');
  // Watch-only hides nothing, so only the log is checked here.
  return r.events.filter((e) => e === 'watched').length === 1 || J(r);
});
await t('auto-skip off: a quiet refresh logs the playing song once, and the hidden item stays hidden', async () => {
  const r = await refreshes('autoSkipOff');
  return (r.events.filter((e) => e === 'seen').length === 1 && r.shown.every((s) => s === false)) || J(r);
});
await t('a song newly listed by a refresh is still acted on', async () => {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'Someone Else' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, autoSkip: false },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const doc = makeDocument(el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'Dust on the Wind'), el('div', { class: 'ytmusicTrackInfoByline' }, 'The Velvet Sundown • Album')));
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  await storage.set({ 'hm.list.soul-over-ai': { artists: [{ name: 'Someone Else' }, { name: 'The Velvet Sundown' }] } });
  await settle(clock, 60); await app.flush();
  const events = (storage.data['hm.log'] || []).map((e) => e.event);
  return J(events) === J(['seen']) || J(events);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
