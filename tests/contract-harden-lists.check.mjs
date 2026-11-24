// Contract check (hardening for friends): backup import, list guard, caps, list URLs, log names.
// Run from the repo root: node tests/contract-harden-lists.check.mjs
const { readFileSync } = await import('fs');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const { parseHTML } = await import(process.cwd() + '/tests/dom.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const files = ['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js'];
const M = load(files, { URL }).HM;
const SETTINGS = { ...M.settings.DEFAULTS };
const LISTS = [{ ...M.lists.SOUL_OVER_AI }, { ...M.lists.ZOUNDHUB }];
const cur = { user: M.store.emptyUser(), settings: SETTINGS, filterLists: LISTS };

// 1. backup import
await t('importChanges reports added artists, keywords and songs with first entries', () => {
  const data = { user: { artists: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'], keywords: ['suno'], songs: [{ title: 'Song X', artist: 'Y' }], neverSkip: [] } };
  const c = M.popup.importChanges(cur, data);
  const text = c.join(' | ');
  return (c.length === 3 && /7 artists/.test(text) && /A1/.test(text) && !/A7/.test(text) && /1 keywords?/.test(text) && /suno/.test(text) && /1 songs?/.test(text) && /Song X/.test(text)) || J(c);
});
await t('entries already held are not reported', () => J(M.popup.importChanges({ ...cur, user: { ...M.store.emptyUser(), artists: ['a1'] } }, { user: { artists: ['A1'], songs: [], keywords: [], neverSkip: [] } })) === '[]' || 'reported');
await t('a new list shows its URL', () => {
  const c = M.popup.importChanges(cur, { user: M.store.emptyUser(), filterLists: [{ id: 'x', name: 'Other', url: 'https://lists.example/x.json', enabled: true }] });
  return /lists\.example\/x\.json/.test(c.join('|')) || J(c);
});
await t('importBackup drops investigate and modeChosen', () => {
  const d = M.lists.importBackup({ format: 'human-music-backup', version: 1, user: {}, settings: { mode: 'optimal', investigate: true, modeChosen: true, lookahead: 3 } });
  return (!('investigate' in d.settings) && !('modeChosen' in d.settings) && d.settings.lookahead === 3) || J(d.settings);
});
async function open(initial) {
  const doc = parseHTML(readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8'));
  const storage = fakeStorage(initial);
  const chrome = { storage: { local: storage, onChanged: storage.onChanged }, permissions: { request: (q, cb) => cb(true), remove: (q, cb) => cb && cb(true) }, runtime: { sendMessage: (m, cb) => cb && cb(false) } };
  load([...files, 'popup/popup.js'], { document: doc, chrome, URL, Blob, setTimeout, clearTimeout });
  await settle();
  const $ = (id) => doc.getElementById(id);
  return { doc, storage, $, importFile: async (file) => { $('import-file').files = [file]; $('import-btn').click(); await settle(); } };
}
const START = { 'hm.settings': SETTINGS, 'hm.filterLists': LISTS, 'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] } };
await t('names-only backup asks first and writes nothing until Apply', async () => {
  const p = await open(START);
  await p.importFile({ text: async () => J({ format: 'human-music-backup', version: 1, user: { artists: ['New Act'], songs: [], keywords: [], neverSkip: [] } }) });
  const box = p.$('import-confirm');
  return (box.hidden === false && /New Act/.test(box.textContent) && p.storage.data['hm.user'].artists.length === 0) || 'applied or no prompt';
});
await t('a file over 2 MB is refused with a message', async () => {
  const p = await open(START);
  let read = false;
  await p.importFile({ size: 3 * 1024 * 1024, text: async () => { read = true; return '{}'; } });
  return (!read && /2 MB/.test(p.doc.body.textContent)) || 'not refused';
});

// 2. list guard
const names = (n, p = 'Act') => Array.from({ length: n }, (_, i) => ({ name: `${p} ${i}` }));
await t('a well-known channel ID or Spotify ID added is held', () => {
  const ids = ['UC' + 'a'.repeat(22), 'b'.repeat(22)];
  const r1 = M.lists.checkUpdate(names(200), [...names(200), { name: 'Nobody', channelId: ids[0] }], [], ids);
  const r2 = M.lists.checkUpdate(names(200), [...names(200), { name: 'Nobody 2', spotifyId: ids[1] }], [], ids);
  const ok = M.lists.checkUpdate(names(200), [...names(200), { name: 'Nobody', channelId: 'UC' + 'c'.repeat(22) }], [], ids);
  return (r1 && r2 && ok === null && /well-known/.test(r1.reason)) || J([r1, r2, ok]);
});
await t('more than 500 new entries at once is held even for a big list', () => {
  const r = M.lists.checkUpdate(names(5000), [...names(5000), ...names(501, 'New')], []);
  const ok = M.lists.checkUpdate(names(5000), [...names(5000), ...names(500, 'New')], []);
  return (r && /501/.test(r.reason) && ok === null) || J([r, ok]);
});
await t('well-known.json has an ids section', () => Array.isArray(JSON.parse(readFileSync(process.cwd() + '/extension/lists/well-known.json', 'utf8')).ids) || 'missing');

// 3. caps
await t('parseEntries drops bad names', () => {
  const a = M.lists.parseFilterList(['Good Band', '', '   ', '!!!', 'x', 'The', ' various   ARTISTS ', 'Unknown Artist', 'Various', 'a', 'y'.repeat(201), { name: '...' }, { name: 'Ok Too' }]).artists.map((x) => x.name);
  return J(a) === J(['Good Band', 'Ok Too']) || J(a);
});
await t('a 200-char name is kept', () => M.lists.parseFilterList(['y'.repeat(200)]).artists.length === 1 || 'dropped');
await t('entries per list are capped at 50,000', () => {
  const big = Array.from({ length: 50050 }, (_, i) => 'Band ' + i);
  return M.lists.parseFilterList(big).artists.length === 50000 || 'not capped';
});
await t('parseFilterText caps at 50,000', () => {
  const text = Array.from({ length: 50050 }, (_, i) => 'UC' + String(i).padStart(22, '0')).join('\n');
  return M.lists.parseFilterText(text).artists.length === 50000 || 'not capped';
});

// 4. list URLs
for (const u of ['https://127.0.0.1/a.json', 'https://localhost/a.json', 'https://[::1]/a.json', 'https://nas.local/a.json', 'https://x.internal/a.json', 'https://192.168.1.5/a.json', 'https://2130706433/a.json']) {
  await t('refused: ' + u, () => { try { M.popup.addFilterList([], u, ''); return 'accepted'; } catch (e) { return /local or private/.test(e.message) || e.message; } });
}
await t('a normal host is accepted', () => M.popup.addFilterList([], 'https://lists.example.com/a.json', '').length === 1 || 'refused');

// 5. log names
await t('a Spotify ID entry falls back to the credit line', () => {
  const a = M.popup.groupLog([{ rule: 'artist', entry: '4iHNK0tOyZPYnBU7nGAgpQ', artistLine: 'Real Name • Album', event: 'skipped', title: 't', at: 1 }]);
  return a[0].artist === 'Real Name' || J(a[0].artist);
});

if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
console.log('harden-lists contract ok');
