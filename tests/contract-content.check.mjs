// Contract check for Task 8a (content wiring: storage, playing song, lookahead, log). Run from the repo root:
//   node tests/contract-content.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e && e.stack || e}`); } };
const REMOVE = 'M9 .75a8.25 8.25 0 100 16.5A8.25 8.25 0 009 .75Zm0 1.5a6.75 6.75 0 110 13.5 6.75 6.75 0 010-13.5Zm3 6H6a.75.75 0 000 1.5h6a.75.75 0 100-1.5Z';
const CORE = ['src/core/text.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/ytm.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

function boot({ settings = {}, user = {}, artists = ['The Velvet Sundown', 'After Midnight', '10mm'], mode = 'act', extraLists = [] } = {}) {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  let builds = 0;
  const real = ctx.HM.match.buildIndex;
  ctx.HM.match.buildIndex = (...a) => { builds++; return real(...a); };
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const SOA = { ...ctx.HM.lists.SOUL_OVER_AI, mode, lastRefresh: 1, count: artists.length };
  const storage = fakeStorage({
    'hm.filterLists': [SOA, ...extraLists.map(l => l.meta)],
    'hm.list.soul-over-ai': { artists: artists.map(name => ({ name })) },
    ...Object.fromEntries(extraLists.map(l => [`hm.list.${l.meta.id}`, { artists: l.artists.map(name => ({ name })) }])),
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, ...settings },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [], ...user },
  });
  return { ctx, storage, builds: () => builds };
}

function page({ title = 'Dust on the Wind', artist = 'The Velvet Sundown', queue = [], nextMoves = true } = {}) {
  const clicks = { next: 0, dislike: 0, removed: [] };
  const ti = el('div', { class: 'ytmusicTrackInfoTitle' }, title);
  const by = el('div', { class: 'ytmusicTrackInfoByline' }, `${artist} • Album • 2025`);
  const setSong = (a, b) => { ti.textContent = a; by.textContent = `${b} • Album • 2025`; };
  const next = el('button', { 'aria-label': 'Next' });
  next.addEventListener('click', () => { clicks.next++; if (nextMoves) setSong(`Next ${clicks.next}`, 'Some Person'); });
  const dis = el('button', { 'aria-pressed': 'false' });
  dis.addEventListener('click', () => { clicks.dislike++; dis.setAttribute('aria-pressed', 'true'); });
  const popup = el('ytmusic-menu-popup-renderer', {});
  const dropdown = el('tp-yt-iron-dropdown', { style: { display: 'none' } }, popup);
  const rows = queue.map(([qt, qa], i) => {
    const menuBtn = el('button');
    const row = el('ytmusic-player-queue-item', { selected: i === 0 }, el('div', { class: 'song-title' }, qt), el('span', { class: 'byline' }, `${qa} • 3:00`), el('ytmusic-menu-renderer', {}, menuBtn));
    menuBtn.addEventListener('click', () => {
      popup.textContent = '';
      const item = el('tp-yt-paper-item', { role: 'menuitem' }, el('svg', {}, el('path', { d: REMOVE })));
      item.addEventListener('click', () => { dropdown.style.display = 'none'; clicks.removed.push(qt); setTimeout(() => row.remove(), 20); });
      popup.append(item);
      dropdown.style.display = '';
    });
    return row;
  });
  const doc = makeDocument(el('ytmusic-miniplayer', {}, ti, by, el('dislike-button-view-model', {}, dis), next), el('div', { id: 'queue' }, ...rows), dropdown);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') dropdown.style.display = 'none'; });
  return { doc, clicks, setSong, queueTitles: () => [...doc.querySelectorAll('#queue ytmusic-player-queue-item')].map(r => r.querySelector('.song-title').textContent) };
}

async function app(b, p, clock = fakeClock()) {
  const a = b.ctx.HM.createApp({ doc: p.doc, storage: b.storage, timers: clock, now: () => 1_700_000_000_000 + clock.now() });
  await a.start();
  await settle(clock);
  return { a, clock };
}
const log = b => b.storage.data['hm.log'] || [];
// start() may already be running a lookahead pass; give real-time menu polling room, then run again.
const drain = async a => { await new Promise(r => setTimeout(r, 900)); await a.runLookahead(); await a.flush(); };

if (typeof load(CORE.concat('src/content.js'), { setTimeout, clearTimeout }).HM.createApp !== 'function') fails.push('HM.createApp missing (or content.js threw on load without chrome)');
else {
  await t('listed song playing: Next once, log skipped', async () => {
    const b = boot(); const p = page();
    const { a } = await app(b, p); await a.flush();
    const l = log(b);
    return (p.clicks.next === 1 && l.length === 1 && l[0].event === 'skipped' && l[0].listName === 'Soul Over AI' && l[0].title === 'Dust on the Wind') || J({ clicks: p.clicks, l });
  });
  await t('autoDislike: dislike, log disliked', async () => {
    const b = boot({ settings: { autoDislike: true } }); const p = page();
    const { a } = await app(b, p); await a.flush();
    return (p.clicks.dislike === 1 && log(b)[0]?.event === 'disliked') || J({ clicks: p.clicks, l: log(b) });
  });
  await t('autoSkip off: no Next, log seen', async () => {
    const b = boot({ settings: { autoSkip: false } }); const p = page();
    const { a } = await app(b, p); await a.flush();
    return (p.clicks.next === 0 && log(b)[0]?.event === 'seen') || J({ clicks: p.clicks, l: log(b) });
  });
  await t('paused: nothing at all', async () => {
    const b = boot({ settings: { paused: true } }); const p = page({ queue: [['Cur', 'Someone'], ['B', '10mm']] });
    const { a } = await app(b, p); await a.runLookahead(); await a.flush();
    return (p.clicks.next === 0 && p.clicks.removed.length === 0 && log(b).length === 0) || J({ clicks: p.clicks, l: log(b) });
  });
  await t('same song checked 50 times: one log line', async () => {
    const b = boot({ settings: { autoSkip: false } }); const p = page();
    const { a } = await app(b, p);
    for (let i = 0; i < 50; i++) a.checkPlaying();
    await a.flush();
    return log(b).length === 1 || `log ${log(b).length}`;
  });
  await t('blocked song comes back: skipped again', async () => {
    const b = boot(); const p = page();
    const { a, clock } = await app(b, p);
    await settle(clock, 300); // skipper sees the change and finishes
    p.setSong('Dust on the Wind', 'The Velvet Sundown');
    await settle(clock, 60); // mutation -> pass
    a.checkPlaying();
    await a.flush();
    return (p.clicks.next === 2 && log(b).filter(e => e.event === 'skipped').length === 2) || J({ clicks: p.clicks, l: log(b).map(e => e.event) });
  });
  await t('a page change alone triggers the check', async () => {
    const b = boot(); const p = page({ title: 'Fine', artist: 'Some Person' });
    const { a, clock } = await app(b, p);
    p.setSong('Dust on the Wind', 'The Velvet Sundown');
    await settle(clock, 60);
    return p.clicks.next === 1 || `next ${p.clicks.next}`;
  });
  await t('lookahead removes B and C, keeps D; E moves into range and goes too (rows shift)', async () => {
    const b = boot(); const p = page({ title: 'Cur', artist: 'Some Person', queue: [['Cur', 'Some Person'], ['B', '10mm'], ['C', 'After Midnight'], ['D', 'Some Human'], ['E', 'The Velvet Sundown']] });   // E is 4 ahead
    const { a } = await app(b, p);
    await drain(a);
    const removed = log(b).filter(e => e.event === 'removed').map(e => e.title).sort();
    return (J(p.queueTitles()) === J(['Cur', 'D']) && J(removed) === J(['B', 'C', 'E']) && J(p.clicks.removed) === J(['B', 'C', 'E'])) || J({ q: p.queueTitles(), removed, clicks: p.clicks.removed });
  });
  await t('never skip wins', async () => {
    const b = boot({ user: { neverSkip: ['The Velvet Sundown'] } }); const p = page();
    const { a } = await app(b, p); await a.flush();
    return (p.clicks.next === 0 && log(b).length === 0) || J({ clicks: p.clicks, l: log(b) });
  });
  await t('watch list: log watched, no Next', async () => {
    const b = boot({ mode: 'watch' }); const p = page();
    const { a } = await app(b, p); await a.flush();
    return (p.clicks.next === 0 && log(b)[0]?.event === 'watched') || J({ clicks: p.clicks, l: log(b) });
  });
  await t('adding the playing artist to your list skips it', async () => {
    const b = boot({ artists: [] }); const p = page({ title: 'Song', artist: 'Real Fake Band' });
    const { a, clock } = await app(b, p);
    if (p.clicks.next !== 0) return 'skipped before blocking';
    await b.storage.set({ 'hm.user': { artists: ['Real Fake Band'], songs: [], keywords: [], neverSkip: [] } });
    await settle(clock, 60); a.checkPlaying(); await a.flush();
    return (p.clicks.next === 1 && log(b)[0]?.listId === 'user:artists') || J({ clicks: p.clicks, l: log(b) });
  });
  await t('hm.log writes never rebuild the index', async () => {
    const b = boot(); const p = page({ title: 'Fine', artist: 'Some Person' });
    const { a, clock } = await app(b, p);
    const before = b.builds();
    await b.storage.set({ 'hm.log': [] }); await settle(clock, 60);
    const afterLog = b.builds();
    await b.storage.set({ 'hm.settings': { ...b.ctx.HM.settings.DEFAULTS, lookahead: 2 } }); await settle(clock, 60);
    return (before >= 1 && afterLog === before && b.builds() === before + 1) || J({ before, afterLog, after: b.builds() });
  });
  await t('quick log writes are not lost', async () => {
    const b = boot(); const p = page({ queue: [['Dust on the Wind', 'The Velvet Sundown'], ['B', '10mm'], ['C', 'After Midnight']] });
    const { a } = await app(b, p);
    await drain(a);
    const ev = log(b).map(e => e.event).sort();
    return J(ev) === J(['removed', 'removed', 'skipped']) || J(ev);
  });
  await t('log capped at 1000, newest first', async () => {
    const b = boot(); b.storage.data['hm.log'] = Array.from({ length: 1000 }, (_, i) => ({ at: i, event: 'seen', title: 'x' + i }));
    const p = page();
    const { a } = await app(b, p); await a.flush();
    return (log(b).length === 1000 && log(b)[0].event === 'skipped') || `len ${log(b).length} first ${log(b)[0]?.event}`;
  });
  await t('speed: re-check < 0.5 ms, new song < 6 ms, 1375-name list', async () => {
    const b = boot({ artists: Array.from({ length: 1375 }, (_, i) => `Listed Artist ${i}`), settings: { autoSkip: false } });
    const p = page({ title: 'Fine', artist: 'Some Person' });
    const { a } = await app(b, p);
    let t0 = performance.now(); for (let i = 0; i < 200; i++) a.checkPlaying(); const same = (performance.now() - t0) / 200;
    t0 = performance.now(); for (let i = 0; i < 200; i++) { p.setSong('S' + i, 'Person ' + i); a.checkPlaying(); } const fresh = (performance.now() - t0) / 200;
    return (same < 0.5 && fresh < 6) || J({ same, fresh });
  });
}

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
