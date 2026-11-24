// A page pass must stay cheap: it looks at a row again only when the row changed, ignores the
// player's ticking time text, waits while the tab is hidden, and a burst of storage changes
// reloads once.
import { run, load } from './load.mjs';
import { el, makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const VS = 'UCLeR-eGh2OFy9ydX7IUcOTw';
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

function row(title, artist, channel) {
  return el('ytmusic-responsive-list-item-renderer', {},
    el('div', { class: 'title' }, title),
    el('a', { href: `channel/${channel}` }, artist));
}

function pageOf(rows, extra = []) {
  const doc = makeDocument(el('div', { id: 'contents' }, ...rows), ...extra);
  doc.location.hostname = 'music.youtube.com';
  doc.location.pathname = '/playlist';
  return doc;
}

async function start(doc, { getSpy, nameOnly } = {}) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1 }],
    'hm.list.soul-over-ai': { artists: [nameOnly ? { name: 'The Velvet Sundown' } : { name: 'The Velvet Sundown', channelId: VS }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  if (getSpy) { const get = storage.get; storage.get = keys => { getSpy(keys); return get(keys); }; }
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => clock.now() });
  await app.start(); await settle(clock, 60); await app.flush();
  return { ctx, storage, clock, app };
}

// Counts the reads of a row's parts (every extraction queries the row).
function watchRows(rows) {
  const c = { n: 0 };
  for (const r of rows) {
    const q = Object.getPrototypeOf(r).querySelectorAll;
    r.querySelectorAll = function (...a) { c.n++; return q.apply(this, a); };
  }
  return c;
}

run([
  ['3000 rows, a pass with nothing changed reads no row again', async () => {
    const rows = [];
    for (let i = 0; i < 3000; i++) rows.push(row(`Song ${i}`, i === 7 ? 'The Velvet Sundown' : `Person ${i}`, i === 7 ? VS : `UC${String(i).padStart(22, '0')}`));
    const doc = pageOf(rows);
    const c = watchRows(rows);
    const { app, clock } = await start(doc);
    const first = c.n;
    c.n = 0;
    const passes = app.status().passes;
    doc.body.append(el('span'));
    await settle(clock, 60);
    const second = c.n;
    return (first >= 3000 && second === 0 && app.status().passes > passes && rows[7].hasAttribute('data-hm-marked'))
      || JSON.stringify({ first, second, passes: app.status().passes - passes });
  }],
  ['a row whose text changed is read again and matched again', async () => {
    const r = row('Song', 'Person', 'UC1111111111111111111111');
    const doc = pageOf([r]);
    const { clock } = await start(doc);
    if (r.hasAttribute('data-hm-marked')) return 'marked too soon';
    r.querySelector('a').textContent = 'The Velvet Sundown';
    r.querySelector('a').setAttribute('href', `channel/${VS}`);
    doc.body.append(el('span'));
    await settle(clock, 60);
    return r.hasAttribute('data-hm-marked') || 'not marked';
  }],
  ['the time text ticking starts no page pass (light passes only)', async () => {
    const time = el('span', { class: 'time-info' }, '0:01 / 3:00');
    const doc = pageOf([row('Song', 'Person', 'UC1111111111111111111111')], [el('ytmusic-player-bar', {}, time)]);
    const { app, clock } = await start(doc);
    const pages = app.status().pagePasses;
    if (typeof pages !== 'number') return 'no page pass count';
    for (let i = 0; i < 10; i++) { time.textContent = `0:0${i} / 3:00`; await settle(clock, 60); }
    return app.status().pagePasses === pages || `page passes ${app.status().pagePasses - pages}`;
  }],
  ['a hidden tab skips the page passes and runs one on showing; the playing song is still checked', async () => {
    const bar = el('ytmusic-miniplayer', {},
      el('div', { class: 'ytmusicTrackInfoTitle' }, 'Fine'),
      el('div', { class: 'ytmusicTrackInfoByline' }, 'Some Person • Album • 2025'),
      el('button', { 'aria-label': 'Next' }));
    let next = 0;
    bar.querySelector('[aria-label="Next"]').addEventListener('click', () => { next++; });
    const doc = pageOf([], [bar]);
    doc.addEventListener('keydown', e => { if (e.key === 'j') next++; }); // YouTube Music's own Next key
    const { clock } = await start(doc, { nameOnly: true });
    doc.visibilityState = 'hidden';
    const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
    doc.querySelector('#contents').append(r);
    await settle(clock, 60);
    const marked = r.hasAttribute('data-hm-marked');
    bar.querySelector('.ytmusicTrackInfoTitle').textContent = 'Dust on the Wind';
    bar.querySelector('.ytmusicTrackInfoByline').textContent = 'The Velvet Sundown • Album • 2025';
    await settle(clock, 300); await settle(clock, 60);
    const skippedHidden = next;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new (doc.defaultView.Event)('visibilitychange'));
    await settle(clock, 60);
    return (!marked && skippedHidden >= 1 && r.hasAttribute('data-hm-marked'))
      || JSON.stringify({ marked, skippedHidden, after: r.hasAttribute('data-hm-marked') });
  }],
  ['8 storage changes in a burst reload once', async () => {
    let reads = 0;
    const doc = pageOf([]);
    const { storage, clock } = await start(doc, { getSpy: keys => { if (Array.isArray(keys) && keys.includes('hm.settings')) reads++; } });
    reads = 0;
    for (let i = 0; i < 8; i++) await storage.set({ 'hm.settings': { ...storage.data['hm.settings'], lookahead: i % 4 } });
    await settle(clock, 100);
    const early = reads;
    await settle(clock, 300);
    return (early === 0 && reads === 1) || JSON.stringify({ early, reads });
  }],
]);
