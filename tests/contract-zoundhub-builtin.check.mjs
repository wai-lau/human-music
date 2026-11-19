// Contract check: Zoundhub as a built-in list (Wai, 2026-11-18: switch to Zoundhub now, "1A" a
// daily mirror). The list is the mirror in the verdicts repo (zoundhub.json), on and acting. New
// installs start with Soul Over AI (frozen since March 2026) off; copies that already exist keep
// Soul Over AI as their owner set it and gain Zoundhub at their next start.
// Run from the repo root: node tests/contract-zoundhub-builtin.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const { HM } = ctx;
const URL_ = 'https://raw.githubusercontent.com/wai-lau/human-music-verdicts/main/zoundhub.json';
const fetch = async (url) => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => (url === 'lists/index.json' ? '{"files":[]}' : JSON.stringify({ name: 'Zoundhub', artists: [{ name: 'Clear Bot', spotifyId: 'A'.repeat(22) }, { name: 'Shared', spotifyId: 'B'.repeat(22), idOnly: true }] })) });
const refresher = (storage) => HM.createRefresher({ storage, fetch, now: () => 1, assetUrl: (p) => p });

await t('ZOUNDHUB is a built-in list read from the mirror, on and acting', () => {
  const z = HM.lists.ZOUNDHUB || {};
  return (z.id === 'zoundhub' && z.name === 'Zoundhub' && z.url === URL_ && z.builtIn === true && z.mode === 'act' && z.enabled === true) || J(z);
});
// Wai, 2026-11-19: "B" (Soul Over AI and Zoundhub stay two lists, Soul Over AI on again).
await t('a new install has Zoundhub and Soul Over AI both on', async () => {
  const s = fakeStorage({});
  await refresher(s).install();
  const by = Object.fromEntries(s.data['hm.filterLists'].map((l) => [l.id, l]));
  return (by.zoundhub && by.zoundhub.enabled === true && by['soul-over-ai'] && by['soul-over-ai'].enabled === true && by['hm-verdicts'] && by.cevval && true) || J(Object.keys(by));
});
await t('an existing copy gains Zoundhub at its next start and keeps Soul Over AI as set', async () => {
  const s = fakeStorage({ 'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI, enabled: true, lastRefresh: 5 }, { ...HM.lists.HM_VERDICTS }, { ...HM.lists.CEVVAL }] });
  await refresher(s).ensureBuiltIns();
  const by = Object.fromEntries(s.data['hm.filterLists'].map((l) => [l.id, l]));
  return (by.zoundhub && by.zoundhub.enabled === true && by['soul-over-ai'].enabled === true && by['soul-over-ai'].lastRefresh === 5) || J(s.data['hm.filterLists']);
});
await t('the refresher reads the mirror, ID-only entries included', async () => {
  const s = fakeStorage({ 'hm.filterLists': [{ ...HM.lists.ZOUNDHUB }] });
  const ok = await refresher(s).refreshOne('zoundhub');
  const data = s.data['hm.list.zoundhub'];
  return (ok === true && data.artists.length === 2 && data.artists[1].idOnly === true && s.data['hm.filterLists'][0].count === 2) || J({ ok, data });
});
await t('the popup credits Zoundhub and Soul Over AI', () => {
  const html = readFileSync(process.cwd() + '/extension/popup/popup.html', 'utf8');
  return (/Zoundhub/.test(html) && /zoundhub\.com/.test(html) && /Soul Over AI/.test(html) && /CC BY 4\.0/.test(html)) || 'credit missing';
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
