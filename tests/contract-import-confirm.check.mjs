// Contract check (security hardening (b), Wai 2026-11-18: yes): importing a backup that changes more
// than names (behaviour settings, the filtering mode, which lists exist, act or watch) shows those
// changes in plain words and asks first; nothing is written until the person presses Apply. A
// backup of names only (artists, songs, keywords, never-skip) imports at once, as today.
// Interface: HM.popup.importChanges(current, data) -> string[] (current: { settings, filterLists };
// data: what HM.lists.importBackup returns). The popup shows them in #import-confirm with buttons
// #import-apply and #import-cancel.
// Run from the repo root: node tests/contract-import-confirm.check.mjs
const { readFileSync } = await import('fs');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const { parseHTML } = await import(process.cwd() + '/tests/dom.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

const files = ['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js'];
const M = load(files).HM;
const SETTINGS = { ...M.settings.DEFAULTS };
const LISTS = [{ ...M.lists.SOUL_OVER_AI }, { ...M.lists.ZOUNDHUB }];

await t('names only: no changes to ask about', () => {
  const data = { user: { artists: ['A'], songs: [], keywords: ['suno'], neverSkip: ['B'] } };
  return J(M.popup.importChanges({ settings: SETTINGS, filterLists: LISTS }, data)) === '[]' || J(M.popup.importChanges({ settings: SETTINGS, filterLists: LISTS }, data));
});
await t('a list with no mode in the backup is not reported as a change', () => {
  const data = { user: M.store.emptyUser(), filterLists: [{ id: 'zoundhub', enabled: true }] };
  return J(M.popup.importChanges({ settings: SETTINGS, filterLists: LISTS }, data)) === '[]' || J(M.popup.importChanges({ settings: SETTINGS, filterLists: LISTS }, data));
});
await t('settings that differ are listed in plain words; equal ones are not', () => {
  const data = { user: M.store.emptyUser(), settings: { ...SETTINGS, autoDislike: !SETTINGS.autoDislike, lookahead: 7, mode: 'aggressive', modeChosen: true } };
  const c = M.popup.importChanges({ settings: SETTINGS, filterLists: LISTS }, data);
  const text = c.join(' | ');
  return (c.length === 3 && /dislike/i.test(text) && /7/.test(text) && /Aggressive/.test(text) && !/modeChosen/.test(text)) || J(c);
});
await t('lists turned off, set to Watch only, or added are listed by name', () => {
  const data = { user: M.store.emptyUser(), filterLists: [
    { ...M.lists.ZOUNDHUB, enabled: false },
    { ...M.lists.SOUL_OVER_AI, mode: 'watch' },
    { id: 'x', name: 'Other list', url: 'https://lists.example/x.json', enabled: true, mode: 'act' },
    { id: 'y', name: 'Plain http', url: 'http://lists.example/y.json', enabled: true, mode: 'act' },
  ] };
  const c = M.popup.importChanges({ settings: SETTINGS, filterLists: LISTS }, data);
  const text = c.join(' | ');
  return (c.length === 3 && /Zoundhub/.test(text) && /off/i.test(text) && /Soul Over AI/.test(text) && /Watch only/.test(text) && /Other list/.test(text) && !/Plain http/.test(text)) || J(c);
});

async function open(initial) {
  const doc = parseHTML(readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8'));
  const storage = fakeStorage(initial);
  const chrome = { storage: { local: storage, onChanged: storage.onChanged }, permissions: { request: (q, cb) => cb(true), remove: (q, cb) => cb && cb(true) }, runtime: { sendMessage: (m, cb) => cb && cb(false) } };
  load([...files, 'popup/popup.js'], { document: doc, chrome, URL, Blob, setTimeout, clearTimeout });
  await settle();
  const $ = (id) => doc.getElementById(id);
  const importFile = async (obj) => { $('import-file').files = [{ text: async () => JSON.stringify(obj) }]; $('import-btn').click(); await settle(); };
  return { doc, storage, $, importFile };
}
const START = { 'hm.settings': SETTINGS, 'hm.filterLists': LISTS, 'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] } };
const RISKY = { format: 'human-music-backup', version: 1, user: { artists: ['New Act'], songs: [], keywords: [], neverSkip: [] }, settings: { ...SETTINGS, autoDislike: true, mode: 'aggressive', modeChosen: true }, filterLists: [{ ...M.lists.ZOUNDHUB, enabled: false }] };

await t('a backup with more than names: the changes show, nothing is written yet', async () => {
  const p = await open(START);
  await p.importFile(RISKY);
  const box = p.$('import-confirm');
  const shown = box && box.hidden === false && /dislike/i.test(box.textContent) && /Zoundhub/.test(box.textContent) && p.$('import-apply') && p.$('import-cancel');
  const untouched = J(p.storage.data['hm.settings']) === J(SETTINGS) && p.storage.data['hm.user'].artists.length === 0 && p.storage.data['hm.filterLists'][1].enabled === true;
  return (shown && untouched) || J({ shown: !!shown, untouched, text: box && box.textContent.slice(0, 200) });
});
await t('Apply writes all of it; the confirm box closes', async () => {
  const p = await open(START);
  await p.importFile(RISKY);
  p.$('import-apply').click(); await settle();
  const s = p.storage.data['hm.settings'];
  return (s.autoDislike === true && s.mode === 'aggressive' && p.storage.data['hm.user'].artists.includes('New Act') && p.storage.data['hm.filterLists'].find((l) => l.id === 'zoundhub').enabled === false && p.$('import-confirm').hidden === true) || J({ s, user: p.storage.data['hm.user'] });
});
await t('Cancel writes nothing and says so', async () => {
  const p = await open(START);
  await p.importFile(RISKY);
  p.$('import-cancel').click(); await settle();
  return (J(p.storage.data['hm.settings']) === J(SETTINGS) && p.storage.data['hm.user'].artists.length === 0 && p.$('import-confirm').hidden === true && /nothing/i.test(p.$('status').textContent)) || J({ status: p.$('status').textContent });
});
await t('a names-only backup imports at once, without asking', async () => {
  const p = await open(START);
  await p.importFile({ format: 'human-music-backup', version: 1, user: { artists: ['Only Names'], songs: [], keywords: [], neverSkip: [] } });
  return (p.storage.data['hm.user'].artists.includes('Only Names') && (!p.$('import-confirm') || p.$('import-confirm').hidden === true)) || J(p.storage.data['hm.user']);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
