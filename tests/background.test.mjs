import { readFileSync } from 'fs';
import { runInContext } from 'vm';
import { load } from './load.mjs';
import { fakeStorage } from './fakes.mjs';

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a == null || b == null) return false;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    if (!deepEqual(a[keysA[i]], b[keysB[i]])) return false;
  }
  return true;
}

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    const result = await fn();
    if (result === true || result === undefined) {
      console.log('PASS ' + label);
      passed++;
    } else {
      console.log('FAIL ' + label + ': ' + result);
      failed++;
    }
  } catch (e) {
    console.log('FAIL ' + label + ': ' + (e && e.message || e));
    failed++;
  }
}

function loadBackground(storage, fetchFn, nowFn) {
  const chrome = {
    storage: { local: storage },
    runtime: {
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    },
    alarms: { create: () => {}, onAlarm: { addListener: () => {} } },
    sendMessage: () => {}
  };
  // Load only background.js, as Chrome does; its importScripts call must bring in the core files.
  const run = f => runInContext(readFileSync(new URL('../extension/src/' + f, import.meta.url), 'utf8'), ctx);
  const ctx = load([], {
    importScripts: (...files) => files.forEach(run),
    chrome: chrome,
    fetch: fetchFn || (() => { throw new Error('fetch not stubbed'); }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    Date: { now: nowFn || (() => 0) }
  });
  run('background.js');
  return { ctx, storage, refresher: ctx.HM.refresher };
}

async function runTests() {
  // Case 1: install() on empty storage
  await test('install writes defaults', async () => {
    const storage = fakeStorage();
    const { refresher } = loadBackground(storage, () => { throw new Error('should not fetch'); }, () => 100);
    await refresher.install();
    const lists = await storage.get('hm.filterLists');
    if (lists['hm.filterLists'].length !== 1 || lists['hm.filterLists'][0].id !== 'soul-over-ai') {
      throw new Error('filterLists not installed');
    }
    const settings = await storage.get('hm.settings');
    if (!deepEqual(settings['hm.settings'], { lookahead: 3, autoSkip: true, autoDislike: false, hidePageItems: true, playerButtons: true, paused: false, refresh: 'daily' })) {
      throw new Error('settings not defaults');
    }
    const user = await storage.get('hm.user');
    if (user['hm.user'].artists.length !== 0) {
      throw new Error('user not initialized');
    }
  });

  // Case 2: install() keeps existing hm.user
  await test('install keeps existing user', async () => {
    const existingUser = { artists: ['my artist'], songs: [], keywords: [], neverSkip: [] };
    const storage = fakeStorage({ 'hm.user': existingUser });
    const { refresher } = loadBackground(storage, () => { throw new Error('fetch'); }, () => 0);
    await refresher.install();
    const user = await storage.get('hm.user');
    if (!deepEqual(user['hm.user'], existingUser)) {
      throw new Error('existing user overwritten');
    }
  });

  // Case 3: refreshOne ok (2 artists)
  await test('refreshOne success', async () => {
    const storage = fakeStorage();
    let nowMs = 100;
    const { refresher } = loadBackground(storage, async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          { name: 'Artist A', removed: false },
          { name: 'Artist B', removed: false }
        ])
      };
    }, () => nowMs);
    await refresher.install();
    nowMs = 200;
    const result = await refresher.refreshOne('soul-over-ai');
    if (!result) throw new Error('refreshOne returned false');
    const listData = await storage.get('hm.list.soul-over-ai');
    if (listData['hm.list.soul-over-ai'].artists.length !== 2) {
      throw new Error('list data not saved');
    }
    const lists = await storage.get('hm.filterLists');
    const meta = lists['hm.filterLists'][0];
    if (meta.count !== 2 || meta.lastRefresh !== 200 || meta.lastError !== null) {
      throw new Error('metadata not updated');
    }
  });

  // Case 4: refreshOne after good copy, bad HTML
  await test('refreshOne keeps good copy on bad response', async () => {
    const storage = fakeStorage();
    let nowMs = 100;
    const goodFetch = async () => {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ name: 'Good Artist', removed: false }])
      };
    };
    const badFetch = async () => {
      return { ok: true, status: 200, text: async () => '<html>error</html>' };
    };
    let { refresher } = loadBackground(storage, goodFetch, () => nowMs);
    await refresher.install();
    nowMs = 200;
    await refresher.refreshOne('soul-over-ai');
    const before = await storage.get('hm.list.soul-over-ai');
    if (before['hm.list.soul-over-ai'].artists.length !== 1) {
      throw new Error('initial refresh failed');
    }
    nowMs = 300;
    ({ refresher } = loadBackground(storage, badFetch, () => nowMs));
    const result = await refresher.refreshOne('soul-over-ai');
    if (result) throw new Error('should return false');
    const after = await storage.get('hm.list.soul-over-ai');
    if (after['hm.list.soul-over-ai'].artists.length !== 1) {
      throw new Error('good copy lost');
    }
    const lists = await storage.get('hm.filterLists');
    if (!lists['hm.filterLists'][0].lastError) {
      throw new Error('lastError not set');
    }
  });

  // Case 5: refreshOne first ever, fetch rejects
  await test('refreshOne first fetch failure', async () => {
    const storage = fakeStorage();
    const { refresher } = loadBackground(storage, async () => {
      throw new Error('network');
    }, () => 100);
    await refresher.install();
    const result = await refresher.refreshOne('soul-over-ai');
    if (result) throw new Error('should return false');
    const listData = await storage.get('hm.list.soul-over-ai');
    if (!deepEqual(listData['hm.list.soul-over-ai'], { artists: [] })) {
      throw new Error('should have empty list');
    }
  });

  // Case 6: refreshDue
  await test('refreshDue only refreshes due lists', async () => {
    const lists = [
      { id: 'soul-over-ai', name: 'Soul Over AI', url: 'http://a.json', enabled: true, mode: 'act', builtIn: true, lastRefresh: null, count: 0, lastError: null },
      { id: 'old-list', name: 'Old', url: 'http://b.json', enabled: true, mode: 'act', builtIn: false, lastRefresh: 100, count: 0, lastError: null },
      { id: 'disabled-list', name: 'Disabled', url: 'http://c.json', enabled: false, mode: 'act', builtIn: false, lastRefresh: null, count: 0, lastError: null }
    ];
    const storage = fakeStorage({
      'hm.filterLists': lists,
      'hm.settings': { lookahead: 3, autoSkip: true, autoDislike: false, hidePageItems: true, playerButtons: true, paused: false, refresh: 'daily' }
    });
    let nowMs = 100000000;
    let refreshedUrls = [];
    const { refresher } = loadBackground(storage, async (url) => {
      refreshedUrls.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify([{ name: 'X', removed: false }]) };
    }, () => nowMs);
    await refresher.refreshDue();
    if (refreshedUrls.length !== 2) {
      throw new Error('wrong number of fetches: ' + refreshedUrls.length);
    }
    if (refreshedUrls[0] !== 'http://a.json' || refreshedUrls[1] !== 'http://b.json') {
      throw new Error('wrong lists refreshed');
    }
  });
}

runTests().then(() => {
  console.log(`${passed}/${passed + failed} pass`);
  process.exit(failed === 0 ? 0 : 1);
});
