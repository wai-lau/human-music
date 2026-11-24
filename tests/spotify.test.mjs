// The content script on open.spotify.com uses HM.spotify, and Spotify artist IDs match.
import { readFileSync } from 'fs';
import { run, load } from './load.mjs';
import { el, makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock, readLog } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const LISTED = '5ExXpwxyFXhwPKYKx6ItaN';
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };

function spotifyPage({ name = 'A New Name', id = LISTED } = {}) {
  const clicks = { next: 0 };
  const next = el('button', { 'data-testid': 'control-button-skip-forward' });
  const title = el('a', { 'data-testid': 'context-item-link' }, 'Some Song');
  const byline = el('div', { 'data-testid': 'now-playing-widget-v2-byline' }, el('a', { href: `/artist/${id}` }, name));
  next.addEventListener('click', () => { clicks.next++; title.textContent = 'Another Song'; byline.textContent = ''; byline.append(el('a', { href: '/artist/0000000000000000000000' }, 'Someone')); });
  const doc = makeDocument(el('aside', { 'data-testid': 'now-playing-bar' },
    el('div', { 'data-testid': 'now-playing-widget-v2' }, title, byline),
    el('div', {}, next, el('button', { 'data-testid': 'control-button-repeat', class: 'r' }, el('svg', {}, el('path', { d: 'M0 0' }))))));
  doc.location.hostname = 'open.spotify.com';
  doc.location.pathname = '/';
  return { doc, clicks };
}


// A Spotify page with times shown, a Queue panel the queue button toggles, and a track
// menu whose trash-can item removes the row.
function fullPage({ position = '1:00', duration = '2:43', next = [['Listed Next', LISTED], ['Human Next', '2222222222222222222222']] } = {}) {
  const page = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
  const { doc } = page;
  const REMOVE = load(['src/page/spotify.js']).HM.spotify.REMOVE_ICON;
  const pos = el('div', { 'data-testid': 'playback-position' }, position);
  doc.body.append(pos, el('div', { 'data-testid': 'playback-duration' }, duration));
  const menuHost = el('div');
  const makeRow = ([title, id]) => {
    const more = el('button', { 'data-testid': 'more-button' });
    const row = el('li', { role: 'row' }, el('span', { 'data-encore-id': 'listRowTitle' }, title), el('a', { href: `/artist/${id}` }, title + ' Artist'), more);
    more.addEventListener('click', () => {
      menuHost.textContent = '';
      const item = el('button', { role: 'menuitem' }, el('svg', {}, el('path', { d: REMOVE })));
      item.addEventListener('click', () => { menuHost.textContent = ''; page.removed = [...(page.removed || []), title]; row.remove(); });
      menuHost.append(el('div', { 'data-testid': 'context-menu' }, item));
    });
    return row;
  };
  const panel = el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }, ...next.map(makeRow)));
  page.setQueue = list => { const ul = panel.querySelector('ul'); ul.textContent = ''; ul.append(...list.map(makeRow)); };
  const qbtn = el('button', { 'data-testid': 'control-button-queue' });
  page.opens = 0;
  qbtn.addEventListener('click', () => { if (panel.isConnected) panel.remove(); else { page.opens++; doc.body.append(panel); } });
  doc.body.append(qbtn, menuHost);
  page.panel = panel; page.pos = pos;
  return page;
}

async function start(page, artists = [{ name: 'Listed Name', spotifyId: LISTED }]) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1 }],
    'hm.list.soul-over-ai': { artists },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
  });
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc: page.doc, storage, timers: clock, now: () => clock.now() });
  await app.start(); await settle(clock, 60); await settle(clock, 260); await app.flush(); // a match is acted on after the song is read twice, 150 ms apart
  return { storage, clock, app };
}

run([
  ['a listed Spotify artist is skipped by ID, whatever name it shows', async () => {
    const p = spotifyPage();
    const { storage } = await start(p);
    const log = await readLog(storage);
    return (p.clicks.next === 1 && log[0] && log[0].event === 'skipped' && log[0].rule === 'channel' && log[0].entry === 'Listed Name') || JSON.stringify({ next: p.clicks.next, log });
  }],
  ['an unlisted Spotify artist plays', async () => {
    const p = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
    await start(p);
    return p.clicks.next === 0 || `next ${p.clicks.next}`;
  }],
  ['the Block artist button sits right of Spotify\'s repeat button', async () => {
    const p = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
    await start(p);
    const box = p.doc.querySelector('#hm-player-buttons');
    return (!!box && box.previousElementSibling.getAttribute('data-testid') === 'control-button-repeat' && box.querySelector('button').getAttribute('aria-label') === 'Block artist') || 'not mounted';
  }],
  ['lookahead opens the Queue panel once; closed by you, it stays closed', async () => {
    const p = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
    let opens = 0;
    const panel = el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }));
    const qbtn = el('button', { 'data-testid': 'control-button-queue' });
    qbtn.addEventListener('click', () => { opens++; if (panel.isConnected) panel.remove(); else p.doc.body.append(panel); });
    p.doc.body.append(qbtn);
    const { clock } = await start(p);
    const openedOnce = opens === 1 && panel.isConnected;
    panel.remove(); // the person closes it
    p.doc.body.append(el('span')); await settle(clock, 60);
    p.doc.body.append(el('span')); await settle(clock, 60);
    return (openedOnce && opens === 1 && !panel.isConnected) || JSON.stringify({ opens, open: panel.isConnected });
  }],
  ['a first click that opens nothing is tried again (at most 3 times, 2 s apart)', async () => {
    const p = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
    let clicks = 0;
    const panel = el('aside', { 'aria-label': 'Queue' }, el('ul', { role: 'treegrid' }));
    const qbtn = el('button', { 'data-testid': 'control-button-queue' });
    qbtn.addEventListener('click', () => { clicks++; if (clicks >= 2) p.doc.body.append(panel); }); // page not ready for the first
    p.doc.body.append(qbtn);
    const { clock } = await start(p);
    await settle(clock, 2200); await settle(clock, 60);
    return (clicks === 2 && panel.isConnected) || JSON.stringify({ clicks, open: panel.isConnected });
  }],
  ['a button that never opens the panel is pressed 3 times, then left', async () => {
    const p = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
    let clicks = 0;
    const qbtn = el('button', { 'data-testid': 'control-button-queue' });
    qbtn.addEventListener('click', () => clicks++);
    p.doc.body.append(qbtn);
    const { clock } = await start(p);
    for (let i = 0; i < 6; i++) await settle(clock, 2200);
    return clicks === 3 || `clicks ${clicks}`;
  }],
  ['near the end, a closed panel is reopened once, the listed next song removed, then closed again', async () => {
    const p = fullPage();
    const { clock } = await start(p);
    if (!(p.opens === 1 && p.panel.isConnected)) return `first open ${p.opens}`;
    await new Promise(r => setTimeout(r, 120)); await settle(clock, 60); // the first open removes it already
    return (JSON.stringify(p.removed) === '["Listed Next"]') || JSON.stringify({ removed: p.removed });
  }],
  ['you closed the panel: with 13 s left it stays closed (never reopened against your choice)', async () => {
    const p = fullPage({ next: [['Human Next', '2222222222222222222222']] });
    const { clock } = await start(p);
    p.panel.remove(); // the person closes it
    await settle(clock, 60);
    // the queue changes while the panel is closed: a listed song is now next
    p.setQueue([['Listed Next', LISTED]]);
    // a new song starts, then nears its end
    p.doc.querySelector('[data-testid="context-item-link"]').textContent = 'Next Song';
    p.pos.textContent = '1:00'; await settle(clock, 60);
    const opensBefore = p.opens;
    p.pos.textContent = '2:00'; await settle(clock, 60); // 43 s left: nothing yet
    const early = p.opens;
    p.pos.textContent = '2:30'; await settle(clock, 60); // 13 s left
    await settle(clock, 700); await new Promise(r => setTimeout(r, 200)); await settle(clock, 60);
    const reopened = p.opens !== opensBefore;
    p.pos.textContent = '2:31'; await settle(clock, 60); await settle(clock, 700);
    return (early === opensBefore && !reopened && !p.panel.isConnected) || JSON.stringify({ opensBefore, early, opens: p.opens, open: p.panel.isConnected, removed: p.removed });
  }],
  ['lookahead set to 0: the panel is left alone', async () => {
    const p = spotifyPage({ id: '1111111111111111111111', name: 'Real Band' });
    let opens = 0;
    const qbtn = el('button', { 'data-testid': 'control-button-queue' });
    qbtn.addEventListener('click', () => opens++);
    p.doc.body.append(qbtn);
    const ctx = load(FILES, { setTimeout, clearTimeout });
    const storage = fakeStorage({ 'hm.filterLists': [], 'hm.settings': { ...ctx.HM.settings.DEFAULTS, lookahead: 0 }, 'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] } });
    const clock = fakeClock();
    const app = ctx.HM.createApp({ doc: p.doc, storage, timers: clock, now: () => clock.now() });
    await app.start(); await settle(clock, 60);
    return opens === 0 || `opens ${opens}`;
  }],
  ['the manifest runs the Spotify adapter on open.spotify.com', () => {
    const m = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
    const entry = m.content_scripts.find(c => c.matches.includes('https://open.spotify.com/*'));
    return (!!entry && entry.js.includes('src/page/spotify.js') && entry.js[entry.js.length - 1] === 'src/content.js'
      && m.host_permissions.includes('https://open.spotify.com/*')) || JSON.stringify(m.content_scripts);
  }],
]);
