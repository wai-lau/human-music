// Contract check (review 2026-11-17, page side, finding 6): a watch-only song is logged once a
// day, but each page update (about once a second while music plays) read the whole log (up to
// 1,000 entries) again to find that out: 180 reads, 10 MB a minute for three watched songs.
// Entries already logged today in this tab are remembered, so the log is read once each.
// Run from the repo root: node tests/contract-log-reads.check.mjs
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

await t('three watched songs in the queue: the log is read a few times a minute, not every second, and each is logged once', async () => {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, mode: 'watch', lastRefresh: 1, count: 3 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'W1' }, { name: 'W2' }, { name: 'W3' }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
    'hm.log': Array.from({ length: 999 }, (_, i) => ({ at: i, event: 'seen', title: 'x' + i, artistLine: 'y' })),
  });
  let reads = 0;
  const realGet = storage.get;
  storage.get = async (k) => { const r = await realGet(k); if (k === 'hm.log') reads++; return r; };
  const clockEl = el('span', {}, '0:00');
  const rows = [['Cur', 'Person'], ['A', 'W1'], ['B', 'W2'], ['C', 'W3']].map(([title, artist], i) => el('ytmusic-player-queue-item', { selected: i === 0 }, el('div', { class: 'song-title' }, title), el('div', { class: 'byline' }, artist)));
  const doc = makeDocument(el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'Cur'), el('div', { class: 'ytmusicTrackInfoByline' }, 'Person • Album'), clockEl), el('div', { id: 'queue' }, ...rows));
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  reads = 0;
  for (let s = 0; s < 60; s++) { clockEl.textContent = `0:${String(s).padStart(2, '0')}`; await settle(clock, 1000); await app.flush(); }
  const watched = (storage.data['hm.log'] || []).filter((e) => e.event === 'watched').map((e) => e.title).sort();
  return (reads <= 3 && J(watched) === J(['A', 'B', 'C'])) || J({ reads, watched });
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
