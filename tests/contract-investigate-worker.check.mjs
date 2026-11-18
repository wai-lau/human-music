// Contract check for the investigator plan, Task 5 (the worker sends unknown artists). Run from the repo root:
//   node tests/contract-investigate-worker.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController, AbortSignal });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const { HM } = ctx;
const DAY = 86400000;
const NOON = new Date(2026, 10, 16, 12, 0, 0).getTime();
const items = [
  { site: 'ytm', title: 'Neon', artistLine: 'Forrest Rose • Album', credits: ['Forrest Rose'], album: 'Album', artUrl: 'https://lh3.googleusercontent.com/x', channelIds: [] },
  { site: 'spotify', title: 'Static', artistLine: 'The Broken Radios', credits: ['The Broken Radios'], album: '', artUrl: '', channelIds: ['0000000000000000000000'] },
];
function rig({ token = 't0k', status = 202, now = NOON, stored = {} } = {}) {
  const calls = [];
  const storage = fakeStorage({ 'hm.investigator': { token, ...stored } });
  const fetch = async (url, init = {}) => { calls.push({ url, init }); return { ok: status < 400, status, headers: { get: () => null }, text: async () => '{}' }; };
  let clock = now;
  const inv = HM.createInvestigator({ storage, fetch, now: () => clock });
  return { inv, calls, storage, tick: ms => { clock += ms; } };
}

await t('createInvestigator exists', () => typeof HM.createInvestigator === 'function' || 'missing');
await t('no token: nothing sent, no fetch', async () => {
  const r = rig({ token: '' });
  const res = await r.inv.send(items);
  return (res.sent === 0 && r.calls.length === 0) || J({ res, calls: r.calls.length });
});
await t('sends one batch with the token, as JSON, to the default address', async () => {
  const r = rig();
  const res = await r.inv.send(items);
  const c = r.calls[0] || { init: {} };
  const h = c.init.headers || {};
  const body = JSON.parse(c.init.body || '{}');
  return (res.sent === 2 && r.calls.length === 1 && c.url === 'https://wai-lau.net/human-music/api/investigate' && c.init.method === 'POST'
    && h.Authorization === 'Bearer t0k' && /json/.test(h['Content-Type'] || '') && Array.isArray(body.items) && body.items.length === 2
    && body.items[0].credits[0] === 'Forrest Rose') || J({ res, c: { url: c.url, method: c.init.method, h, body } });
});
await t('a custom base address is used', async () => {
  const r = rig({ stored: { base: 'https://example.test/hm' } });
  await r.inv.send(items);
  return r.calls[0].url === 'https://example.test/hm/api/investigate' || r.calls[0].url;
});
await t('the same artists the same day: skipped; the next day: sent again', async () => {
  const r = rig();
  await r.inv.send(items);
  const again = await r.inv.send(items);
  r.tick(DAY);
  const next = await r.inv.send(items);
  return (again.sent === 0 && again.skipped === 2 && next.sent === 2 && r.calls.length === 2) || J({ again, next, calls: r.calls.length });
});
await t('the sent record lives in storage (survives a worker restart)', async () => {
  const r = rig();
  await r.inv.send(items);
  const fresh = HM.createInvestigator({ storage: r.storage, fetch: async () => { throw new Error('should not send'); }, now: () => NOON + 3600000 });
  const res = await fresh.send(items);
  return (res.sent === 0 && Object.keys(r.storage.data['hm.investigator'].sent || {}).length >= 2) || J({ res, inv: r.storage.data['hm.investigator'] });
});
await t('a failed send is recorded and not retried the same day', async () => {
  const r = rig({ status: 503 });
  await r.inv.send(items);
  const again = await r.inv.send(items);
  const st = r.storage.data['hm.investigator'];
  return (st.lastError === 'HTTP 503' && again.sent === 0 && r.calls.length === 1) || J({ st, again, calls: r.calls.length });
});
await t('a network error never throws', async () => {
  const storage = fakeStorage({ 'hm.investigator': { token: 't0k' } });
  const inv = HM.createInvestigator({ storage, fetch: async () => { throw new Error('offline'); }, now: () => NOON });
  const res = await inv.send(items);
  return (res.sent === 0 && /offline/.test(storage.data['hm.investigator'].lastError || '')) || J({ res, st: storage.data['hm.investigator'] });
});
await t('the token is never written anywhere else', async () => {
  const r = rig();
  await r.inv.send(items);
  const elsewhere = Object.entries(r.storage.data).filter(([k]) => k !== 'hm.investigator').some(([, v]) => J(v).includes('t0k'));
  return !elsewhere || 'token copied';
});
await t('one artist on two albums the same day: sent once (keys come from the credits)', async () => {
  const r = rig();
  await r.inv.send([items[0]]);
  const other = { ...items[0], title: 'Glass', artistLine: 'Forrest Rose • Second Album', album: 'Second Album' };
  const res = await r.inv.send([other]);
  return (res.sent === 0 && res.skipped === 1 && r.calls.length === 1) || J({ res, calls: r.calls.length });
});
await t('a later success clears the last error', async () => {
  let status = 503;
  const storage = fakeStorage({ 'hm.investigator': { token: 't0k' } });
  let clock = NOON;
  const inv = HM.createInvestigator({ storage, fetch: async () => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => '{}' }), now: () => clock });
  await inv.send(items);
  status = 202; clock += DAY;
  await inv.send(items);
  const st = storage.data['hm.investigator'];
  return (st.lastError === null || st.lastError === undefined) || J(st);
});
await t('the token never goes to a plain http address', async () => {
  const r = rig({ stored: { base: 'http://example.test/hm' } });
  const res = await r.inv.send(items);
  return (r.calls.length === 0 && res.sent === 0 && typeof r.storage.data['hm.investigator'].lastError === 'string') || J({ res, calls: r.calls.map(c => c.url) });
});
await t('items with missing fields never throw', async () => {
  const r = rig();
  const res = await r.inv.send([{}, null, { credits: [null, 'Forrest Rose'] }]);
  return (typeof res.sent === 'number' && typeof res.skipped === 'number') || J(res);
});
await t('fresh verdicts: a start refreshes hm-verdicts only after a recent send, at most every 5 minutes', () => {
  const due = HM.verdictsRefreshDue;
  if (typeof due !== 'function') return 'HM.verdictsRefreshDue missing';
  const MIN = 60000;
  const lists = lastRefresh => [{ id: 'soul-over-ai', lastRefresh: null }, { id: 'hm-verdicts', enabled: true, lastRefresh }];
  const cases = [
    [due({ lastSentAt: NOON - 10 * MIN }, lists(NOON - 6 * MIN), NOON), true],
    [due({ lastSentAt: NOON - 10 * MIN }, lists(null), NOON), true],
    [due({ lastSentAt: NOON - 10 * MIN }, lists(NOON - 4 * MIN), NOON), false],
    [due({ lastSentAt: NOON - 31 * MIN }, lists(NOON - 60 * MIN), NOON), false],
    [due({}, lists(null), NOON), false],
    [due(undefined, lists(null), NOON), false],
    [due({ lastSentAt: NOON - MIN }, [{ id: 'hm-verdicts', enabled: false, lastRefresh: null }], NOON), false],
    [due({ lastSentAt: NOON - MIN }, undefined, NOON), false],
  ];
  const bad = cases.map(([got, want], i) => got === want ? null : i).filter(i => i !== null);
  return bad.length === 0 || 'wrong for cases ' + J(bad);
});

// A fetch that waits until open() is called, so a test can change storage while a POST is pending.
function gated(storage) {
  let open;
  const gate = new Promise(r => { open = r; });
  const calls = [];
  const fetch = async (url, init = {}) => { calls.push({ url, init }); await gate; return { ok: true, status: 202, headers: { get: () => null }, text: async () => '{}' }; };
  return { fetch, open, calls };
}
const tick = () => new Promise(r => setTimeout(r, 5));

await t('emptying the key while a send is pending: the old key does not come back', async () => {
  const storage = fakeStorage({ 'hm.investigator': { token: 't0k' } });
  const g = gated(storage);
  const inv = HM.createInvestigator({ storage, fetch: g.fetch, now: () => NOON });
  const p = inv.send(items);
  await tick();
  await storage.set({ 'hm.investigator': { ...storage.data['hm.investigator'], token: '' } });
  g.open();
  await p;
  const st = storage.data['hm.investigator'];
  return (st.token === '' && Object.keys(st.sent || {}).length === 2 && typeof st.lastSentAt === 'number') || J(st);
});
await t('rotating the key while a send is pending keeps the new key', async () => {
  const storage = fakeStorage({ 'hm.investigator': { token: 't0k' } });
  const g = gated(storage);
  const inv = HM.createInvestigator({ storage, fetch: g.fetch, now: () => NOON });
  const p = inv.send(items);
  await tick();
  await storage.set({ 'hm.investigator': { ...storage.data['hm.investigator'], token: 'n3w' } });
  g.open();
  await p;
  return storage.data['hm.investigator'].token === 'n3w' || J(storage.data['hm.investigator']);
});
await t('two sends of one artist at once: one fetch', async () => {
  const storage = fakeStorage({ 'hm.investigator': { token: 't0k' } });
  const g = gated(storage);
  const inv = HM.createInvestigator({ storage, fetch: g.fetch, now: () => NOON });
  const a = inv.send([items[0]]);
  const b = inv.send([items[0]]);
  await tick();
  g.open();
  const [ra, rb] = await Promise.all([a, b]);
  return (g.calls.length === 1 && ra.sent + rb.sent === 1 && ra.skipped + rb.skipped === 1) || J({ calls: g.calls.length, ra, rb });
});
await t('the send carries a timeout, no credentials and no redirects', async () => {
  const r = rig();
  await r.inv.send(items);
  const init = r.calls[0].init;
  return (init.signal && typeof init.signal === 'object' && init.credentials === 'omit' && init.redirect === 'error') || J({ credentials: init.credentials, redirect: init.redirect, signal: typeof init.signal });
});
await t('a failed read of the saved state does not block later sends', async () => {
  const real = fakeStorage({ 'hm.investigator': { token: 't0k' } });
  let fail = true;
  const storage = { ...real, get: async k => { if (fail) { fail = false; throw new Error('boom'); } return real.get(k); } };
  const calls = [];
  const inv = HM.createInvestigator({ storage, fetch: async (u, i) => { calls.push(u); return { ok: true, status: 202 }; }, now: () => NOON });
  try { await inv.send(items); } catch (e) { /* the first one may fail */ }
  const res = await inv.send(items);
  return (res.sent === 2 && calls.length === 1) || J({ res, calls: calls.length });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
