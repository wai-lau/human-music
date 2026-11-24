// Contract check (hardening for friends): on Spotify, Human Music never replaces the person's
// own right-hand panel, never reopens a Queue panel they closed, and never fights a Next
// button that Spotify Free has switched off. Run from the repo root:
//   node tests/contract-spotify-panels.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { el, makeDocument } = await import(process.cwd() + '/tests/dom.mjs');
const { fakeStorage, fakeClock, readLog } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
const LISTED = 'LISTEDLISTEDLISTEDLIST';

// A Spotify page: the playing song (listed or not), Next, Queue button, the time shown.
async function page({ listed = false, asides = [], position = '0:05', nextAttrs = {}, notice = null } = {}) {
  const ctx = load(CORE, { setTimeout, clearTimeout });
  runInContext(readFileSync(process.cwd() + '/extension/src/content.js', 'utf8'), ctx);
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'Listed Act', spotifyId: LISTED }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const clicks = { next: 0, queue: 0, seeks: 0 };
  const id = listed ? LISTED : 'PERSONPERSONPERSONPERS';
  const title = el('a', { 'data-testid': 'context-item-link' }, 'Song');
  const byline = el('div', { 'data-testid': 'context-item-info-subtitles' }, el('a', { href: '/artist/' + id }, listed ? 'Listed Act' : 'Some Person'));
  const next = el('button', { 'data-testid': 'control-button-skip-forward', ...nextAttrs });
  next.addEventListener('click', () => { clicks.next++; });
  const queueBtn = el('button', { 'data-testid': 'control-button-queue' });
  queueBtn.addEventListener('click', () => { clicks.queue++; });
  const range = el('input', { type: 'range', max: '200000' });
  range.addEventListener('change', () => { clicks.seeks++; });
  const video = el('video');
  Object.defineProperty(video, 'paused', { get: () => false });
  Object.defineProperty(video, 'currentTime', { get: () => 1 + clock.now() / 1000, set() {} });
  const posEl = el('div', { 'data-testid': 'playback-position' }, position);
  const kids = [el('div', { 'data-testid': 'now-playing-widget' }, title, byline), next, queueBtn, video,
    posEl, el('div', { 'data-testid': 'playback-duration' }, '3:20'),
    el('div', { 'data-testid': 'playback-progressbar' }, range), ...asides];
  if (notice) kids.push(el('div', { role: 'alert' }, notice));
  const doc = makeDocument(...kids);
  doc.location.hostname = 'open.spotify.com';
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => clock.now(), site: ctx.HM.spotify });
  await app.start();
  const run = async (n) => { for (let i = 0; i < n; i++) await settle(clock, 500); await app.flush(); };
  return { clicks, run, doc, storage, app, posEl };
}

await t('another right-hand panel (Lyrics) open: the Queue button is never clicked', async () => {
  const p = await page({ asides: [el('aside', { 'aria-label': 'Lyrics' })] });
  await p.run(30);
  return p.clicks.queue === 0 || J(p.clicks);
});

await t('a Queue panel still drawing (no rows yet) counts as open: no click', async () => {
  const p = await page({ asides: [el('aside', { 'aria-label': 'Queue' })] });
  await p.run(30);
  return p.clicks.queue === 0 || J(p.clicks);
});

await t('Queue closed by the person: no last-chance reopen near the end of the song', async () => {
  const q = el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }));
  const p = await page({ asides: [q] });
  await p.run(4); // seen open
  q.remove(); // the person closes it
  await p.run(4); // seen closed: refused
  p.posEl.textContent = '3:12'; // 8 s left
  await p.run(10);
  return p.clicks.queue === 0 || J(p.clicks);
});

await t('Next disabled (aria-disabled): not pressed, no seek, logged as a failed skip', async () => {
  const p = await page({ listed: true, nextAttrs: { 'aria-disabled': 'true' } });
  await p.run(30);
  const ev = (await readLog(p.storage)).map((e) => e.event);
  return (p.clicks.next === 0 && p.clicks.seeks === 0 && ev.filter((e) => e === 'skip-failed').length === 1) || J({ c: p.clicks, ev });
});

await t('Next disabled (disabled attribute): not pressed, no seek', async () => {
  const p = await page({ listed: true, nextAttrs: { disabled: '' } });
  await p.run(30);
  return (p.clicks.next === 0 && p.clicks.seeks === 0) || J(p.clicks);
});

await t('skip-limit notice showing: Next not pressed, failed skip logged', async () => {
  const p = await page({ listed: true, notice: 'You have reached your skip limit. Upgrade to Premium.' });
  await p.run(30);
  const ev = (await readLog(p.storage)).map((e) => e.event);
  return (p.clicks.next === 0 && p.clicks.seeks === 0 && ev.includes('skip-failed')) || J({ c: p.clicks, ev });
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
