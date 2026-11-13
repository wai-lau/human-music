// The content script on open.spotify.com uses HM.spotify, and Spotify artist IDs match.
import { readFileSync } from 'fs';
import { run, load } from './load.mjs';
import { el, makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
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
  await app.start(); await settle(clock, 60); await app.flush();
  return { storage, clock, app };
}

run([
  ['a listed Spotify artist is skipped by ID, whatever name it shows', async () => {
    const p = spotifyPage();
    const { storage } = await start(p);
    const log = storage.data['hm.log'] || [];
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
