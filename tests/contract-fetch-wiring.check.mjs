// Contract check (security audit 2026-11-17, finding 4): the worker's REAL wiring keeps the list
// download limits. The old fetch-limits contract injected its own fetch, so it passed while the
// running worker called fetch(url) with no options: redirects (even to http://) were followed and
// a huge body was read in full. Here background.js runs as the browser loads it, with a fake
// global fetch and a fake chrome. Run from the repo root:
//   node tests/contract-fetch-wiring.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

function boot(fetchImpl, initial = {}) {
  const calls = [];
  const storage = fakeStorage(initial);
  const area = { get: storage.get, set: storage.set };
  const ev = () => ({ addListener() {} });
  const chrome = {
    storage: { local: area, onChanged: ev() },
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p, onInstalled: ev(), onStartup: ev(), onMessage: ev(), reload() {} },
    management: { getSelf: cb => cb({ installType: 'normal' }) },
    action: { setBadgeBackgroundColor() {}, setBadgeTextColor() {}, setBadgeText() {} },
    scripting: { executeScript: async () => [] },
    tabs: { query: async () => [] },
  };
  const fetch = async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); };
  let ctx;
  const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
  ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController, TextDecoder, chrome, fetch });
  runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
  return { HM: ctx.HM, calls, storage };
}
const listMeta = url => ({ id: 'x', name: 'X', url, enabled: true, mode: 'act', builtIn: false, lastRefresh: 5, count: 1, lastError: null });
const GOOD = { artists: [{ name: 'Keep' }] };
const settle = () => new Promise(r => setTimeout(r, 30));

await t('the real refresher fetches lists with redirect: error, a signal and no credentials', async () => {
  const b = boot(async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '["A"]' }), { 'hm.filterLists': [listMeta('https://lists.example/a.json')], 'hm.list.x': GOOD });
  await settle();
  b.calls.length = 0;
  await b.HM.refresher.refreshOne('x');
  const c = b.calls.find(x => x.url === 'https://lists.example/a.json');
  const init = (c && c.init) || {};
  return (!!c && init.redirect === 'error' && !!init.signal && init.credentials === 'omit') || J({ url: c && c.url, init: init && { redirect: init.redirect, signal: !!init.signal, credentials: init.credentials } });
});
await t('a body past the size cap is cut off while streaming, and the last good copy stays', async () => {
  // Each read of the list gets its own endless stream of 1 MB chunks (the worker's own start
  // refreshes the list too); a reader must stop by the 6th chunk past the 5 MB cap.
  const readers = [];
  const chunk = new Uint8Array(1024 * 1024).fill(32);
  const stream = () => ({ getReader: () => { const r = { pulled: 0, cancelled: false }; readers.push(r); return { read: async () => { r.pulled++; return r.pulled > 200 ? { done: true } : { done: false, value: chunk }; }, cancel: async () => { r.cancelled = true; }, releaseLock() {} }; } });
  const b = boot(async () => ({ ok: true, status: 200, headers: { get: () => null }, body: stream(), text: async () => { throw new Error('read in full'); } }), { 'hm.filterLists': [listMeta('https://lists.example/a.json')], 'hm.list.x': GOOD });
  await settle();
  const res = await b.HM.refresher.refreshOne('x');
  const ok = readers.length > 0 && readers.every(r => r.pulled <= 6 && r.cancelled);
  return (res === false && ok && J(b.storage.data['hm.list.x']) === J(GOOD) && /over/.test(b.storage.data['hm.filterLists'][0].lastError || '')) || J({ res, readers, err: b.storage.data['hm.filterLists'][0].lastError });
});
await t('a list that just failed is not fetched again at every start (an hour\'s rest)', async () => {
  let n = 0;
  const b = boot(async () => { n++; return { ok: false, status: 503, headers: { get: () => null }, text: async () => '' }; }, { 'hm.filterLists': [listMeta('https://lists.example/a.json')], 'hm.list.x': GOOD, 'hm.settings': { refresh: 'daily' } });
  await settle();
  const before = n;
  await b.HM.refresher.refreshDue();
  await b.HM.refresher.refreshDue();
  return (n - before <= 1 && !!b.storage.data['hm.filterLists'][0].lastError) || J({ fetched: n - before, meta: b.storage.data['hm.filterLists'][0] });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
