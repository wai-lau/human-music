// Contract check: the worker's list fetch has limits (audit 2026-11-13). Run from the repo root:
//   node tests/contract-fetch-limits.check.mjs   (tests/contracts.test.mjs runs them all)
// A subscribed list is untrusted: an http:// address, a redirect, a hang or a huge body
// must never replace the last good copy, and the worker must always answer.
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const HM = ctx.HM;
const NOW = 1_000_000_000_000;
const GOOD = { artists: [{ name: 'Keep' }] };
const list = url => ({ ...HM.lists.SOUL_OVER_AI, id: 'x', builtIn: false, url, lastRefresh: 5, count: 1 });
const body = (text, headers = {}) => ({ ok: true, status: 200, headers: { get: k => headers[k.toLowerCase()] ?? null }, text: async () => text });
const mk = (url, fetch, extra = {}) => {
  const storage = fakeStorage({ 'hm.filterLists': [list(url)], 'hm.list.x': GOOD });
  return { storage, r: HM.createRefresher({ storage, fetch, now: () => NOW, ...extra }) };
};
// The last good copy is kept, the error recorded, and refreshOne answers false.
const keptGood = async (storage, res) => {
  const m = storage.data['hm.filterLists'][0];
  return (res === false && J(storage.data['hm.list.x']) === J(GOOD) && typeof m.lastError === 'string' && m.lastError !== '' && m.count === 1 && m.lastRefresh === 5)
    || J({ res, d: storage.data }).slice(0, 300);
};
const within = (ms, p) => Promise.race([p, new Promise(r => setTimeout(() => r('still waiting after ' + ms + ' ms'), ms))]);

await t('http:// list is not fetched', async () => {
  let called = false;
  const { storage, r } = mk('http://lists.example/a.json', async () => { called = true; return body('["A"]'); });
  const res = await r.refreshOne('x');
  if (called) return 'fetch was called for an http:// address';
  return keptGood(storage, res);
});

await t('javascript: / data: / file: lists are not fetched', async () => {
  for (const url of ['javascript:alert(1)', 'data:application/json,["A"]', 'file:///etc/passwd', 'not a url']) {
    let called = false;
    const { storage, r } = mk(url, async () => { called = true; return body('["A"]'); });
    const res = await r.refreshOne('x');
    if (called) return `fetch was called for ${url}`;
    const k = await keptGood(storage, res);
    if (k !== true) return `${url}: ${k}`;
  }
  return true;
});

await t('fetch refuses redirects and can be aborted', async () => {
  let seen = null;
  const { r } = mk('https://lists.example/a.json', async (url, opts) => { seen = opts; return body('["A"]'); });
  await r.refreshOne('x');
  return (seen && seen.redirect === 'error' && seen.signal && typeof seen.signal.aborted === 'boolean') || 'fetch options: ' + J(seen && { redirect: seen.redirect, signal: !!seen.signal });
});

await t('a good https list still refreshes', async () => {
  const { storage, r } = mk('https://lists.example/a.json', async () => body('[{"name":"A"},{"name":"B"}]', { 'content-type': 'application/json' }));
  const res = await r.refreshOne('x');
  const m = storage.data['hm.filterLists'][0];
  return (res === true && J(storage.data['hm.list.x']) === J({ artists: [{ name: 'A' }, { name: 'B' }] }) && m.count === 2 && m.lastRefresh === NOW && m.lastError === null) || J({ res, d: storage.data });
});

await t('a hanging fetch gives up after timeoutMs (fetch honours abort)', async () => {
  const hang = (url, opts) => new Promise((resolve, reject) => {
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  const { storage, r } = mk('https://lists.example/a.json', hang, { timeoutMs: 50 });
  const res = await within(2000, r.refreshOne('x'));
  if (typeof res === 'string') return res;
  return keptGood(storage, res);
});

await t('a hanging fetch gives up after timeoutMs (fetch ignores abort)', async () => {
  const { storage, r } = mk('https://lists.example/a.json', () => new Promise(() => {}), { timeoutMs: 50 });
  const res = await within(2000, r.refreshOne('x'));
  if (typeof res === 'string') return res;
  return keptGood(storage, res);
});

await t('a body that never finishes gives up after timeoutMs', async () => {
  const slow = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: () => new Promise(() => {}) });
  const { storage, r } = mk('https://lists.example/a.json', slow, { timeoutMs: 50 });
  const res = await within(2000, r.refreshOne('x'));
  if (typeof res === 'string') return res;
  return keptGood(storage, res);
});

await t('a body over maxBytes is refused', async () => {
  const big = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ name: 'Artist ' + i })));
  const { storage, r } = mk('https://lists.example/a.json', async () => body(big), { maxBytes: 1000 });
  return keptGood(storage, await r.refreshOne('x'));
});

await t('a Content-Length over maxBytes is refused without reading the body', async () => {
  let read = false;
  const resp = { ok: true, status: 200, headers: { get: k => (k.toLowerCase() === 'content-length' ? '999999999' : null) }, text: async () => { read = true; return '["A"]'; } };
  const { storage, r } = mk('https://lists.example/a.json', async () => resp, { maxBytes: 1000 });
  const res = await r.refreshOne('x');
  if (read) return 'the body was read despite Content-Length over maxBytes';
  return keptGood(storage, res);
});

await t('defaults: 15 s timeout and 5 MB cap (a 4 MB list is fine)', async () => {
  const names = Array.from({ length: 100000 }, (_, i) => ({ name: 'Artist number ' + i + ' '.repeat(10) }));
  const text = JSON.stringify(names);
  if (text.length < 3_500_000 || text.length > 5_000_000) return 'test body size off: ' + text.length;
  const { storage, r } = mk('https://lists.example/a.json', async () => body(text));
  const res = await r.refreshOne('x');
  return (res === true && storage.data['hm.list.x'].artists.length === 100000) || 'res ' + res;
});

await t('responses without headers still work (older fakes)', async () => {
  const { storage, r } = mk('https://lists.example/a.json', async () => ({ ok: true, status: 200, text: async () => '["A"]' }));
  const res = await r.refreshOne('x');
  return (res === true && storage.data['hm.list.x'].artists.length === 1) || J({ res, d: storage.data });
});

await t('refreshDue with no hm.filterLists resolves to []', async () => {
  const storage = fakeStorage({});
  const r = HM.createRefresher({ storage, fetch: async () => body('[]'), now: () => NOW });
  const ids = await within(2000, r.refreshDue());
  return J(ids) === '[]' || J(ids);
});

await t('refreshOne with no hm.filterLists resolves to false', async () => {
  const storage = fakeStorage({});
  const r = HM.createRefresher({ storage, fetch: async () => body('[]'), now: () => NOW });
  const res = await within(2000, r.refreshOne('soul-over-ai'));
  return res === false || J(res);
});

// settings: only real refresh frequencies are kept (no inherited Object keys).
await t('settings refuse inherited keys as a refresh frequency', async () => {
  for (const bad of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf']) {
    const s = HM.settings.sanitize({ refresh: bad });
    if (s.refresh !== 'daily') return `${bad} kept as ${J(s.refresh)}`;
  }
  return HM.settings.sanitize({ refresh: 'weekly' }).refresh === 'weekly' || 'weekly lost';
});

await t('isRefreshDue treats an inherited key as daily', async () => {
  const day = 86400000;
  return (HM.lists.isRefreshDue(NOW - day - 1, 'toString', NOW) === true && HM.lists.isRefreshDue(NOW - 1000, 'toString', NOW) === false) || 'toString not treated as daily';
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
