// Contract: the one-time lookahead raise (Wai, 2026-11-23: "just override? then start using saved
// values, if changed again"). Every saved lookahead becomes 10 once, except 0 (turned off on
// purpose); later changes are kept. Run from the repo root: node tests/contract-lookahead-raise.check.mjs
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
const read = async (s) => ((await s.get('hm.settings')) || {})['hm.settings'];

await t('a saved 3 or 8 becomes 10; other settings kept', async () => {
  const got = [];
  for (const n of [3, 8]) { const s = fakeStorage({ 'hm.settings': { lookahead: n, autoSkip: false } }); await HM.raiseLookahead(s); got.push(await read(s)); }
  return J(got) === J([{ lookahead: 10, autoSkip: false }, { lookahead: 10, autoSkip: false }]) || J(got);
});
await t('a saved 0 stays 0', async () => {
  const s = fakeStorage({ 'hm.settings': { lookahead: 0 } }); await HM.raiseLookahead(s);
  return (await read(s)).lookahead === 0 || J(await read(s));
});
await t('runs once: a value changed afterwards is kept on the next start', async () => {
  const s = fakeStorage({ 'hm.settings': { lookahead: 3 } });
  await HM.raiseLookahead(s);
  await s.set({ 'hm.settings': { lookahead: 4 } });
  const again = await HM.raiseLookahead(s);
  return (again === false && (await read(s)).lookahead === 4) || J({ again, s: await read(s) });
});
await t('no saved settings: nothing written but the marker', async () => {
  const s = fakeStorage({}); await HM.raiseLookahead(s);
  return (await read(s)) === undefined || J(await read(s));
});
console.log(fails.length ? fails.map(f => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
