// Contract check for the investigator plan, Task 2 (the verdict list). Run from the repo root:
//   node tests/wip-contract-verdicts.check.mjs
const { readFileSync } = await import('fs');
const { runInContext } = await import('vm');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = v => JSON.stringify(v);
const eq = (label, got, want) => { if (J(got) !== J(want)) fails.push(`${label}: got ${J(got)} want ${J(want)}`); };
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };

let ctx;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(process.cwd() + '/extension/src/' + f, 'utf8'), ctx); };
ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController });
runInContext(readFileSync(process.cwd() + '/extension/src/background.js', 'utf8'), ctx);
const { HM } = ctx;
const fixtureText = readFileSync(process.cwd() + '/tests/fixtures/verdicts.json', 'utf8');
const pick = (v, name) => v.artists.find(a => a.name === name);

await t('HM_VERDICTS is the built-in verdict list', () => {
  const v = HM.lists.HM_VERDICTS || {};
  return (v.id === 'hm-verdicts' && v.name === 'Human Music verdicts' && v.url === 'https://raw.githubusercontent.com/wai-lau/human-music/main/verdicts/verdicts.json'
    && v.builtIn === true && v.mode === 'act' && v.enabled === true) || J(v);
});
await t('verdict fields parsed', () => {
  const v = HM.lists.parseFilterList(JSON.parse(fixtureText));
  eq('ai kept with confidence', pick(v, 'Forrest Rose'), { name: 'Forrest Rose', verdict: 'ai', confidence: 97 });
  eq('human kept', pick(v, 'Real Person'), { name: 'Real Person', verdict: 'human', confidence: 90 });
  eq('text confidence dropped', pick(v, 'Text Confidence').confidence, undefined);
  eq('clamped to 100', pick(v, 'Over Hundred').confidence, 100);
  eq('unknown verdict word dropped', pick(v, 'Odd Word').verdict, undefined);
  eq('calibrated flag', v.calibrated, false);
  eq('calibrated true', HM.lists.parseFilterList({ calibrated: true, artists: [] }).calibrated, true);
  eq('no calibrated key when the list states none', 'calibrated' in HM.lists.parseFilterList({ artists: [{ name: 'A' }] }), false);
  eq('negative clamped to 0', HM.lists.parseFilterList({ artists: [{ name: 'N', verdict: 'ai', confidence: -5 }] }).artists[0].confidence, 0);
  eq('plain lists unchanged', HM.lists.parseFilterList([{ name: 'A' }]).artists, [{ name: 'A' }]);
  return true;
});
const refresher = (storage, fetch) => HM.createRefresher({ storage, fetch, now: () => 1_000_000, assetUrl: p => 'bundle:' + p });
const ids = storage => (storage.data['hm.filterLists'] || []).map(l => l.id);
await t('install lists both built-ins', async () => {
  const storage = fakeStorage({});
  await refresher(storage, async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' })).install();
  return J(ids(storage)) === J(['soul-over-ai', 'hm-verdicts']) || J(ids(storage));
});
await t('a start with only Soul Over AI adds the verdict list', async () => {
  const storage = fakeStorage({ 'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI }] });
  const fetch = async url => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => (url === 'bundle:lists/index.json' ? '{"files":[]}' : '') });
  await refresher(storage, fetch).importBundled();
  return J(ids(storage)) === J(['soul-over-ai', 'hm-verdicts']) || J(ids(storage));
});
const withVerdicts = extra => fakeStorage({ 'hm.filterLists': [{ ...HM.lists.SOUL_OVER_AI }, { ...HM.lists.HM_VERDICTS, lastRefresh: 5, count: 3, ...extra }], 'hm.list.hm-verdicts': { artists: [{ name: 'Kept', verdict: 'ai', confidence: 99 }] } });
await t('a refresh stores the artists and the calibrated flag', async () => {
  const storage = withVerdicts();
  const ok = await refresher(storage, async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => fixtureText.replace('"calibrated": false', '"calibrated": true') })).refreshOne('hm-verdicts');
  const meta = storage.data['hm.filterLists'][1];
  return (ok === true && meta.calibrated === true && storage.data['hm.list.hm-verdicts'].artists.length === 7) || J({ ok, meta });
});
await t('a 404 keeps the last good copy', async () => {
  const storage = withVerdicts();
  const ok = await refresher(storage, async () => ({ ok: false, status: 404, headers: { get: () => null }, text: async () => '' })).refreshOne('hm-verdicts');
  const meta = storage.data['hm.filterLists'][1];
  return (ok === false && storage.data['hm.list.hm-verdicts'].artists[0].name === 'Kept' && meta.count === 3 && typeof meta.lastError === 'string') || J({ ok, meta });
});
await t('not JSON keeps the last good copy', async () => {
  const storage = withVerdicts();
  const ok = await refresher(storage, async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => '<html>oops</html>' })).refreshOne('hm-verdicts');
  return (ok === false && storage.data['hm.list.hm-verdicts'].artists[0].name === 'Kept') || J({ ok });
});

console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
