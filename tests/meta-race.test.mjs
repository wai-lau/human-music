// hm.filterLists is changed by several worker jobs at once (start-up refresh, install import,
// the popup's Refresh, a failure note). None may lose another's change (review 2026-11-17).
import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { load, run } from './load.mjs';
import { fakeStorage } from './fakes.mjs';

const ext = p => readFileSync(new URL('../extension/' + p, import.meta.url), 'utf8');
const NOW = 5000;

// Storage whose every call takes 1-3 ms (from a seeded sequence), so jobs interleave.
function slow(inner, seed) {
  let n = seed;
  const wait = () => { n = (n * 1103515245 + 12345) % 2147483648; return new Promise(r => setTimeout(r, 1 + (n >> 8) % 3)); };
  return {
    ...inner,
    get: async k => { await wait(); const v = await inner.get(k); await wait(); return v; },
    set: async o => { await wait(); const v = await inner.set(o); await wait(); return v; },
  };
}

function rig(seed) {
  let ctx;
  const runFile = f => runInContext(ext('src/' + f), ctx);
  ctx = load([], { importScripts: (...fs) => fs.forEach(runFile), setTimeout, clearTimeout, AbortController });
  runFile('background.js');
  const { HM } = ctx;
  const meta = (b, o = {}) => ({ ...b, lastRefresh: null, count: 0, lastError: null, ...o });
  const inner = fakeStorage({
    'hm.filterLists': [
      meta(HM.lists.SOUL_OVER_AI),
      meta(HM.lists.HM_VERDICTS, { url: 'https://old.example/verdicts.json', name: 'Old verdicts name' }),
      meta(HM.lists.CEVVAL, { name: 'Old cevval name', url: 'https://old.example/cevval.txt' }),
      meta({ id: 'mine', name: 'Mine', url: 'https://example.org/mine.json', enabled: true, mode: 'act', builtIn: false }),
    ],
  });
  const storage = slow(inner, seed);
  const fetched = [];
  const files = {
    'lists/index.json': JSON.stringify({ files: [{ file: 'soa.json', kind: 'filter-list', id: 'soul-over-ai' }] }),
    'lists/soa.json': JSON.stringify({ name: 'snap', artists: [{ name: 'Snap One' }] }),
  };
  const fetch = async url => {
    fetched.push(url);
    if (url.startsWith('bundle:')) return { ok: true, status: 200, text: async () => files[url.slice(7)] };
    await new Promise(r => setTimeout(r, 2));
    const body = /cevval|\.txt$/.test(url) ? '! list\nUCaaaaaaaaaaaaaaaaaaaaaa\nUCbbbbbbbbbbbbbbbbbbbbbb' : JSON.stringify({ artists: [{ name: 'A' }, { name: 'B' }] });
    return { ok: true, status: 200, text: async () => body };
  };
  const r = HM.createRefresher({ storage, fetch, now: () => NOW, assetUrl: p => 'bundle:' + p, isDev: async () => false });
  return { r, inner, fetched, HM };
}

const check = async seed => {
  const { r, inner, fetched, HM } = rig(seed);
  await Promise.all([r.refreshDue(), r.refreshOne('mine'), r.importBundled(), r.refreshOne('hm-verdicts')]);
  const metas = inner.data['hm.filterLists'];
  const by = id => metas.find(m => m.id === id) || {};
  const miss = [];
  for (const m of metas) if (m.lastRefresh !== NOW || m.lastError !== null || !(m.count > 0)) miss.push(`${m.id}: ${JSON.stringify({ lastRefresh: m.lastRefresh, count: m.count, lastError: m.lastError })}`);
  for (const b of [HM.lists.SOUL_OVER_AI, HM.lists.HM_VERDICTS, HM.lists.CEVVAL]) {
    const m = by(b.id);
    if (m.url !== b.url || m.name !== b.name || m.format !== b.format) miss.push(`${b.id} built-in meta not fixed: ${JSON.stringify(m)}`);
  }
  const mineFetches = fetched.filter(u => u === 'https://example.org/mine.json').length;
  if (mineFetches !== 1) miss.push(`mine fetched ${mineFetches} times`);
  return miss.length === 0 || `seed ${seed}: ${miss.join('; ')}`;
};

run([
  ...[1, 2, 3, 4, 5].map(seed => [`refreshDue, refreshOne and importBundled together keep every list's record (slow storage, run ${seed})`, () => check(seed)]),
  ['ensureBuiltIns repairs the built-in addresses, names and formats at any start', async () => {
    const { r, inner, HM } = rig(7);
    inner.data['hm.filterLists'][2].format = 'json';
    await r.ensureBuiltIns();
    const ms = inner.data['hm.filterLists'];
    return (ms[1].url === HM.lists.HM_VERDICTS.url && ms[2].name === HM.lists.CEVVAL.name && ms[2].format === 'text') || JSON.stringify(ms);
  }],
]);
