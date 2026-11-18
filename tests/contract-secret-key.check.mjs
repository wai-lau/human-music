// Contract check (security hardening (c), Wai 2026-11-18: yes): the investigator key moves out of
// chrome.storage.local, which the content scripts on music pages can read, into the extension's own
// IndexedDB (the extension's origin), which only extension pages and the worker reach.
// Interface:
//   extension/src/core/secret.js sets HM.createSecrets(backend) -> { get(name), set(name, value),
//   remove(name) } (all return promises; get gives null when unset). Without a backend it uses
//   IndexedDB (database 'hm-secrets', store 'kv'). HM.secrets = HM.createSecrets(globalThis.__hmSecretBackend)
//   (the global is a test hook; pages can't set the extension's globals).
//   The key's name is 'investigator-token'.
//   HM.moveInvestigatorKey(storage, secrets): a token still in hm.investigator moves to the secrets
//   and leaves storage (run at every worker start).
// Run from the repo root: node tests/contract-secret-key.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const mapBackend = () => { const m = new Map(); return { m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); }, remove: async (k) => { m.delete(k); } }; };

const H = load(['src/core/text.js', 'src/core/store.js', 'src/core/secret.js']).HM;
await t('createSecrets: set, get, remove; unset is null', async () => {
  const s = H.createSecrets(mapBackend());
  await s.set('investigator-token', 'k1');
  const a = await s.get('investigator-token');
  await s.remove('investigator-token');
  const b = await s.get('investigator-token');
  return (a === 'k1' && b === null && (await s.get('other')) === null) || J({ a, b });
});
await t('without a backend it uses IndexedDB', () => /indexedDB/.test(readFileSync(process.cwd() + '/extension/src/core/secret.js', 'utf8')) || 'no IndexedDB backend');

let ctx;
const backend = mapBackend();
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController, AbortSignal, __hmSecretBackend: backend });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const { HM } = ctx;
const NOON = new Date(2026, 10, 16, 12, 0, 0).getTime();
const items = [{ site: 'ytm', title: 'Neon', artistLine: 'Forrest Rose • Album', credits: ['Forrest Rose'], album: 'Album', artUrl: '', channelIds: [] }];

await t('the worker loads secret.js and has HM.secrets', () => (typeof HM.createSecrets === 'function' && HM.secrets && typeof HM.secrets.get === 'function') || 'missing');
await t('the worker sends with the key from the secrets; storage holds no key', async () => {
  const b = mapBackend(); await b.set('investigator-token', 'sekrit');
  const storage = fakeStorage({ 'hm.investigator': { base: 'https://wai-lau.net/human-music', sent: {} } });
  const calls = [];
  const inv = HM.createInvestigator({ storage, secrets: HM.createSecrets(b), fetch: async (url, init) => { calls.push(init); return { ok: true, status: 202, headers: { get: () => null }, text: async () => '{}' }; }, now: () => NOON });
  const r = await inv.send(items);
  return (r.sent === 1 && calls[0].headers.Authorization === 'Bearer sekrit' && !J(storage.data).includes('sekrit')) || J({ r, data: storage.data });
});
await t('a key left in storage is ignored by the worker (only the secrets count)', async () => {
  const storage = fakeStorage({ 'hm.investigator': { token: 'stale', sent: {} } });
  const calls = [];
  const inv = HM.createInvestigator({ storage, secrets: HM.createSecrets(mapBackend()), fetch: async (u, i) => { calls.push(i); return { ok: true, status: 202, headers: { get: () => null }, text: async () => '{}' }; }, now: () => NOON });
  const r = await inv.send(items);
  return (r.sent === 0 && calls.length === 0) || J({ r, calls: calls.length });
});
await t('moveInvestigatorKey: a stored key moves to the secrets and leaves storage, the rest stays', async () => {
  const b = mapBackend();
  const storage = fakeStorage({ 'hm.investigator': { token: 'old-key', base: 'https://wai-lau.net/human-music', sent: { a: '2026-11-17' }, lastError: 'HTTP 503' } });
  await HM.moveInvestigatorKey(storage, HM.createSecrets(b));
  const rec = storage.data['hm.investigator'];
  return (b.m.get('investigator-token') === 'old-key' && !('token' in rec) && rec.sent.a === '2026-11-17' && rec.lastError === 'HTTP 503') || J({ rec, secret: b.m.get('investigator-token') });
});
await t('moveInvestigatorKey with no stored key changes nothing (and never clears a saved secret)', async () => {
  const b = mapBackend(); await b.set('investigator-token', 'keep');
  const storage = fakeStorage({ 'hm.investigator': { sent: {} } });
  await HM.moveInvestigatorKey(storage, HM.createSecrets(b));
  return (b.m.get('investigator-token') === 'keep') || 'cleared';
});
await t('the worker start moves a stored key (moveInvestigatorKey is defined and also called)', () => {
  const bg = readFileSync(process.cwd() + '/extension/src/background.js', 'utf8');
  return (bg.split('moveInvestigatorKey(').length - 1 >= 2) || 'not called at start';
});
await t('content scripts never load secret.js', () => {
  const manifest = JSON.parse(readFileSync(process.cwd() + '/extension/manifest.json', 'utf8'));
  const cs = (manifest.content_scripts || []).flatMap((c) => c.js || []);
  const bg = readFileSync(process.cwd() + '/extension/src/background.js', 'utf8');
  const injected = (bg.match(/files:\s*\[[^\]]*\]/g) || []).join(' ');
  return (!cs.some((f) => /secret/.test(f)) && !/secret/.test(injected)) || J({ cs, injected });
});
await t('the popup loads secret.js', () => /core\/secret\.js/.test(readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8')) || 'popup.html has no secret.js');

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
