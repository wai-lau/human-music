// Contract check: Cevval's list as a built-in (Wai, 2026-11-16: Cevval only, of ytm-deslop's lists).
// A plain-text list of YouTube channel IDs, public domain (Unlicense). Run from the repo root:
//   node tests/wip-contract-cevval.check.mjs
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
runInContext(readFileSync(process.cwd() + '/extension/src/core/match.js', 'utf8'), ctx);
const { HM } = ctx;
const sample = readFileSync(process.cwd() + '/tests/fixtures/cevval-sample.txt', 'utf8');
const URL_ = 'https://raw.githubusercontent.com/cevvalkoala/CevvalYoutubeAIBlocklist/main/CevvalYoutubeAIblocklist.txt';

await t('CEVVAL is a built-in list', () => {
  const c = HM.lists.CEVVAL || {};
  return (c.id === 'cevval' && c.name === 'Cevval AI music list' && c.url === URL_ && c.builtIn === true && c.mode === 'act' && c.enabled === true) || J(c);
});
await t('text lists: unique channel IDs, comments and @handles ignored', () => {
  const v = HM.lists.parseFilterText(sample);
  return J(v.artists) === J([{ channelId: 'UCIE9zgCYFKd-GLQX5jwhceA' }, { channelId: 'UCfEyz1qa5934AyDOxYGEmBA' }]) || J(v);
});
await t('a text list with no channel IDs parses to nothing', () => HM.lists.parseFilterText('! only comments\n@handle\n').artists.length === 0);
await t('the refresher reads a text list', async () => {
  const storage = fakeStorage({ 'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI }, { ...HM.lists.CEVVAL }] });
  const r = HM.createRefresher({ storage, fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => sample }), now: () => 1, assetUrl: p => p });
  const ok = await r.refreshOne('cevval');
  const meta = storage.data['hm.filterLists'][1];
  return (ok === true && meta.count === 2 && storage.data['hm.list.cevval'].artists.length === 2) || J({ ok, meta });
});
await t('install and start include it', async () => {
  const s1 = fakeStorage({});
  const fetch = async url => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => (url === 'lists/index.json' ? '{"files":[]}' : '') });
  await HM.createRefresher({ storage: s1, fetch, now: () => 1, assetUrl: p => p }).install();
  const s2 = fakeStorage({ 'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI }] });
  await HM.createRefresher({ storage: s2, fetch, now: () => 1, assetUrl: p => p }).importBundled();
  const ids = s => s.data['hm.filterLists'].map(l => l.id);
  return (ids(s1).includes('cevval') && ids(s2).includes('cevval')) || J({ s1: ids(s1), s2: ids(s2) });
});
await t('an ID-only entry matches by channel ID', () => {
  const index = HM.match.buildIndex({ filterLists: [{ ...HM.lists.CEVVAL, artists: [{ channelId: 'UCIE9zgCYFKd-GLQX5jwhceA' }] }], user: { artists: [], songs: [], keywords: [], neverSkip: [] }, threshold: null });
  const m = HM.match.matchItem(index, { title: 'X', credits: ['Some Name'], channelIds: ['UCIE9zgCYFKd-GLQX5jwhceA'], featured: false });
  return (!!m && m.rule === 'channel' && m.listId === 'cevval') || J(m);
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
