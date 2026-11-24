// The log is written in one batch per tick, stays under a byte budget, and makes room when
// storage reports it is full.
import { run, load } from './load.mjs';
import { el, makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock } from './fakes.mjs';

const FILES = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js',
  'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/page/spotify.js', 'src/content.js'];
const settle = async (clock, ms = 0) => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); if (ms) clock.tick(ms); for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); };
const e = (i, o = {}) => ({ at: 1_700_000_000_000 + i * 60000, event: 'skipped', title: `Song ${i}`, artistLine: 'Act', listId: 'zoundhub', listName: 'Zoundhub', rule: 'artist', entry: 'Act', ...o });
const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/log.js']).HM;
const segKeys = storage => Object.keys(storage.data).filter(k => k.startsWith('hm.log.seg.'));

run([
  ['50 hidden events in one pass: one write to the log', async () => {
    const rows = [];
    for (let i = 0; i < 50; i++) {
      rows.push(el('ytmusic-responsive-list-item-renderer', {}, el('div', { class: 'title' }, `Song ${i}`),
        el('a', { href: 'channel/UCLeR-eGh2OFy9ydX7IUcOTw' }, 'The Velvet Sundown')));
    }
    const doc = makeDocument(el('div', { id: 'contents' }, ...rows));
    doc.location.hostname = 'music.youtube.com';
    doc.location.pathname = '/search';
    const ctx = load(FILES, { setTimeout, clearTimeout });
    const storage = fakeStorage({
      'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1 }],
      'hm.list.soul-over-ai': { artists: [{ name: 'The Velvet Sundown', channelId: 'UCLeR-eGh2OFy9ydX7IUcOTw' }] },
      'hm.settings': { ...ctx.HM.settings.DEFAULTS },
      'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] },
    });
    let logWrites = 0;
    const set = storage.set;
    storage.set = o => { if (Object.keys(o).some(k => k.startsWith('hm.log'))) logWrites++; return set(o); };
    const clock = fakeClock();
    const app = ctx.HM.createApp({ doc, storage, timers: clock, now: () => clock.now() });
    await app.start(); await settle(clock, 60); await app.flush();
    const hidden = rows.filter(r => r.hasAttribute('data-hm-hidden')).length;
    const logged = segKeys(storage).reduce((n, k) => n + storage.data[k].filter(x => x.event === 'hidden').length, 0);
    return (hidden === 50 && logged === 50 && logWrites === 1) || JSON.stringify({ hidden, logged, logWrites });
  }],
  ['a batch keeps its entries in order, and a once-a-day repeat inside it is dropped', async () => {
    const storage = fakeStorage();
    const store = HM.log.createLogStore(storage, { cap: 0 });
    const w = e(1, { event: 'watched' });
    const r = await store.appendMany([{ entry: e(0) }, { entry: w, oncePerDay: true }, { entry: { ...w, at: w.at + 1000 }, oncePerDay: true }, { entry: e(2) }]);
    const all = await store.readAll();
    return (JSON.stringify(r) === '[true,true,false,true]' && all.map(x => x.title).join() === 'Song 2,Song 1,Song 0') || JSON.stringify({ r, all: all.map(x => x.title) });
  }],
  ['storage full: the oldest segments go and the write is tried once more', async () => {
    const storage = fakeStorage();
    const store = HM.log.createLogStore(storage, { cap: 0 });
    for (let i = 0; i < 4; i++) await store.appendMany(Array.from({ length: 1000 }, (_, k) => ({ entry: e(i * 1000 + k) })));
    const before = segKeys(storage).length;
    let sets = 0;
    const set = storage.set;
    storage.set = async o => {
      sets++;
      if (sets === 1) throw new Error('QUOTA_BYTES quota exceeded');
      return set(o);
    };
    const ok = await store.append(e(9999));
    const all = await store.readAll();
    return (ok && sets === 2 && all[0].title === 'Song 9999' && !('hm.log.seg.0' in storage.data) && all.length > 1000)
      || JSON.stringify({ ok, sets, before, now: segKeys(storage), n: all.length });
  }],
  ['the log stays under its byte budget, newest entries kept', async () => {
    const storage = fakeStorage();
    const store = HM.log.createLogStore(storage, { cap: 100000 });
    const fat = 'x'.repeat(280);
    for (let i = 0; i < 6; i++) {
      await store.appendMany(Array.from({ length: 1000 }, (_, k) => ({ entry: e(i * 1000 + k, { title: fat + k, artistLine: fat, listName: fat, entry: fat }) })));
    }
    const bytes = segKeys(storage).reduce((n, k) => n + JSON.stringify(storage.data[k]).length, 0);
    const all = await store.readAll();
    return (bytes <= HM.log.MAX_BYTES && all.length > 0 && all.length < 6000 && all[0].title.endsWith('999')) || JSON.stringify({ bytes, n: all.length });
  }],
]);
