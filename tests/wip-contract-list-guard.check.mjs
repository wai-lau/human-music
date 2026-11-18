// Contract check (security hardening (a), Wai 2026-11-18: yes): a hacked or mistaken list must not
// make everyone skip a star. A list update that names a well-known artist made by people
// (extension/lists/well-known.json), or suddenly adds far more names than it had, is held: the
// list goes to Watch only (it logs what it would skip and never acts), the data is still stored,
// and the popup's Errors section says why. The person can let it act again with its Watch only
// switch; the hold is then cleared.
// Run from the repo root: node tests/wip-contract-list-guard.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const { parseHTML, Event } = await import(process.cwd() + '/tests/dom.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const WELL_KNOWN = JSON.parse(readFileSync(process.cwd() + '/extension/lists/well-known.json', 'utf8'));
const names = (n, p = 'Act') => Array.from({ length: n }, (_, i) => ({ name: `${p} ${i}` }));

// --- the check itself: HM.lists.checkUpdate(oldArtists, newArtists, wellKnownNames) -> null | { reason } ---
const L = load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js']).HM.lists;
await t('well-known.json lists the stars to protect', () => (Array.isArray(WELL_KNOWN.names) && WELL_KNOWN.names.length >= 100 && WELL_KNOWN.names.includes('Taylor Swift') && WELL_KNOWN.names.includes('Wet Leg')) || 'list');
await t('normal growth passes', () => L.checkUpdate(names(200), [...names(200), ...names(40, 'New')], WELL_KNOWN.names) === null || 'held');
await t('a well-known name added is held, and the reason names it (spacing and case ignored)', () => {
  const r = L.checkUpdate(names(200), [...names(200), { name: '  taylor  SWIFT ' }], WELL_KNOWN.names);
  return (r && /well-known/i.test(r.reason) && /taylor swift/i.test(r.reason)) || J(r);
});
await t('a well-known name in a list\'s first download is held too', () => {
  const r = L.checkUpdate([], [...names(30), { name: 'Wet Leg' }], WELL_KNOWN.names);
  return (r && /Wet Leg/.test(r.reason)) || J(r);
});
await t('a well-known name already on the list before is not held again', () =>
  L.checkUpdate([...names(10), { name: 'Wet Leg' }], [...names(10), { name: 'Wet Leg' }], WELL_KNOWN.names) === null || 'held');
await t('adding more than half again (and over 100) at once is held, with the count', () => {
  const big = L.checkUpdate(names(300), [...names(300), ...names(160, 'New')], WELL_KNOWN.names); // 160 > max(100, 150)
  const small = L.checkUpdate(names(20), [...names(20), ...names(90, 'New')], WELL_KNOWN.names); // 90 <= 100
  const first = L.checkUpdate([], names(5000), WELL_KNOWN.names); // a first download is never "too many"
  return (big && /160/.test(big.reason) && small === null && first === null) || J({ big, small, first });
});
await t('channel-ID-only entries (no name) never trip the name check', () =>
  L.checkUpdate([], [{ channelId: 'UC' + 'a'.repeat(22) }], WELL_KNOWN.names) === null || 'held');

// --- the refresher holds a list ---
let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const { HM } = ctx;
const META = { id: 'mine', name: 'Mine', url: 'https://lists.example/m.json', enabled: true, mode: 'act', builtIn: false, lastRefresh: 1, count: 200, lastError: null };
const fetchWith = (body) => async (url) => ({ ok: true, status: 200, headers: { get: () => null },
  text: async () => (url === 'lists/well-known.json' ? JSON.stringify(WELL_KNOWN) : JSON.stringify(body)) });
await t('an update naming a star: stored, but the list goes to Watch only with the reason', async () => {
  const storage = fakeStorage({ 'hm.filterLists': [{ ...META }], 'hm.list.mine': { artists: names(200) } });
  const r = HM.createRefresher({ storage, fetch: fetchWith({ artists: [...names(200), { name: 'Drake' }] }), now: () => 50, assetUrl: (p) => p });
  await r.refreshOne('mine');
  const m = storage.data['hm.filterLists'][0];
  return (m.mode === 'watch' && m.held && /Drake/.test(m.held.reason) && m.held.at === 50 && storage.data['hm.list.mine'].artists.length === 201) || J(m);
});
await t('an ordinary update leaves the mode alone', async () => {
  const storage = fakeStorage({ 'hm.filterLists': [{ ...META }], 'hm.list.mine': { artists: names(200) } });
  const r = HM.createRefresher({ storage, fetch: fetchWith({ artists: [...names(200), { name: 'Fresh Bot' }] }), now: () => 50, assetUrl: (p) => p });
  await r.refreshOne('mine');
  const m = storage.data['hm.filterLists'][0];
  return (m.mode === 'act' && !m.held) || J(m);
});
await t('a missing well-known file never blocks a refresh (no hold, no failure)', async () => {
  const storage = fakeStorage({ 'hm.filterLists': [{ ...META }], 'hm.list.mine': { artists: names(200) } });
  const fetch = async (url) => (url === 'lists/well-known.json' ? { ok: false, status: 404, headers: { get: () => null }, text: async () => '' } : { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ artists: [...names(200), { name: 'Drake' }] }) });
  const r = HM.createRefresher({ storage, fetch, now: () => 50, assetUrl: (p) => p });
  const ok = await r.refreshOne('mine');
  const m = storage.data['hm.filterLists'][0];
  return (ok === true && m.mode === 'act') || J({ ok, m });
});

// --- the popup says so, and letting the list act again clears the hold ---
async function popup(initial) {
  const doc = parseHTML(readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8'));
  const storage = fakeStorage(initial);
  const chrome = { storage: { local: storage, onChanged: storage.onChanged }, permissions: { request: (q, cb) => cb(true), remove: (q, cb) => cb && cb(true) }, runtime: { sendMessage: (m, cb) => cb && cb(false) } };
  load(['src/core/text.js', 'src/core/store.js', 'src/core/lists.js', 'src/core/settings.js', 'src/core/log.js', 'popup/model.js', 'popup/popup.js'], { document: doc, chrome, URL, Blob, setTimeout, clearTimeout });
  await settle();
  return { doc, storage };
}
const HELD = { ...META, mode: 'watch', held: { at: 50, reason: 'names a well-known artist: Drake' } };
await t('the popup\'s Errors section shows a held list and why', async () => {
  const p = await popup({ 'hm.filterLists': [HELD] });
  const btn = p.doc.querySelector('.seg-btn[data-section="errors"]'); btn.click(); await settle();
  const text = p.doc.querySelector('#log-entries').textContent;
  return (/Mine/.test(text) && /Watch only/.test(text) && /Drake/.test(text)) || text.slice(0, 300);
});
await t('turning its Watch only switch off lets it act again and clears the hold', async () => {
  const p = await popup({ 'hm.filterLists': [HELD] });
  const box = [...p.doc.querySelectorAll('#watch-lists input')].find((i) => /Mine/.test(i.getAttribute('aria-label') || ''));
  box.checked = false; box.dispatchEvent(new Event('change')); await settle();
  const m = p.storage.data['hm.filterLists'][0];
  return (m.mode === 'act' && !m.held) || J(m);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
