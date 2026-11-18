// Contract check (Wai, 2026-11-18: "logs should never clear on their own", then "keep an amount of
// logs that is huge, but reasonable on today's machines" and "keep all entries for my own version").
// The log is stored in chunks ("segments") of 1,000 entries, so writing one entry rewrites only the
// newest segment (and a small index), never the whole log. Store copies keep up to 100,000 entries
// (about 25 MB); the owner's development copy keeps every entry. The manifest asks for
// unlimitedStorage (Chrome's default 10 MB would fill in months).
// Interface (extension/src/core/log.js):
//   HM.log.SEGMENT = 1000; HM.log.STORE_CAP = 100000
//   HM.log.capFor(isDev) -> 0 for the development copy (0 means no cap), STORE_CAP otherwise
//   HM.log.createLogStore(storage, { cap }) -> {
//     append(entry, { oncePerDay }) -> Promise<boolean>   (false when oncePerDay found it already today)
//     readAll() -> Promise<entry[]>                       (newest first, every kept entry)
//     clear() -> Promise                                  (removes every segment and the index)
//     migrate() -> Promise                                (an old 'hm.log' array becomes segments; 'hm.log' is removed)
//   }
//   Storage keys: 'hm.log.index' and 'hm.log.seg.<n>'. Over the cap, whole oldest segments go, so
//   the kept count stays between cap and cap + SEGMENT.
// Run from the repo root: node tests/wip-contract-log-store.check.mjs
const { readFileSync } = await import('fs');
const { load } = await import(process.cwd() + '/tests/load.mjs');
const { fakeStorage } = await import(process.cwd() + '/tests/fakes.mjs');
const fails = [];
const J = (v) => JSON.stringify(v);
const t = async (label, fn) => { try { const r = await fn(); if (r !== true) fails.push(`${label}: ${r}`); } catch (e) { fails.push(`${label}: threw ${e.message}`); } };
const HM = load(['src/core/text.js', 'src/core/store.js', 'src/core/log.js']).HM;
const e = (i, o = {}) => ({ at: 1_700_000_000_000 + i * 60000, event: 'skipped', title: `Song ${i}`, artistLine: 'Act', listId: 'zoundhub', listName: 'Zoundhub', rule: 'artist', entry: 'Act', ...o });
const fill = async (store, n) => { for (let i = 0; i < n; i++) await store.append(e(i)); };

await t('constants and the cap for each copy', () =>
  (HM.log.SEGMENT === 1000 && HM.log.STORE_CAP === 100000 && HM.log.capFor(true) === 0 && HM.log.capFor(false) === 100000) || J([HM.log.SEGMENT, HM.log.STORE_CAP, HM.log.capFor(true), HM.log.capFor(false)]));
await t('2,500 entries: all read back newest first, in segments of at most 1,000', async () => {
  const storage = fakeStorage({});
  const store = HM.log.createLogStore(storage, { cap: 100000 });
  await fill(store, 2500);
  const all = await store.readAll();
  const segs = Object.keys(storage.data).filter((k) => k.startsWith('hm.log.seg.'));
  return (all.length === 2500 && all[0].title === 'Song 2499' && all[2499].title === 'Song 0' && segs.length === 3 && segs.every((k) => storage.data[k].length <= 1000)) || J({ n: all.length, segs: segs.map((k) => storage.data[k].length) });
});
await t('one append writes only the newest segment and the index', async () => {
  const storage = fakeStorage({});
  const store = HM.log.createLogStore(storage, { cap: 100000 });
  await fill(store, 2100);
  const written = [];
  const set = storage.set.bind(storage);
  storage.set = async (obj) => { written.push(...Object.keys(obj)); return set(obj); };
  await store.append(e(9999));
  const keys = [...new Set(written)];
  return (keys.every((k) => k === 'hm.log.index' || k.startsWith('hm.log.seg.')) && keys.filter((k) => k.startsWith('hm.log.seg.')).length === 1 && !keys.includes('hm.log')) || J(keys);
});
await t('over the cap, whole oldest segments go: the newest are kept, between cap and cap + 1,000', async () => {
  const storage = fakeStorage({});
  const store = HM.log.createLogStore(storage, { cap: 3000 });
  await fill(store, 5000);
  const all = await store.readAll();
  return (all.length >= 3000 && all.length < 4000 && all[0].title === 'Song 4999') || J({ n: all.length, first: all[0] && all[0].title });
});
await t('the development copy (cap 0) keeps everything', async () => {
  const storage = fakeStorage({});
  const store = HM.log.createLogStore(storage, { cap: 0 });
  await fill(store, 5000);
  return (await store.readAll()).length === 5000 || 'dropped entries';
});
await t('migrate: an old hm.log array becomes segments in the same order, and hm.log goes', async () => {
  const old = Array.from({ length: 1500 }, (_, i) => e(1500 - i)); // newest first, as the old log was
  const storage = fakeStorage({ 'hm.log': old });
  const store = HM.log.createLogStore(storage, { cap: 100000 });
  await store.migrate();
  const all = await store.readAll();
  return (all.length === 1500 && J(all.map((x) => x.title)) === J(old.map((x) => x.title)) && !('hm.log' in storage.data)) || J({ n: all.length, left: 'hm.log' in storage.data });
});
await t('readAll also returns an old hm.log array not migrated yet (after the segments, which are newer)', async () => {
  const storage = fakeStorage({ 'hm.log': [e(1), e(0)] });
  const store = HM.log.createLogStore(storage, { cap: 100000 });
  await store.append(e(2));
  const all = await store.readAll();
  return J(all.map((x) => x.title)) === J(['Song 2', 'Song 1', 'Song 0']) || J(all.map((x) => x.title));
});
await t('clear removes every segment and the index', async () => {
  const storage = fakeStorage({});
  const store = HM.log.createLogStore(storage, { cap: 100000 });
  await fill(store, 1200);
  await store.clear();
  return ((await store.readAll()).length === 0 && !Object.keys(storage.data).some((k) => k.startsWith('hm.log'))) || J(Object.keys(storage.data));
});
await t('once a day: the same entry within a day is kept once, also across a segment boundary', async () => {
  const storage = fakeStorage({});
  const store = HM.log.createLogStore(storage, { cap: 100000 });
  await fill(store, 999);
  const w = e(5000, { event: 'watched', title: 'Watched One' });
  const a = await store.append(w, { oncePerDay: true });
  await store.append(e(5001));
  const b = await store.append({ ...w, at: w.at + 3600000 }, { oncePerDay: true });
  const c = await store.append({ ...w, at: w.at + 25 * 3600000 }, { oncePerDay: true });
  const n = (await store.readAll()).filter((x) => x.title === 'Watched One').length;
  return (a === true && b === false && c === true && n === 2) || J({ a, b, c, n });
});
await t('the manifest asks for unlimitedStorage', () => {
  const m = JSON.parse(readFileSync(process.cwd() + '/extension/manifest.json', 'utf8'));
  return (m.permissions || []).includes('unlimitedStorage') || J(m.permissions);
});

console.log(fails.length ? fails.map((f) => 'PROBE FAIL ' + f).join('\n') : 'probe ok');
process.exit(fails.length ? 1 : 0);
