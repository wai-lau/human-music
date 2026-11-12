// The lists committed in extension/lists/ are imported by the service worker,
// each only when its content changed; and HM.lists.applyBackup, shared with the popup.
import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { load, run } from './load.mjs';
import { fakeStorage } from './fakes.mjs';

const ext = p => readFileSync(new URL('../extension/' + p, import.meta.url), 'utf8');

function refresher(initial, files, { remote = null } = {}) {
  let ctx;
  const runFile = f => runInContext(ext('src/' + f), ctx);
  ctx = load([], { importScripts: (...fs) => fs.forEach(runFile) });
  runFile('background.js');
  const storage = fakeStorage(initial);
  const fetched = [];
  const fetch = async url => {
    fetched.push(url);
    if (url.startsWith('bundle:')) {
      const path = url.slice('bundle:'.length);
      if (!(path in files)) return { ok: false, status: 404, text: async () => 'missing' };
      return { ok: true, status: 200, text: async () => files[path] };
    }
    if (remote === null) throw new Error('offline');
    return { ok: true, status: 200, text: async () => JSON.stringify(remote) };
  };
  const r = ctx.HM.createRefresher({ storage, fetch, now: () => 1000, assetUrl: p => 'bundle:' + p });
  return { r, storage, fetched, HM: ctx.HM };
}

const index = JSON.stringify({ files: [{ file: 'my-lists.json', kind: 'backup' }, { file: 'soa.json', kind: 'filter-list', id: 'soul-over-ai' }] });
const backup = user => JSON.stringify({ format: 'human-music-backup', version: 1, user, settings: { lookahead: 5 }, filterLists: [] });
const U = o => ({ artists: [], songs: [], keywords: [], neverSkip: [], ...o });
const snapshot = JSON.stringify({ name: 'snap', artists: [{ name: 'Snap One' }, { name: 'Snap Two' }] });

run([
  ['the committed files ship and parse', () => {
    const idx = JSON.parse(ext('lists/index.json'));
    const files = idx.files.map(f => [f.file, JSON.parse(ext('lists/' + f.file))]);
    const mine = files.find(([f]) => f === 'my-lists.json')[1];
    const soa = files.find(([f]) => f === 'soul-over-ai.json')[1];
    return (mine.format === 'human-music-backup' && soa.artists.length > 1000 && soa.artists.every(a => typeof a.name === 'string' && a.name)) || 'bad files';
  }],
  ['install imports your lists and fills Soul Over AI from the snapshot when offline', async () => {
    const { r, storage } = refresher({}, { 'lists/index.json': index, 'lists/my-lists.json': backup(U({ artists: ['Band A'] })), 'lists/soa.json': snapshot });
    await r.install();
    const d = storage.data;
    return (JSON.stringify(d['hm.user'].artists) === '["Band A"]' && d['hm.settings'].lookahead === 5
      && d['hm.list.soul-over-ai'].artists.length === 2 && d['hm.filterLists'][0].count === 2) || JSON.stringify(d);
  }],
  ['online install: the downloaded list replaces the snapshot', async () => {
    const { r, storage } = refresher({}, { 'lists/index.json': index, 'lists/my-lists.json': backup(U({})), 'lists/soa.json': snapshot },
      { remote: [{ name: 'Live One' }, { name: 'Live Two' }, { name: 'Live Three' }] });
    await r.install();
    return storage.data['hm.list.soul-over-ai'].artists.length === 3 || JSON.stringify(storage.data['hm.list.soul-over-ai']);
  }],
  ['an unchanged file is not imported again, so popup deletions stay', async () => {
    const files = { 'lists/index.json': index, 'lists/my-lists.json': backup(U({ artists: ['Band A', 'Band B'] })), 'lists/soa.json': snapshot };
    const { r, storage } = refresher({}, files);
    await r.install();
    await storage.set({ 'hm.user': U({ artists: ['Band B'] }) }); // Band A deleted in the popup
    const again = await r.importBundled();
    return (JSON.stringify(again) === '[]' && JSON.stringify(storage.data['hm.user'].artists) === '["Band B"]') || JSON.stringify({ again, u: storage.data['hm.user'] });
  }],
  ['a changed file is merged in', async () => {
    const files = { 'lists/index.json': index, 'lists/my-lists.json': backup(U({ artists: ['Band A'] })), 'lists/soa.json': snapshot };
    const { r, storage } = refresher({}, files);
    await r.install();
    await storage.set({ 'hm.user': U({ artists: ['Band A', 'Added In Popup'] }) });
    files['lists/my-lists.json'] = backup(U({ artists: ['Band A', 'Band C'], neverSkip: ['Real Band'] }));
    const again = await r.importBundled();
    const u = storage.data['hm.user'];
    return (JSON.stringify(again) === '["my-lists.json"]' && JSON.stringify(u.artists) === '["Band A","Added In Popup","Band C"]' && JSON.stringify(u.neverSkip) === '["Real Band"]') || JSON.stringify({ again, u });
  }],
  ['a downloaded list is never replaced by the snapshot', async () => {
    const { r, storage } = refresher({ 'hm.filterLists': [], 'hm.list.soul-over-ai': { artists: [{ name: 'Downloaded' }] } },
      { 'lists/index.json': index, 'lists/soa.json': snapshot });
    await r.importBundled();
    return JSON.stringify(storage.data['hm.list.soul-over-ai']) === '{"artists":[{"name":"Downloaded"}]}' || JSON.stringify(storage.data);
  }],
  ['broken or missing files are skipped, the rest still import', async () => {
    const { r, storage } = refresher({}, { 'lists/index.json': JSON.stringify({ files: [{ file: 'gone.json', kind: 'backup' }, { file: 'bad.json', kind: 'backup' }, { file: '../x.json', kind: 'backup' }, { file: 'my-lists.json', kind: 'backup' }] }),
      'lists/bad.json': '{not json', 'lists/my-lists.json': backup(U({ keywords: ['remix'] })) });
    const done = await r.importBundled();
    return (JSON.stringify(done) === '["my-lists.json"]' && JSON.stringify(storage.data['hm.user'].keywords) === '["remix"]') || JSON.stringify({ done, d: storage.data });
  }],
  ['no index: nothing happens, no throw', async () => {
    const { r } = refresher({}, {});
    return JSON.stringify(await r.importBundled()) === '[]' || 'imported something';
  }],
  ['applyBackup: union, settings, list flags, new lists arrive off', () => {
    const { HM } = refresher({}, {});
    const soa = { ...HM.lists.SOUL_OVER_AI };
    const out = HM.lists.applyBackup(
      { user: U({ artists: ['A'] }), settings: { lookahead: 3, paused: false }, filterLists: [soa] },
      { user: U({ artists: ['a', 'B'] }), settings: { lookahead: 7 }, filterLists: [
        { id: 'soul-over-ai', enabled: false, mode: 'watch' },
        { id: 'mine', name: 'Mine', url: 'https://example.org/l.json', enabled: true, mode: 'act' },
        { id: 'plain', name: 'Plain', url: 'http://example.org/l.json', enabled: true, mode: 'act' }] });
    return (JSON.stringify(out.user.artists) === '["A","B"]' && out.settings.lookahead === 7 && out.settings.paused === false
      && out.filterLists[0].enabled === false && out.filterLists[0].mode === 'watch'
      && out.filterLists.length === 2 && out.filterLists[1].id === 'mine' && out.filterLists[1].enabled === false) || JSON.stringify(out);
  }],
]);
