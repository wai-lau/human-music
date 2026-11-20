// Rows that stay on the page but will be skipped are marked like YouTube Music's own
// unavailable rows, with the skip glyph (Wai, 2026-11-13: "in search results and
// playlists, wherever you can still see the song, make it look like this ... except
// instead of an exclamation mark just put the skip symbol"). Also the toolbar count
// ("where 1 is the number of songs skipped or blocked").
import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { run, load } from './load.mjs';
import { el, makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const VS = 'UCLeR-eGh2OFy9ydX7IUcOTw';
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const J = v => JSON.stringify(v);

function row(title, artist, channel) {
  return el('ytmusic-responsive-list-item-renderer', {},
    el('div', { class: 'left-items' }, el('ytmusic-thumbnail-renderer', { class: 'thumbnail' }, el('img'))),
    el('div', { class: 'title' }, title),
    el('a', { href: `channel/${channel}` }, artist));
}

function playlistPage(rows, { path = '/playlist' } = {}) {
  const doc = makeDocument(el('div', { id: 'contents' }, ...rows));
  doc.location.hostname = 'music.youtube.com';
  doc.location.pathname = path;
  return doc;
}

async function start(doc, { settings = {}, user = {}, onCount } = {}) {
  const ctx = load(FILES, { setTimeout, clearTimeout });
  const storage = fakeStorage({
    'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1 }],
    'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown', channelId: VS }] },
    'hm.settings': { ...ctx.HM.settings.DEFAULTS, ...settings },
    'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [], ...user },
  });
  const clock = fakeClock();
  const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => clock.now(), onCount });
  await app.start(); await settle(clock, 60); await app.flush();
  return { ctx, storage, clock, app };
}

// The worker with a fake chrome: returns its message listener and the badge calls.
function worker() {
  const calls = [];
  let onMessage = null;
  const chrome = {
    storage: { local: fakeStorage() },
    runtime: { onInstalled: { addListener: () => {} }, onMessage: { addListener: f => { onMessage = f; } } },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    action: {
      setBadgeText: o => calls.push(['text', o]),
      setBadgeBackgroundColor: o => calls.push(['bg', o]),
      setBadgeTextColor: o => calls.push(['fg', o]),
    },
  };
  const ctx = load([], { chrome, fetch: () => Promise.reject(new Error('offline')), setTimeout: () => 1, clearTimeout: () => {} });
  const runFile = f => runInContext(readFileSync(new URL('../extension/src/' + f, import.meta.url), 'utf8'), ctx);
  ctx.importScripts = (...files) => files.forEach(runFile);
  runFile('background.js');
  return { send: (msg, tabId) => onMessage(msg, { tab: { id: tabId } }, () => {}), calls };
}

const ytm = load(['src/core/text.js', 'src/page/common.js', 'src/page/ytm.js']).HM.ytm;
const marked = r => r.hasAttribute('data-hm-marked');

run([
  ['markRow: dimmed like an unavailable row, thumbnail swapped for the skip glyph, takes no clicks', () => {
    const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
    const doc = makeDocument(r);
    ytm.markRow(r, doc);
    ytm.markRow(r, doc); // twice: still one glyph
    const icons = r.querySelectorAll('.left-items .hm-mark');
    const thumb = r.querySelector('ytmusic-thumbnail-renderer');
    return (marked(r) && icons.length === 1 && !!icons[0].querySelector('svg') && thumb.style.display === 'none' && !r.style.opacity && r.style.color === '#7a7a7a' /* greyed, no opacity (2026-11-20: an Intel Mac drew a white page below a semi-transparent row) */
      && r.style['pointer-events'] === 'none' && r.getAttribute('aria-disabled') === 'true') // Wai: "make the songs that look blocked unclickable"
      || J({ marked: marked(r), icons: icons.length, thumb: thumb.style.display, opacity: r.style.opacity, pe: r.style['pointer-events'], aria: r.getAttribute('aria-disabled') });
  }],
  ['unmarkAll puts the row back as it was', () => {
    const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
    const doc = makeDocument(r);
    ytm.markRow(r, doc);
    ytm.unmarkAll(doc);
    const thumb = r.querySelector('ytmusic-thumbnail-renderer');
    return (!marked(r) && !r.querySelector('.hm-mark') && !thumb.style.display && !r.style.opacity && !r.style.color && !r.style['pointer-events'] && !r.hasAttribute('aria-disabled'))
      || J({ marked: marked(r), icon: !!r.querySelector('.hm-mark'), thumb: thumb.style.display, opacity: r.style.opacity, pe: r.style['pointer-events'] });
  }],
  ['readListRows reads song rows on any page, not the queue or hidden rows', () => {
    const inQueue = row('Queued', 'The Velvet Sundown', VS);
    const hidden = row('Hidden', 'The Velvet Sundown', VS);
    hidden.setAttribute('data-hm-hidden', '');
    const doc = makeDocument(row('Dust on the Wind', 'The Velvet Sundown', VS), el('div', { id: 'queue' }, inQueue), hidden);
    const rows = ytm.readListRows(doc);
    return (rows.length === 1 && rows[0].title === 'Dust on the Wind' && rows[0].credits[0] === 'The Velvet Sundown' && rows[0].channelIds[0] === VS && !!rows[0].el)
      || J(rows.map(r => r.title));
  }],
  ['a playlist row by a listed artist is marked; a person\'s row is not', async () => {
    const listed = row('Dust on the Wind', 'The Velvet Sundown', VS);
    const person = row('Ain\'t No Sunshine', 'Bill Withers', 'UC0000000000000000000000');
    await start(playlistPage([listed, person]));
    return (marked(listed) && !marked(person)) || J({ listed: marked(listed), person: marked(person) });
  }],
  ['a row added later (scrolling) is marked too', async () => {
    const doc = playlistPage([]);
    const { clock } = await start(doc);
    const later = row('Let it Burn', 'The Velvet Sundown', VS);
    doc.querySelector('#contents').append(later);
    await settle(clock, 60);
    return marked(later) || 'not marked';
  }],
  ['auto-skip off or paused: nothing is marked (the song would play)', async () => {
    const a = row('Dust on the Wind', 'The Velvet Sundown', VS);
    const b = row('Dust on the Wind', 'The Velvet Sundown', VS);
    await start(playlistPage([a]), { settings: { autoSkip: false } });
    await start(playlistPage([b]), { settings: { paused: true } });
    return (!marked(a) && !marked(b)) || J({ autoSkipOff: marked(a), paused: marked(b) });
  }],
  ['never skip wins: the row stays as it was', async () => {
    const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
    await start(playlistPage([r]), { user: { neverSkip: ['The Velvet Sundown'] } });
    return !marked(r) || 'marked';
  }],
  ['a row whose artist leaves the lists is put back', async () => {
    const r = row('Song', 'Someone New', 'UC1111111111111111111111');
    const doc = playlistPage([r]);
    const { storage, clock } = await start(doc, { user: { artists: ['Someone New'] } });
    const wasMarked = marked(r);
    await storage.set({ 'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] } });
    await settle(clock, 60);
    return (wasMarked && !marked(r)) || J({ wasMarked, now: marked(r) });
  }],
  ['search rows that are hidden stay hidden, not marked', async () => {
    const r = row('Dust on the Wind', 'The Velvet Sundown', VS);
    await start(playlistPage([r], { path: '/search' }));
    return (r.hasAttribute('data-hm-hidden') && !marked(r)) || J({ hidden: r.hasAttribute('data-hm-hidden'), marked: marked(r) });
  }],
  ['the count: songs skipped or removed from the queue in this tab', async () => {
    const counts = [];
    const doc = playlistPage([]);
    // A listed song playing: skipped once, counted once.
    doc.body.append(el('ytmusic-player-bar', {},
      el('yt-formatted-string', { class: 'title' }, 'Dust on the Wind'),
      el('span', { class: 'byline' }, 'The Velvet Sundown • Floating on Echoes'),
      el('button', { 'aria-label': 'Next' })));
    const { app } = await start(doc, { onCount: n => counts.push(n) });
    await app.flush();
    return (counts[0] === 0 && counts[counts.length - 1] === 1) || J(counts);
  }],
  ['the worker shows a tab\'s count on the toolbar icon, and nothing for 0', () => {
    const w = worker();
    w.send({ type: 'hm-count', count: 2 }, 7);
    w.send({ type: 'hm-count', count: 0 }, 8);
    const texts = w.calls.filter(c => c[0] === 'text').map(c => c[1]);
    return (J(texts) === J([{ tabId: 7, text: '2' }, { tabId: 8, text: '' }])) || J(w.calls);
  }],
]);
