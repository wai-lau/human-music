// Install downloads every enabled built-in list, only on a real install; a list that keeps
// failing rests longer each time.
import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { run, load } from './load.mjs';
import { fakeStorage } from './fakes.mjs';

const HOUR = 3600000;

function boot(storage, fetchFn, nowFn) {
  const chrome = {
    storage: { local: storage },
    runtime: { onInstalled: { addListener: () => {} }, onMessage: { addListener: () => {} } },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
  };
  const exec = f => runInContext(readFileSync(new URL('../extension/src/' + f, import.meta.url), 'utf8'), ctx);
  const ctx = load([], {
    importScripts: (...files) => files.forEach(exec), chrome, fetch: fetchFn,
    setTimeout: () => 1, clearTimeout: () => {}, Date: { now: nowFn },
  });
  exec('background.js');
  return { ctx, refresher: ctx.HM.refresher };
}

const good = async () => ({ ok: true, status: 200, text: async () => JSON.stringify([{ name: 'Artist A', removed: false }]) });
const bad = async () => ({ ok: false, status: 500, text: async () => '' });
const recording = (urls, inner = good) => (url, init) => { urls.push(url); return inner(url, init); };

run([
  ['a fresh install downloads every enabled built-in list', async () => {
    const urls = [];
    const { ctx, refresher } = boot(fakeStorage(), recording(urls), () => 1000);
    await refresher.install('install');
    const want = [ctx.HM.lists.SOUL_OVER_AI, ctx.HM.lists.HM_VERDICTS, ctx.HM.lists.CEVVAL, ctx.HM.lists.ZOUNDHUB].map(l => l.url).sort();
    return JSON.stringify([...new Set(urls)].sort()) === JSON.stringify(want) || JSON.stringify({ urls, want });
  }],
  ['an update with every record present downloads nothing; with records missing it sets them up', async () => {
    const urls = [];
    const full = fakeStorage();
    const a = boot(full, recording(urls), () => 1000);
    await a.refresher.install('install');
    urls.length = 0;
    await a.refresher.install('update');
    await a.refresher.install('chrome_update');
    const quiet = urls.length;
    const empty = fakeStorage();
    const b = boot(empty, recording(urls), () => 1000);
    await b.refresher.install('update');
    return (quiet === 0 && urls.length > 0 && !!empty.data['hm.filterLists']) || JSON.stringify({ quiet, after: urls.length });
  }],
  ['a disabled list is not downloaded at install', async () => {
    const urls = [];
    const s = fakeStorage();
    const { ctx, refresher } = boot(s, recording(urls), () => 1000);
    s.data['hm.filterLists'] = [{ ...ctx.HM.lists.SOUL_OVER_AI, enabled: false }, { ...ctx.HM.lists.ZOUNDHUB, enabled: true }];
    await refresher.install('install');
    return (!urls.includes(ctx.HM.lists.SOUL_OVER_AI.url) && urls.includes(ctx.HM.lists.ZOUNDHUB.url)) || JSON.stringify(urls);
  }],
  ['a list that keeps failing rests twice as long each time, up to a day; a success resets it', async () => {
    let t = 10 * 24 * HOUR;
    const all = [];
    const urls = { get length() { return all.filter(u => u.includes('soul-over-ai')).length; } };
    const s = fakeStorage();
    const { ctx, refresher } = boot(s, recording(all, bad), () => t);
    s.data['hm.filterLists'] = [{ ...ctx.HM.lists.SOUL_OVER_AI, enabled: true }];
    const rested = [];
    await refresher.refreshDue(); // the first failure, at t
    if (urls.length !== 1) return 'did not try at first';
    for (let i = 0; i < 7; i++) {
      // how long it rests: probe every half hour; the try that ends the rest fails again
      let waited = 0;
      for (;;) {
        t += HOUR / 2; waited += HOUR / 2;
        const n = urls.length;
        await refresher.refreshDue();
        if (urls.length > n) break;
        if (waited > 30 * HOUR) return 'rests too long on round ' + i;
      }
      rested.push(waited / HOUR);
    }
    // 1 h, 2 h, 4 h, 8 h, 16 h, 24 h, 24 h
    if (JSON.stringify(rested) !== JSON.stringify([1, 2, 4, 8, 16, 24, 24])) return JSON.stringify(rested);
    // a success resets the count
    const ok = boot(s, recording([], good), () => t);
    s.data['hm.filterLists'] = s.data['hm.filterLists'].filter(m => m.id === 'soul-over-ai');
    await ok.refresher.refreshOne('soul-over-ai');
    const meta = s.data['hm.filterLists'][0];
    return meta.failures === 0 || JSON.stringify(meta);
  }],
]);
