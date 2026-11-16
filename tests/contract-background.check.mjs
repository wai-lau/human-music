// Contract check for Task 7 (service worker list refresh). Run from the repo root:
//   node tests/contract-background.check.mjs   (from the repo root; tests/contracts.test.mjs runs them all)
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const sortKeys = v => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])) : v;
const J = v => JSON.stringify(sortKeys(v));
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
try {
  ctx = load([], { importScripts });
  runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
} catch (e) { fails.push(`load without chrome threw: ${e.message}`); }
const HM = ctx.HM || {};
const NOW = 1_000_000_000_000;
const ok = body => async () => ({ ok: true, status: 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const status = code => async () => ({ ok: false, status: code, text: async () => 'nope' });
const reject = async () => { throw new Error('offline'); };
const SOA = () => ({ ...HM.lists.SOUL_OVER_AI });
const mk = (initial, fetch) => { const storage = fakeStorage(initial); return { storage, r: HM.createRefresher({ storage, fetch, now: () => NOW }) }; };

if (typeof HM.createRefresher !== 'function') fails.push('HM.createRefresher missing');
else {
  await t('install on empty storage', async () => {
    const { storage, r } = mk({}, ok([{ name: 'A' }, { name: 'B' }]));
    await r.install();
    const d = storage.data;
    eq('install settings', d['hm.settings'], HM.settings.DEFAULTS);
    eq('install user', d['hm.user'], { artists: [], songs: [], keywords: [], neverSkip: [] });
    eq('install list data', d['hm.list.soul-over-ai'], { artists: [{ name: 'A' }, { name: 'B' }] });
    const m = d['hm.filterLists'];
    // Soul Over AI first; the verdict list (investigator plan, 2026-11-16) is the second built-in.
    return (m.length === 2 && m[0].id === 'soul-over-ai' && m[0].count === 2 && m[0].lastRefresh === NOW && m[0].lastError === null && m[0].builtIn === true && m[1].id === 'hm-verdicts') || J(m);
  });
  await t('install keeps existing', async () => {
    const user = { artists: ['X'], songs: [], keywords: [], neverSkip: [] };
    const settings = { ...HM.settings.DEFAULTS, lookahead: 7 };
    const { storage, r } = mk({ 'hm.user': user, 'hm.settings': settings, 'hm.filterLists': [{ ...SOA(), enabled: false }] }, ok(['A']));
    await r.install();
    return (J(storage.data['hm.user']) === J(user) && storage.data['hm.settings'].lookahead === 7 && storage.data['hm.filterLists'][0].enabled === false) || J(storage.data);
  });
  await t('refreshOne ok', async () => {
    const { storage, r } = mk({ 'hm.filterLists': [SOA()] }, ok([{ name: 'A', removed: false }, { name: 'Z', removed: true }, { name: 'B' }]));
    const res = await r.refreshOne('soul-over-ai');
    const m = storage.data['hm.filterLists'][0];
    return (res === true && J(storage.data['hm.list.soul-over-ai']) === J({ artists: [{ name: 'A' }, { name: 'B' }] }) && m.count === 2 && m.lastRefresh === NOW && m.lastError === null) || J({ res, d: storage.data });
  });
  for (const [label, fetch] of [['html page', ok('<html>error</html>')], ['broken json', ok('{"artists": [')], ['not a list', ok({ foo: 1 })], ['http 500', status(500)], ['fetch rejects', reject]]) {
    await t(`keeps last good copy: ${label}`, async () => {
      const good = { artists: [{ name: 'Keep' }] };
      const meta = { ...SOA(), lastRefresh: 5, count: 1 };
      const { storage, r } = mk({ 'hm.filterLists': [meta], 'hm.list.soul-over-ai': good }, fetch);
      const res = await r.refreshOne('soul-over-ai');
      const m = storage.data['hm.filterLists'][0];
      return (res === false && J(storage.data['hm.list.soul-over-ai']) === J(good) && typeof m.lastError === 'string' && m.lastError.length > 0 && m.lastRefresh === 5 && m.count === 1) || J({ res, d: storage.data });
    });
  }
  await t('first-ever failure leaves an empty list', async () => {
    const { storage, r } = mk({ 'hm.filterLists': [SOA()] }, reject);
    const res = await r.refreshOne('soul-over-ai');
    return (res === false && J(storage.data['hm.list.soul-over-ai']) === J({ artists: [] })) || J({ res, d: storage.data });
  });
  await t('unknown id', async () => { const { r } = mk({ 'hm.filterLists': [SOA()] }, ok(['A'])); return (await r.refreshOne('nope')) === false || 'not false'; });
  await t('refreshDue picks due, enabled lists', async () => {
    const lists = [
      { ...SOA(), id: 'old', url: 'https://a/old', lastRefresh: NOW - 25 * 3600000 },
      { ...SOA(), id: 'fresh', url: 'https://a/fresh', lastRefresh: NOW - 3600000 },
      { ...SOA(), id: 'off', url: 'https://a/off', enabled: false, lastRefresh: null },
      { ...SOA(), id: 'never', url: 'https://a/never', lastRefresh: null },
    ];
    const urls = [];
    const fetch = async url => { urls.push(url); return ok(['A'])(); };
    const { storage, r } = mk({ 'hm.filterLists': lists, 'hm.settings': { ...HM.settings.DEFAULTS, refresh: 'daily' } }, fetch);
    const ids = await r.refreshDue();
    return (J(ids) === J(['old', 'never']) && J(urls) === J(['https://a/old', 'https://a/never']) && storage.data['hm.filterLists'].find(l => l.id === 'old').lastRefresh === NOW) || J({ ids, urls });
  });
  await t('refreshDue manual refreshes only never-fetched', async () => {
    const lists = [{ ...SOA(), id: 'a', lastRefresh: 1 }, { ...SOA(), id: 'b', lastRefresh: null }];
    const { r } = mk({ 'hm.filterLists': lists, 'hm.settings': { ...HM.settings.DEFAULTS, refresh: 'manual' } }, ok(['A']));
    const ids = await r.refreshDue();
    return J(ids) === J(['b']) || J(ids);
  });
}

// chrome wiring: no alarms (Wai, 2026-11-13: "minimize required permissions"); a due list is
// refreshed whenever the worker starts, which a music tab or the popup makes happen.
await t('chrome hooks registered; due lists refreshed when the worker starts, no alarms', async () => {
  const seen = { fetched: [] };
  const ev = name => ({ addListener: fn => { seen[name] = fn; } });
  const storage = fakeStorage({ 'hm.filterLists': [{ ...SOA(), lastRefresh: 1 }], 'hm.settings': { refresh: 'daily' } });
  const chrome = { storage: { local: storage }, runtime: { onInstalled: ev('installed'), onMessage: ev('message') } };
  const fetchSpy = (url, opts) => { seen.fetched.push(url); return ok(['A'])(url, opts); };
  const c2 = load([], { chrome, importScripts: (...f) => { for (const x of f) runInContext(readFileSync(process.cwd() + '/extension/src/' + x, 'utf8'), c2); }, fetch: fetchSpy, setTimeout, clearTimeout, AbortController });
  runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), c2);
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
  const kept = seen.message && seen.message({ type: 'refresh', id: 'soul-over-ai' }, {}, () => {});
  return (typeof seen.installed === 'function' && kept === true && typeof c2.HM.refresher === 'object' && seen.fetched.length >= 1)
    || J({ keys: Object.keys(seen), kept, fetched: seen.fetched });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
