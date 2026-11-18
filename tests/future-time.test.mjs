// A time in the future (after a clock correction) must not stall list refreshes.
import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { load, run } from './load.mjs';
import { fakeStorage } from './fakes.mjs';

const DAY = 86400000;
const NOW = 1800000000000;
const importScripts = (...files) => { for (const f of files) runInContext(readFileSync(new URL('../extension/src/' + f, import.meta.url), 'utf8'), ctx); };
const ctx = load([], { importScripts, setTimeout, clearTimeout, AbortController });
runInContext(readFileSync(new URL('../extension/src/background.js', import.meta.url), 'utf8'), ctx);
const { HM } = ctx;

run([
  ['isRefreshDue: a lastRefresh 30 days ahead is due', () => HM.lists.isRefreshDue(NOW + 30 * DAY, 'daily', NOW) === true],
  ['isRefreshDue: a lastRefresh just ahead is due', () => HM.lists.isRefreshDue(NOW + 1000, 'weekly', NOW) === true],
  ['isRefreshDue: manual stays never due', () => HM.lists.isRefreshDue(NOW + 30 * DAY, 'manual', NOW) === false],
  ['isRefreshDue: a recent past refresh is not due', () => HM.lists.isRefreshDue(NOW - 1000, 'daily', NOW) === false],
  ['a lastFailedAt in the future does not make a list rest', async () => {
    const meta = { ...HM.lists.SOUL_OVER_AI, enabled: true, lastRefresh: null, lastError: 'HTTP 500', lastFailedAt: NOW + 30 * DAY };
    const storage = fakeStorage({ 'hm.filterLists': [meta] });
    const urls = [];
    const fetch = async url => { urls.push(url); return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ artists: ['A'] }) }; };
    const r = HM.createRefresher({ storage, fetch, now: () => NOW });
    const done = await r.refreshDue();
    return (done.length === 1 && urls.length === 1) || JSON.stringify({ done, urls });
  }],
  ['a lastFailedAt 10 minutes ago still rests', async () => {
    const meta = { ...HM.lists.SOUL_OVER_AI, enabled: true, lastRefresh: null, lastError: 'HTTP 500', lastFailedAt: NOW - 600000 };
    const storage = fakeStorage({ 'hm.filterLists': [meta] });
    const r = HM.createRefresher({ storage, fetch: async () => { throw new Error('no'); }, now: () => NOW });
    return (await r.refreshDue()).length === 0;
  }],
]);
