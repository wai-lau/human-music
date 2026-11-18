// Contract check (review 2026-11-17, page side, finding 9): the queue removal loop checked
// "paused" only when it started, so a person who switched to "No filtering" while it ran
// still lost every listed row after the first. A change to No filtering stops it before the
// next removal.
// Run from the repo root: node tests/contract-pause-mid-removal.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'];

await t('switching to No filtering mid-removal stops the removals after the current one', async () => {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const settings = { ...ctx.HM.settings.DEFAULTS, autoSkip: false };
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 3 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'L1' }, { name: 'L2' }, { name: 'L3' }] },
    'hm.settings': settings,
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const popup = el('ytmusic-menu-popup-renderer', {});
  const dropdown = el('tp-yt-iron-dropdown', { style: { display: 'none' } }, popup);
  const removed = [];
  const rows = [['Cur', 'Person'], ['A', 'L1'], ['B', 'L2'], ['C', 'L3']].map(([title, artist], i) => {
    const btn = el('button');
    const row = el('ytmusic-player-queue-item', { selected: i === 0 }, el('div', { class: 'song-title' }, title), el('div', { class: 'byline' }, artist), el('ytmusic-menu-renderer', {}, btn));
    btn.addEventListener('click', () => {
      popup.textContent = '';
      const item = el('tp-yt-paper-item', { role: 'menuitem' }, el('svg', {}, el('path', { d: ctx.HM.ytm.REMOVE_ICON })));
      item.addEventListener('click', () => { dropdown.style.display = 'none'; removed.push(title); setTimeout(() => row.remove(), 200); });
      popup.append(item); dropdown.style.display = '';
    });
    return row;
  });
  const doc = makeDocument(el('ytmusic-miniplayer', {}, el('div', { class: 'ytmusicTrackInfoTitle' }, 'Cur'), el('div', { class: 'ytmusicTrackInfoByline' }, 'Person • A')), el('div', { id: 'queue' }, ...rows), dropdown);
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  const started = app.start();
  await new Promise((r) => setTimeout(r, 30)); // the first removal is under way
  await storage.set({ 'hm.settings': { ...settings, paused: true, mode: 'off', modeChosen: true } });
  await started;
  await new Promise((r) => setTimeout(r, 1500));
  await app.flush();
  return removed.length <= 1 || J({ removed });
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
