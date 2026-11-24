// Every read-modify-write of hm.user, hm.settings and hm.filterLists goes through
// HM.store.modify (a Web Lock per key), so the popup, the worker and the music page never undo
// each other; and the popup's removal friction (undo, plain errors, a status line that clears).
import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { load, run } from './load.mjs';
import { parseHTML, Event, el, makeDocument } from './dom.mjs';
import { fakeStorage, fakeClock } from './fakes.mjs';

const settle = () => new Promise(r => setTimeout(r, 90));
const ext = p => readFileSync(new URL('../extension/' + p, import.meta.url), 'utf8');
const J = v => JSON.stringify(v);

// navigator.locks stand-in: one holder at a time per name.
function fakeLocks() {
  const tails = new Map();
  return {
    request(name, fn) {
      const prev = tails.get(name) || Promise.resolve();
      const run = prev.then(() => fn());
      tails.set(name, run.catch(() => {}));
      return run;
    },
  };
}
// Every call takes a few ms, so read-modify-writes from different contexts interleave.
function slow(inner, ms = 3) {
  const wait = () => new Promise(r => setTimeout(r, ms));
  return {
    ...inner,
    get: async k => { await wait(); const v = await inner.get(k); await wait(); return v; },
    set: async o => { await wait(); const v = await inner.set(o); await wait(); return v; },
  };
}

function popup(base, { locks = null, clock = null, wrap = null, send = null } = {}) {
  const doc = parseHTML(readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8'));
  let storage = slow(base);
  if (wrap) storage = wrap(storage);
  storage.data = base.data;
  const chrome = {
    storage: { local: storage, onChanged: base.onChanged },
    permissions: { request: (q, cb) => cb(true), remove: (q, cb) => cb && cb(true) },
    runtime: { sendMessage: (m, cb) => { if (send) send(m); if (cb) cb(m.type === 'dev-mode' ? false : true); } },
  };
  const t = clock || { setTimeout, clearTimeout };
  load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/secret.js', 'popup/model.js', 'popup/popup.js'],
    { document: doc, chrome, URL, Blob, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, navigator: locks ? { locks } : undefined,
      __hmSecretBackend: { get: () => null, set: () => {}, remove: () => {} } });
  const $ = id => doc.getElementById(id);
  const click = async e => { e.click(); await settle(); };
  return { doc, $, click, storage: base, status: () => $('status').textContent };
}

function worker(storage, { locks = null, fetchBody } = {}) {
  let ctx;
  const runFile = f => runInContext(ext('src/' + f), ctx);
  ctx = load([], { importScripts: (...fs) => fs.forEach(runFile), setTimeout, clearTimeout, AbortController });
  runFile('background.js');
  const fetch = async () => ({ ok: true, status: 200, text: async () => { await new Promise(r => setTimeout(r, 4)); return fetchBody || J({ artists: [{ name: 'A' }, { name: 'B' }] }); } });
  return ctx.HM.createRefresher({ storage, fetch, now: () => 5000, locks, assetUrl: p => 'bundle:' + p, isDev: async () => false });
}


// The real worker (background.js with its message listener), sharing the given locks. send()
// delivers one message the way chrome does and resolves to the reply.
function workerMessages(storage, { locks = null } = {}) {
  let listener;
  const chrome = {
    storage: { local: storage },
    runtime: { onInstalled: { addListener: () => {} }, onMessage: { addListener: f => { listener = f; } }, getURL: p => 'bundle:' + p },
    action: { setBadgeText: () => {} },
  };
  let ctx;
  const runFile = f => runInContext(ext('src/' + f), ctx);
  ctx = load([], { URL, importScripts: (...fs) => fs.forEach(runFile), chrome, fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    setTimeout, clearTimeout, navigator: locks ? { locks } : undefined });
  runFile('background.js');
  return (msg, sender) => new Promise(res => { const kept = listener(msg, sender, res); if (kept !== true) res(undefined); });
}
const TAB = { tab: { id: 1, url: 'https://music.youtube.com/watch?v=x' } };

const mine = (o = {}) => ({ id: 'mine', name: 'Mine', url: 'https://example.org/mine.json', enabled: true, mode: 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null, ...o });
const USER = { artists: ['Old'], songs: [], keywords: [], neverSkip: [] };
const row = (p, ul, text) => [...p.doc.querySelectorAll(ul + ' li')].find(li => li.textContent.includes(text));
const listRemove = (p, name) => [...p.doc.querySelectorAll('#filter-lists li')].find(li => li.querySelector('.list-name').textContent === name).querySelectorAll('button').slice(-1)[0];

run([
  ['HM.store.modify: two contexts changing one key under a shared lock lose nothing', async () => {
    const a = load(['src/core/store.js']).HM, b = load(['src/core/store.js']).HM;
    const base = fakeStorage({ 'hm.user': { ...USER, artists: [] } });
    const s = slow(base, 2), locks = fakeLocks();
    const add = (HM, n) => HM.store.modify(s, 'hm.user', u => ({ ...u, artists: [...u.artists, n] }), { locks });
    await Promise.all([add(a, 'x'), add(b, 'y'), add(a, 'z'), add(b, 'w')]);
    return base.data['hm.user'].artists.length === 4 || J(base.data['hm.user']);
  }],
  ['HM.store.modify: without Web Locks it still reads fresh, writes, and tags failures by stage', async () => {
    const HM = load(['src/core/store.js']).HM;
    const base = fakeStorage({ k: 1 });
    const out = await HM.store.modify(base, 'k', v => v + 1, { locks: null });
    const same = await HM.store.modify(base, 'k', () => undefined, { locks: null });
    const stage = async (s, fn) => HM.store.modify(s, 'k', fn, { locks: null }).then(() => 'no error', e => e.stage);
    const r = await stage({ ...base, get: async () => { throw new Error('x'); } }, v => v);
    const c = await stage(base, () => { throw new Error('x'); });
    const w = await stage({ ...base, set: async () => { throw new Error('x'); } }, v => v);
    return (out === 2 && same === 2 && base.data.k === 2 && r === 'read' && c === 'change' && w === 'write') || J({ out, same, k: base.data.k, r, c, w });
  }],
  ['two open popups: a removal and an add at the same moment both stick', async () => {
    const base = fakeStorage({ 'hm.user': { ...USER, artists: ['Old', 'Keep'] } });
    const locks = fakeLocks();
    const p1 = popup(base, { locks }), p2 = popup(base, { locks });
    await settle();
    const rm = row(p1, '#artists', 'Old').querySelector('button');
    p2.$('artist-input').value = 'New';
    rm.click();
    p2.doc.querySelector('.add-entry-btn[data-kind="artists"]').click();
    await settle();
    const a = base.data['hm.user'].artists;
    return (J([...a].sort()) === J(['Keep', 'New'])) || J(a);
  }],
  ['Block artist on the music page does not undo a popup removal made at the same moment', async () => {
    const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/content.js'];
    const ctx = load(CORE, { setTimeout, clearTimeout });
    const base = fakeStorage({ 'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 0 }], 'hm.list.soul-over-ai': { artists: [] },
      'hm.settings': { ...ctx.HM.settings.DEFAULTS, lookahead: 0 }, 'hm.user': { ...USER, artists: ['Old', 'Keep'] } });
    const locks = fakeLocks(), clock = fakeClock();
    const ti = el('div', { class: 'ytmusicTrackInfoTitle' }, 'Song');
    const by = el('div', { class: 'ytmusicTrackInfoByline' }, 'Band A • Album • 2025');
    const doc = makeDocument(el('ytmusic-miniplayer', {}, ti, by, el('dislike-button-view-model', {}, el('button', { 'aria-pressed': 'false' })), el('button', { 'aria-label': 'Next' })), el('div', { id: 'contents' }));
    doc.location.pathname = '/watch';
    const send = workerMessages(slow(base), { locks });
    const app = ctx.HM.createApp({ doc, storage: slow(base), timers: clock, now: () => 1_700_000_000_000 + clock.now(), blockArtist: async artist => (await send({ type: 'hm-block', artist }, TAB)) === true });
    await app.start(); await settle(); clock.tick(60); await settle(); await app.flush();
    const p = popup(base, { locks });
    await settle();
    const rm = row(p, '#artists', 'Old').querySelector('button');
    doc.querySelector('#hm-player-buttons button').click();
    rm.click();
    await settle(); clock.tick(60); await settle(); await app.flush(); await settle();
    const a = base.data['hm.user'].artists;
    return (J([...a].sort()) === J(['Band A', 'Keep'])) || J(a);
  }],
  ['worker: a popup-style edit and an hm-block message at the same moment both survive', async () => {
    const base = fakeStorage({ 'hm.user': { ...USER, artists: ['Old', 'Keep'] } });
    const locks = fakeLocks();
    const send = workerMessages(slow(base), { locks });
    const HM = load(['src/core/store.js']).HM;
    const [reply] = await Promise.all([
      send({ type: 'hm-block', artist: 'Band A' }, TAB),
      HM.store.modify(slow(base), 'hm.user', u => ({ ...u, artists: u.artists.filter(a => a !== 'Old') }), { locks }),
    ]);
    const a = base.data['hm.user'].artists;
    return (reply === true && J([...a].sort()) === J(['Band A', 'Keep'])) || J({ reply, a });
  }],
  ['worker: hm-block ignores bad artists and senders off the music sites', async () => {
    const base = fakeStorage({ 'hm.user': { ...USER, artists: [] } });
    const send = workerMessages(base, { locks: fakeLocks() });
    const bad = [
      [{ type: 'hm-block', artist: '' }, TAB], [{ type: 'hm-block', artist: 5 }, TAB], [{ type: 'hm-block', artist: 'x'.repeat(300) }, TAB],
      [{ type: 'hm-block', artist: 'Evil' }, { tab: { id: 2, url: 'https://evil.example/' } }],
      [{ type: 'hm-block', artist: 'Evil' }, { tab: { id: 2, url: 'https://music.youtube.com.evil.example/' } }],
      [{ type: 'hm-block', artist: 'Evil' }, {}],
    ];
    const replies = []; for (const [m, snd] of bad) replies.push(await send(m, snd));
    const ok = await send({ type: 'hm-block', artist: 'Fine' }, { tab: { id: 3, url: 'https://open.spotify.com/track/1' } });
    return (replies.every(r => r === false) && ok === true && J(base.data['hm.user'].artists) === J(['Fine'])) || J({ replies, ok, a: base.data['hm.user'].artists });
  }],
  ['content: Block artist sends the artist to the worker and writes no storage itself; a refusal logs an error', async () => {
    const CORE = ['src/core/text.js', 'src/core/store.js', 'src/core/match.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'src/core/lookahead.js', 'src/core/skipper.js', 'src/page/common.js', 'src/page/ytm.js', 'src/content.js'];
    const ctx = load(CORE, { setTimeout, clearTimeout });
    const run = async reply => {
      const base = fakeStorage({ 'hm.filterLists': [{ ...ctx.HM.lists.SOUL_OVER_AI, lastRefresh: 1, count: 0 }], 'hm.list.soul-over-ai': { artists: [] },
        'hm.settings': { ...ctx.HM.settings.DEFAULTS, lookahead: 0 }, 'hm.user': { ...USER, artists: ['Keep'] } });
      const before = J(base.data['hm.user']);
      const clock = fakeClock(), sent = [];
      const ti = el('div', { class: 'ytmusicTrackInfoTitle' }, 'Song');
      const by = el('div', { class: 'ytmusicTrackInfoByline' }, 'Band A • Album • 2025');
      const doc = makeDocument(el('ytmusic-miniplayer', {}, ti, by, el('dislike-button-view-model', {}, el('button', { 'aria-pressed': 'false' })), el('button', { 'aria-label': 'Next' })), el('div', { id: 'contents' }));
      doc.location.pathname = '/watch';
      const app = ctx.HM.createApp({ doc, storage: base, timers: clock, now: () => 1_700_000_000_000 + clock.now(), blockArtist: async a => { sent.push(a); return reply; } });
      await app.start(); await settle(); clock.tick(60); await settle(); await app.flush();
      doc.querySelector('#hm-player-buttons button').click();
      await settle(); clock.tick(60); await settle(); await app.flush(); await settle();
      const errs = (base.data['hm.log'] || []).concat(...Object.entries(base.data).filter(([k]) => k.startsWith('hm.log')).map(([, v]) => v)).filter(e => e && e.event === 'block-failed');
      return { sent, same: J(base.data['hm.user']) === before, errs: errs.length };
    };
    const good = await run(true), bad = await run(false);
    return (J(good.sent) === J(['Band A']) && good.same && good.errs === 0 && bad.same && bad.errs >= 1) || J({ good, bad });
  }],
  ['the worker refreshing a list does not undo a popup toggle made at the same moment', async () => {
    const bad = [];
    for (const delay of [0, 6, 12, 18, 24, 30, 40]) {
      const base = fakeStorage({ 'hm.filterLists': [mine(), mine({ id: 'other', name: 'Other', url: 'https://example.org/o.json' })] });
      const locks = fakeLocks();
      const w = worker(slow(base), { locks });
      const p = popup(base, { locks });
      await settle();
      const box = [...p.doc.querySelectorAll('#filter-lists li')].find(li => li.querySelector('.list-name').textContent === 'Other').querySelector('input');
      const r = w.refreshOne('mine');
      await new Promise(res => setTimeout(res, delay));
      box.checked = false; box.dispatchEvent(new Event('change'));
      await r; await settle();
      const m = id => base.data['hm.filterLists'].find(l => l.id === id);
      if (!(m('other').enabled === false && m('mine').lastRefresh === 5000)) bad.push(delay);
    }
    return bad.length === 0 || `lost an update at delays ${J(bad)}`;
  }],
  ['removing one of your entries says "Removed X. Undo"; Undo puts it back where it was; the line clears after 8 s', async () => {
    const clock = fakeClock();
    const base = fakeStorage({ 'hm.user': { ...USER, artists: ['A1', 'A2', 'A3'] } });
    const p = popup(base, { clock });
    await settle();
    await p.click(row(p, '#artists', 'A2').querySelector('button'));
    const said = p.status();
    const gone = J(base.data['hm.user'].artists);
    await p.click(p.$('status').querySelector('button'));
    const back = J(base.data['hm.user'].artists);
    await p.click(row(p, '#artists', 'A1').querySelector('button'));
    clock.tick(7900); const early = p.status();
    clock.tick(200);
    return (said === 'Removed A2. Undo' && gone === J(['A1', 'A3']) && back === J(['A1', 'A2', 'A3']) && early.startsWith('Removed A1.') && p.status() === '')
      || J({ said, gone, back, early, late: p.status() });
  }],
  ['removing a list says Removed with Undo; Undo restores the record and refreshes it', async () => {
    const msgs = [];
    const base = fakeStorage({ 'hm.filterLists': [mine()], 'hm.list.mine': { artists: [{ name: 'A' }] } });
    const p = popup(base, { send: m => msgs.push(m) });
    await settle();
    await p.click(listRemove(p, 'Mine'));
    const said = p.status(), after = J([base.data['hm.filterLists'].map(l => l.id).filter(i => i === 'mine'), 'hm.list.mine' in base.data]);
    await p.click(p.$('status').querySelector('button'));
    return (said === 'Removed Mine. Undo' && after === J([[], false]) && base.data['hm.filterLists'].some(l => l.id === 'mine') && msgs.some(m => m.type === 'refresh' && m.id === 'mine'))
      || J({ said, after, lists: base.data['hm.filterLists'], msgs });
  }],
  ['a refresh that lands just after a list is removed leaves no orphan copy and does not bring the list back', async () => {
    const base = fakeStorage({ 'hm.filterLists': [mine()], 'hm.list.mine': { artists: [{ name: 'A' }] } });
    const locks = fakeLocks();
    const w = worker(slow(base, 1), { locks });
    // the refresh arrives right after the popup deleted the downloaded copy
    const wrap = s => ({ ...s, remove: async k => { await base.remove(k); await w.refreshOne('mine'); } });
    const p = popup(base, { locks, wrap });
    await settle();
    await p.click(listRemove(p, 'Mine'));
    await settle();
    return (!('hm.list.mine' in base.data) && base.data['hm.filterLists'].every(l => l.id !== 'mine')) || J({ keys: Object.keys(base.data), lists: base.data['hm.filterLists'] });
  }],
  ['if the saved copy cannot be deleted, the list stays and the popup says so', async () => {
    const base = fakeStorage({ 'hm.filterLists': [mine()], 'hm.list.mine': { artists: [{ name: 'A' }] } });
    const p = popup(base, { wrap: s => ({ ...s, remove: async () => { throw new Error('nope'); } }) });
    await settle();
    await p.click(listRemove(p, 'Mine'));
    return (base.data['hm.filterLists'].some(l => l.id === 'mine') && p.status() === 'Could not remove that list. Try again.') || J({ s: p.status(), lists: base.data['hm.filterLists'] });
  }],
  ['Clear log that fails says so in plain words', async () => {
    const base = fakeStorage({ 'hm.log': [{ at: 1, event: 'hidden', title: 'T', artistLine: 'Y', listId: 'x', listName: 'X', rule: 'artist', entry: 'Y' }] });
    const p = popup(base, { wrap: s => ({ ...s, remove: async () => { throw new Error('nope'); }, set: async () => { throw new Error('nope'); } }) });
    await settle();
    await p.click(p.$('clear-log'));
    return /could not clear the log/i.test(p.status()) || `status: "${p.status()}"`;
  }],
  ['a routine success message clears after 6 s; an error stays', async () => {
    const clock = fakeClock();
    const base = fakeStorage({ 'hm.user': USER });
    const p = popup(base, { clock });
    await settle();
    p.$('add-list-btn').click(); await settle(); // no address: an error
    const err = p.status();
    clock.tick(60000);
    const errLater = p.status();
    await p.click(p.$('import-cancel')); // "Nothing imported."
    const ok = p.status();
    clock.tick(5900); const okEarly = p.status();
    clock.tick(200);
    return (err && errLater === err && ok === 'Nothing imported.' && okEarly === ok && p.status() === '') || J({ err, errLater, ok, okEarly, late: p.status() });
  }],
]);
