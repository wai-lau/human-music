(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};
  // The service worker loads only this file; the helpers come in here (paths relative to src/).
  if (typeof importScripts === 'function') importScripts('core/text.js', 'core/store.js', 'core/lists.js', 'core/settings.js', 'core/secret.js', 'core/log.js');

  function createRefresher(opts) {
    const storage = opts.storage;
    const fetchFn = opts.fetch;
    const nowFn = opts.now;
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;
    const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : 5000000;
    // Only Wai's development copy imports the shipped my-lists.json backup (security audit
    // 2026-11-17): in a store copy it would carry her settings, list choices and lists to
    // every friend. Unknown means no.
    const isDev = typeof opts.isDev === 'function' ? opts.isDev : async function () { return false; };

    // Well-known artists made by people: a list update that names one is held in Watch only
    // (security hardening, Wai 2026-11-18). Loaded once per worker; a failed load means an
    // empty guard list, never a blocked refresh.
    let wellKnownNames = [];
    async function loadWellKnown() {
      if (typeof opts.assetUrl !== 'function') return;
      try {
        const resp = await fetchFn(opts.assetUrl('lists/well-known.json'));
        if (!resp.ok) return;
        const data = JSON.parse(await resp.text());
        if (Array.isArray(data.names)) wellKnownNames = data.names;
      } catch (e) {
        // empty guard list is fine
      }
    }
    // Every refresh waits for it: a worker start refreshes at once, before a fire-and-forget
    // load could finish, and an unguarded first refresh is exactly the one a hacked list needs.
    const wellKnownReady = loadWellKnown();

    // Every change to hm.filterLists goes through here, one at a time: fn gets the stored
    // list records (undefined if none are stored yet) and returns the new records, or
    // undefined for no change. Read-modify-write from several jobs at once lost each other's
    // lastRefresh, count and repairs (review 2026-11-17).
    let metaQueue = Promise.resolve();
    function updateMetas(fn) {
      const run = metaQueue.then(async function () {
        const key = HM.store.KEYS.filterLists;
        const cur = (await storage.get(key))[key];
        const next = fn(cur);
        if (next === undefined) return cur;
        await storage.set({ [key]: next });
        return next;
      });
      metaQueue = run.then(function () {}, function () {});
      return run;
    }

    async function install() {
      const stored = await storage.get([HM.store.KEYS.user, HM.store.KEYS.settings]);

      await updateMetas(function (metas) {
        if (metas) return undefined;
        // Zoundhub replaces Soul Over AI (frozen since March 2026) for new installs; Soul Over AI
        // stays on the list, off (Wai, 2026-11-18).
        return [{ ...globalThis.HM.lists.SOUL_OVER_AI, enabled: false }, { ...globalThis.HM.lists.HM_VERDICTS }, { ...globalThis.HM.lists.CEVVAL }, { ...globalThis.HM.lists.ZOUNDHUB }];
      });

      if (!stored[HM.store.KEYS.user]) {
        await storage.set({
          [HM.store.KEYS.user]: HM.store.emptyUser()
        });
      }

      if (!stored[HM.store.KEYS.settings]) {
        await storage.set({
          [HM.store.KEYS.settings]: globalThis.HM.settings.DEFAULTS
        });
      }

      await importBundled();
      await refreshOne('soul-over-ai');
    }

    // Import the list files committed in extension/lists/ (named in lists/index.json),
    // each only when its content changed since the last import (hm.bundled keeps
    // fingerprints), so an entry deleted in the popup stays deleted until the file
    // changes. kind 'backup': a Human Music (or old extension) backup, merged into
    // your lists. kind 'filter-list' with an id: fills that list only while it has
    // no downloaded copy. A broken file is skipped; resolves to the files imported.
    // Built-in upkeep at every start, whatever happened to the bundled import.
    async function ensureBuiltIns() {
      const HM = globalThis.HM;
      const BUILT_INS = [HM.lists.SOUL_OVER_AI, HM.lists.HM_VERDICTS, HM.lists.CEVVAL, HM.lists.ZOUNDHUB];
      // No list meta yet means install has not run: leave the storage to it. Built-in lists
      // take their name, address and format from the code, so a list that moves (the verdict
      // list did, 2026-11-17) follows on the next start, and a missing one comes back. The
      // person's own choices (on or off, Watch only) and the refresh record stay.
      await updateMetas(function (metas) {
        if (!Array.isArray(metas)) return undefined;
        let changed = false;
        let next = metas.map(function (m) {
          const code = m && m.builtIn === true ? BUILT_INS.find(function (b) { return b.id === m.id; }) : null;
          if (!code || (m.url === code.url && m.name === code.name && m.format === code.format)) return m;
          changed = true;
          const fixed = { ...m, url: code.url, name: code.name };
          if (code.format === undefined) delete fixed.format; else fixed.format = code.format;
          return fixed;
        });
        for (const code of [HM.lists.HM_VERDICTS, HM.lists.CEVVAL, HM.lists.ZOUNDHUB]) {
          if (!next.some(function (m) { return m && m.id === code.id; })) { next = next.concat([{ ...code }]); changed = true; }
        }
        return changed ? next : undefined;
      });
    }

    async function importBundled() {
      const done = [];
      if (typeof opts.assetUrl !== 'function') { await ensureBuiltIns(); return done; }
      const HM = globalThis.HM;
      let index;
      try {
        index = JSON.parse(await (await fetchFn(opts.assetUrl('lists/index.json'))).text());
      } catch (e) {
        await ensureBuiltIns(); // the bundled index is unreadable: the built-ins still get looked after
        return done;
      }
      const files = index && Array.isArray(index.files) ? index.files : [];
      const seen = (await storage.get(HM.store.KEYS.bundled))[HM.store.KEYS.bundled] || {};
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        try {
          if (!f || typeof f.file !== 'string' || !/^[\w.-]+\.json$/.test(f.file)) continue;
          const text = await (await fetchFn(opts.assetUrl('lists/' + f.file))).text();
          const print = HM.lists.fingerprint(text);
          if (seen[f.file] === print) continue;
          const data = JSON.parse(text);
          if (f.kind === 'backup') {
            if (!(await Promise.resolve().then(isDev).catch(function () { return false; }))) continue;
            const imported = HM.lists.importBackup(data);
            const cur = await storage.get([HM.store.KEYS.user, HM.store.KEYS.settings, HM.store.KEYS.filterLists]);
            const next = HM.lists.applyBackup({
              user: cur[HM.store.KEYS.user], settings: cur[HM.store.KEYS.settings],
              filterLists: cur[HM.store.KEYS.filterLists] || [{ ...HM.lists.SOUL_OVER_AI }]
            }, imported);
            const write = { [HM.store.KEYS.user]: next.user };
            if (imported.settings) write[HM.store.KEYS.settings] = HM.settings.sanitize(next.settings);
            if (imported.filterLists) write[HM.store.KEYS.filterLists] = next.filterLists;
            await storage.set(write);
          } else if (f.kind === 'filter-list' && typeof f.id === 'string') {
            const parsed = HM.lists.parseFilterList(data);
            if (!parsed) continue;
            const key = HM.store.listKey(f.id);
            const have = (await storage.get(key))[key];
            if (!have || !Array.isArray(have.artists) || have.artists.length === 0) {
              const setObj = {};
              setObj[key] = parsed;
              await storage.set(setObj);
              await updateMetas(function (metas) {
                if (!Array.isArray(metas)) return undefined;
                return metas.map(function (m) {
                  return m.id === f.id ? Object.assign({}, m, { count: parsed.artists.length }) : m;
                });
              });
            }
          } else {
            continue;
          }
          seen[f.file] = print;
          await storage.set({ [HM.store.KEYS.bundled]: seen });
          done.push(f.file);
        } catch (e) {
          // skip this file; the others still import
        }
      }
      await ensureBuiltIns();
      return done;
    }

    // One refresh per list at a time: a second ask (start-up and the popup's Refresh, say)
    // shares the first one's answer instead of fetching again.
    const refreshing = new Map();
    function refreshOne(id) {
      if (refreshing.has(id)) return refreshing.get(id);
      const p = refreshOneNow(id).finally(function () { refreshing.delete(id); });
      refreshing.set(id, p);
      return p;
    }

    async function refreshOneNow(id) {
      try {
        const lists = await storage.get(HM.store.KEYS.filterLists);
if (!lists[HM.store.KEYS.filterLists] || lists[HM.store.KEYS.filterLists].length === 0) {
          return false;
        }
        let list = null;
for (let i = 0; i < lists[HM.store.KEYS.filterLists].length; i++) {
if (lists[HM.store.KEYS.filterLists][i].id === id) {
list = lists[HM.store.KEYS.filterLists][i];
            break;
          }
        }
        if (!list) {
          return false;
        }

        if (typeof list.url !== 'string' || !list.url.startsWith('https://')) {
          await recordFailure(id, 'Not an https:// URL');
          return false;
        }

        let controller = null;
        let signal = null;
        let timeoutHandle = null;
        if (typeof AbortController !== 'undefined') {
          controller = new AbortController();
          signal = controller.signal;
        }
        if (typeof setTimeout !== 'undefined' && signal) {
          timeoutHandle = setTimeout(function() { controller.abort(); }, timeoutMs);
        }

        const opts = { redirect: 'error', credentials: 'omit' };
        if (signal) opts.signal = signal;

        const fetchPromise = fetchFn(list.url, opts);

        let resp;
        try {
          if (typeof setTimeout !== 'undefined') {
            const timeoutPromise = new Promise(function(_, reject) {
              setTimeout(function() { reject(new Error('Timeout')); }, timeoutMs);
            });
            resp = await Promise.race([fetchPromise, timeoutPromise]);
          } else {
            resp = await fetchPromise;
          }
        } catch (e) {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle);
          throw e;
        }

        if (!resp.ok) {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle);
          await recordFailure(id, 'HTTP ' + resp.status);
          return false;
        }

        if (resp.headers && typeof resp.headers.get === 'function') {
          const cl = resp.headers.get('content-length');
          if (cl !== null && Number(cl) > maxBytes) {
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            await recordFailure(id, 'Content-Length over ' + maxBytes + ' bytes');
            return false;
          }
        }

        const textPromise = readCapped(resp, controller);
        let text;
        try {
          if (typeof setTimeout !== 'undefined') {
            const textTimeout = new Promise(function(_, reject) {
              setTimeout(function() { reject(new Error('Timeout')); }, timeoutMs);
            });
            text = await Promise.race([textPromise, textTimeout]);
          } else {
            text = await textPromise;
          }
        } catch (e) {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle);
          throw e;
        }

        if (timeoutHandle !== null) clearTimeout(timeoutHandle);

        if (text === null || text.length > maxBytes) {
          await recordFailure(id, 'Body over ' + maxBytes + ' bytes');
          return false;
        }

        let listData;
        if (list.format === 'text') {
          listData = globalThis.HM.lists.parseFilterText(text);
        } else {
          const parsed = JSON.parse(text);
          listData = globalThis.HM.lists.parseFilterList(parsed);
          if (listData === null) {
            await recordFailure(id, 'Not a filter list');
            return false;
          }
        }

        // Check the update against the guard: does it name a well-known person, or suddenly
        // balloon? If so, store the data but put the list in Watch only and record why.
        await wellKnownReady;
        const stored = (await storage.get(HM.store.listKey(id)))[HM.store.listKey(id)];
        const oldArtists = stored && Array.isArray(stored.artists) ? stored.artists : [];
        const held = globalThis.HM.lists.checkUpdate(oldArtists, listData.artists, wellKnownNames);

        const setObj = {};
        setObj[HM.store.listKey(id)] = listData;
        await storage.set(setObj);

        const refreshedAt = nowFn();
        await updateMetas(function (metas) {
          if (!Array.isArray(metas)) return undefined;
          return metas.map(function (m) {
            if (m.id !== id) return m;
            const next = { ...m, count: listData.artists.length, lastRefresh: refreshedAt, lastError: null, calibrated: listData.calibrated };
            if (held) {
              next.mode = 'watch';
              next.held = { at: refreshedAt, reason: held.reason };
            }
            return next;
          });
        });
        return true;
      } catch (e) {
        try {
          await recordFailure(id, e.message);
        } catch (e2) {
          return false;
        }
        return false;
      }
    }

    // Reads a response body as text, stopping (and cancelling the download) once it passes
    // maxBytes: null means too big. A response without a stream (tests) is read whole.
    async function readCapped(resp, controller) {
      const body = resp && resp.body;
      if (!body || typeof body.getReader !== 'function' || typeof TextDecoder === 'undefined') return resp.text();
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let total = 0;
      let text = '';
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        const value = part.value || new Uint8Array(0);
        total += value.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (e) { /* already closed */ }
          if (controller) { try { controller.abort(); } catch (e) { /* done */ } }
          return null;
        }
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    }

    async function recordFailure(id, message) {
      const failedAt = nowFn();
      const after = await updateMetas(function (metas) {
        if (!Array.isArray(metas) || metas.length === 0) return undefined;
        return metas.map(function (m) { return m.id === id ? { ...m, lastError: message, lastFailedAt: failedAt } : m; });
      });
      if (!Array.isArray(after) || after.length === 0) return;

      const listKey = HM.store.listKey(id);
      const stored = await storage.get(listKey);
      if (!stored[listKey]) {
        const emptyList = {};
        emptyList[listKey] = { artists: [] };
        await storage.set(emptyList);
      }
    }

    async function refreshDue() {
      const lists = await storage.get(HM.store.KEYS.filterLists);
      if (!lists[HM.store.KEYS.filterLists] || lists[HM.store.KEYS.filterLists].length === 0) {
        return [];
      }
      const settings = globalThis.HM.settings.sanitize((await storage.get(HM.store.KEYS.settings))[HM.store.KEYS.settings]);
      const now = nowFn();
      const refreshed = [];

      const ids = lists[HM.store.KEYS.filterLists].map(function (l) { return l.id; });
      for (let i = 0; i < ids.length; i++) {
        // Judged on the list's record as it is now: a refresh another job finished since
        // the first read (the popup's Refresh, say) is not done again.
        const metas = (await storage.get(HM.store.KEYS.filterLists))[HM.store.KEYS.filterLists] || [];
        const list = metas.find(function (l) { return l && l.id === ids[i]; });
        if (!list || !list.enabled) {
          continue;
        }
        // A list that failed in the last hour rests, so a broken list isn't fetched at every
        // worker start (the popup's Refresh button still tries at once).
        if (list.lastError && typeof list.lastFailedAt === 'number' && list.lastFailedAt <= now && now - list.lastFailedAt < 3600000) continue;
        if (globalThis.HM.lists.isRefreshDue(list.lastRefresh, settings.refresh, now)) {
          refreshed.push(list.id);
          await refreshOne(list.id);
        }
      }

      return refreshed;
    }

    return { install: install, refreshOne: refreshOne, refreshDue: refreshDue, importBundled: importBundled, ensureBuiltIns: ensureBuiltIns };
  }

  globalThis.HM.createRefresher = createRefresher;

  function createInvestigator(opts) {
    const storage = opts.storage;
    const fetchFn = opts.fetch;
    const nowFn = opts.now;
    const secrets = opts.secrets || globalThis.HM.secrets;
    const DEFAULT_BASE = 'https://wai-lau.net/human-music';
    const WEEK = 7 * 24 * 3600 * 1000;
    // Artist keys whose POST is pending, so a second send of the same artist skips at once.
    const inFlight = new Set();
    // Reads and writes of the stored record run one at a time. The record is read fresh each
    // time and never held between sends: the popup owns the token, and a copy kept here
    // brought a removed or rotated key back (review 2026-11-17).
    let queue = Promise.resolve();
    function serial(fn) {
      const run = queue.then(fn);
      queue = run.then(function () {}, function () {});
      return run;
    }

    async function readState() {
      const key = HM.store.KEYS.investigator;
      const existing = ((await storage.get(key)) || {})[key];
      const state = existing && typeof existing === 'object' ? existing : {};
      if (typeof state.base !== 'string') state.base = DEFAULT_BASE;
      if (!state.sent || typeof state.sent !== 'object') state.sent = {};
      return state;
    }

    function dropOld(sent) {
      for (const k in sent) {
        if (sent[k] && sent[k].length === 10) {
          try {
            if (nowFn() - new Date(sent[k] + 'T00:00:00Z').getTime() > WEEK) delete sent[k];
          } catch (e) {
            delete sent[k];
          }
        }
      }
    }

    // Writes back only what the worker owns (sent, lastError, lastSentAt) on top of what is
    // stored right now; the token and address stay as the popup left them.
    function record(change) {
      return serial(async function () {
        const state = await readState();
        dropOld(state.sent);
        change(state);
        const obj = {};
        obj[HM.store.KEYS.investigator] = state;
        await storage.set(obj);
      });
    }

    function keyOf(item) {
      // Keyed by the credited artists (not the artist line, which names the
      // album on YouTube Music), so one artist is sent once a day.
      const credits = Array.isArray(item.credits) ? item.credits.filter(function (c) { return typeof c === 'string'; }) : [];
      let key = credits.map(function (c) { return HM.text.normalize(c).trim(); }).filter(Boolean).sort().join(',');
      if (!key && typeof item.artistLine === 'string') key = HM.text.normalize(item.artistLine).trim();
      if (item.channelIds && item.channelIds.length > 0) {
        for (let j = 0; j < item.channelIds.length; j++) {
          if (item.channelIds[j]) {
            key += '|' + item.channelIds[j];
            break;
          }
        }
      }
      return key || 'unknown';
    }

    async function send(items) {
      if (!Array.isArray(items) || items.length === 0) return { sent: 0, skipped: 0 };
      items = items.filter(function (it) { return it && typeof it === 'object'; });

      const today = new Date(nowFn()).toISOString().slice(0, 10);
      let skippedCount = 0;
      const toSend = [];
      let token = '';
      let base = '';
      let badBase = false;

      // Decide what to send and mark it in flight in one step, so two sends never both post an artist.
      await serial(async function () {
        const state = await readState();
        dropOld(state.sent);
        // A key that can't be read means no key: nothing is sent.
        try { token = (await secrets.get('investigator-token')) || ''; } catch (e) { token = ''; }
        base = state.base;
        if (!token) return;
        // The token only ever travels over https.
        if (!/^https:\/\//.test(base)) { badBase = true; return; }
        const seen = new Set();
        for (let i = 0; i < items.length; i++) {
          const key = keyOf(items[i]);
          if (state.sent[key] === today || inFlight.has(key) || seen.has(key)) {
            skippedCount++;
          } else {
            seen.add(key);
            toSend.push({ key: key, item: items[i] });
          }
        }
        for (let i = 0; i < toSend.length; i++) inFlight.add(toSend[i].key);
      });

      if (!token) return { sent: 0, skipped: items.length };
      if (badBase) {
        try {
          await record(function (state) { state.lastError = 'The investigator address must start with https://'; });
        } catch (e) { /* storage failure is acceptable */ }
        return { sent: 0, skipped: items.length };
      }
      if (toSend.length === 0) return { sent: 0, skipped: skippedCount };

      let error = null;
      let ok = false;
      try {
        const init = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ items: toSend.map(function (t) { return t.item; }) }),
          credentials: 'omit',
          redirect: 'error'
        };
        if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') init.signal = AbortSignal.timeout(15000);
        const resp = await fetchFn(base + '/api/investigate', init);
        ok = true;
        error = resp.ok ? null : 'HTTP ' + resp.status;
      } catch (e) {
        error = e && e.message ? e.message : String(e);
      }

      try {
        // Marked sent for today whatever the answer, so a failure is not retried in a storm.
        await record(function (state) {
          state.lastError = error;
          if (ok) state.lastSentAt = nowFn();
          for (let i = 0; i < toSend.length; i++) state.sent[toSend[i].key] = today;
        });
      } catch (e) {
        // storage failure is acceptable
      } finally {
        for (let i = 0; i < toSend.length; i++) inFlight.delete(toSend[i].key);
      }

      return { sent: ok ? toSend.length : 0, skipped: skippedCount };
    }

    return { send: send };
  }

  globalThis.HM.createInvestigator = createInvestigator;

  async function moveInvestigatorKey(storage, secrets) {
    const key = HM.store.KEYS.investigator;
    const existing = ((await storage.get(key)) || {})[key];
    if (existing && typeof existing.token === 'string' && existing.token !== '') {
      try {
        await secrets.set('investigator-token', existing.token);
      } catch (e) { /* migration failure is non-fatal */ }
      const record = typeof existing === 'object' ? Object.assign({}, existing) : {};
      delete record.token;
      await storage.set({ [key]: record });
    }
  }
  globalThis.HM.moveInvestigatorKey = moveInvestigatorKey;

  // Fresh verdicts (investigator plan, Task 5): for 30 minutes after a send, each worker
  // start refreshes the verdict list when its copy is more than 5 minutes old, so new
  // verdicts arrive soon after the investigator writes them.
  function verdictsRefreshDue(investigator, filterLists, now) {
    if (!investigator || typeof investigator.lastSentAt !== 'number') return false;
    if (now - investigator.lastSentAt > 30 * 60000) return false;
    const meta = Array.isArray(filterLists) ? filterLists.find(function (l) { return l && l.id === 'hm-verdicts'; }) : null;
    if (!meta || meta.enabled === false) return false;
    return typeof meta.lastRefresh !== 'number' || now - meta.lastRefresh > 5 * 60000;
  }
  globalThis.HM.verdictsRefreshDue = verdictsRefreshDue;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    // Firefox's browser.* always returns promises (its chrome.* may not); Chrome has no browser.
    const api = HM.store.api();
    globalThis.HM.refresher = globalThis.HM.createRefresher({
      storage: api.storage.local,
      // The options carry the list limits (redirect: 'error', the abort signal, no credentials);
      // dropping them let redirects through and read huge bodies in full (audit 2026-11-17).
      fetch: function (url, init) { return fetch(url, init); },
      now: function () { return Date.now(); },
      assetUrl: function (path) { return chrome.runtime.getURL(path); },
      isDev: function () { return new Promise(function (resolve) { waitDev(resolve); }); }
    });
    globalThis.HM.investigator = globalThis.HM.createInvestigator({
      storage: api.storage.local,
      fetch: function (url, init) { return fetch(url, init); },
      now: function () { return Date.now(); },
      secrets: globalThis.HM.secrets
    });
    globalThis.HM.moveInvestigatorKey(api.storage.local, globalThis.HM.secrets).catch(function () { /* migration is best-effort */ });

    // Development mode: only true when management.getSelf() reports installType 'development'
    // (unpacked Chrome extension or temporary Firefox add-on). Cached after first answer.
    let devMode = null;
    let devCallbacks = [];
    function setDevMode(value) {
      devMode = value;
      for (let i = 0; i < devCallbacks.length; i++) devCallbacks[i](value);
      devCallbacks = [];
    }
    // An unpacked copy also needs the gitignored extension/dev-copy file, which only Wai's
    // working copy has: friends who load the repo unpacked report 'development' too, and must
    // not get the page aids or the investigator (security audit 2026-11-17). The packers build
    // from git, so a release never carries the file.
    function judgeInstall(info) {
      if (!(info && info.installType === 'development')) { setDevMode(false); return; }
      if (devMode !== null) return; // answered already (getSelf may answer both ways)
      Promise.resolve()
        .then(function () { return fetch(chrome.runtime.getURL('dev-copy')); })
        .then(function (r) { setDevMode(!!(r && r.ok)); })
        .catch(function () { setDevMode(false); });
    }
    (function determineDevMode() {
      const m = chrome.management || {};
      if (!m.getSelf) { setDevMode(false); return; }
      try {
        const result = m.getSelf(judgeInstall);
        if (result && typeof result.then === 'function') {
          result.then(judgeInstall).catch(function() { setDevMode(false); });
        }
      } catch (e) { setDevMode(false); }
    })();
    function isDev() { return devMode === true; }
    function waitDev(callback) { if (devMode !== null) callback(devMode); else devCallbacks.push(callback); }
    function devNote(key, value) {
      if (!isDev()) return;
      try { const o = {}; o['hm.dev.' + key] = Object.assign({ at: Date.now() }, value); api.storage.local.set(o); } catch (e) { /* diagnostics only */ }
    }

    chrome.runtime.onInstalled.addListener(function (details) {
      devNote('installed', { reason: details && details.reason });
      globalThis.HM.refresher.install();
    });

    // After a reload or update Chrome leaves YouTube Music tabs that are already open with
    // a cut-off content script (it stands down) and does not inject the new one. So each
    // time this worker starts, ping every open YouTube Music tab and put the current
    // script into any tab that doesn't answer. (A self-reload does not fire onInstalled.)
    function ensureContentScripts() {
      try {
        chrome.runtime.getManifest().content_scripts.forEach(function (entry) { ensureEntry(entry.matches, entry.js); });
      } catch (e) { devNote('inject', { threw: String(e && e.message) }); }
    }

    // One content_scripts entry: its sites' open tabs get its files where no copy answers.
    function ensureEntry(matches, files) {
      const site = String(matches[0]).replace(/^https:\/\//, '').replace(/\/\*$/, '');
      const note = function (value) { devNote('inject.' + site, value); };
      try {
        const notes = [];
        chrome.tabs.query({ url: matches }, function (tabs) {
          note({ tabs: (tabs || []).length, scripting: !!chrome.scripting });
          (tabs || []).forEach(function (tab) {
            try {
              chrome.tabs.sendMessage(tab.id, { type: 'hm-ping' }, function (reply) {
                const err = chrome.runtime.lastError;
                const missing = err || reply !== true;
                notes.push({ tab: tab.id, reply: reply === true, err: err ? String(err.message) : null });
                note({ tabs: tabs.length, scripting: !!chrome.scripting, notes: notes });
                if (!missing) return;
                try {
                  const done = chrome.scripting.executeScript({ target: { tabId: tab.id }, files: files });
                  if (done && done.then) done.then(function () { notes.push({ tab: tab.id, injected: true }); note({ tabs: tabs.length, notes: notes }); },
                    function (e) { notes.push({ tab: tab.id, injectError: String(e && e.message) }); note({ tabs: tabs.length, notes: notes }); });
                } catch (e) { notes.push({ tab: tab.id, injectThrew: String(e && e.message) }); note({ notes: notes }); }
              });
            } catch (e) { /* tab went away */ }
          });
        });
      } catch (e) { note({ threw: String(e && e.message) }); }
    }
    ensureContentScripts();

    if (chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(function () {
        globalThis.HM.refresher.importBundled();
      });
    }

    // At every start: record this copy's log cap for the content script (0 = keep everything, the
    // development copy) and move an old single-array log into segments.
    waitDev(function (dev) {
      const cap = globalThis.HM.log.capFor(dev);
      api.storage.local.set({ 'hm.logCap': cap });
      globalThis.HM.log.createLogStore(api.storage.local, { cap: cap }).migrate();
    });
    // No alarms (Wai, 2026-11-13: "minimize required permissions"): the worker starts whenever
    // a music tab opens or talks to it (and when the popup asks), and each start refreshes
    // the lists that are due.
    // The built-in upkeep (address, name, format) runs at every start too, not only at install.
    Promise.resolve().then(function () { return globalThis.HM.refresher.ensureBuiltIns(); })
      .catch(function () { /* next start tries again */ })
      .then(function () { return globalThis.HM.refresher.refreshDue(); })
      .then(function () { return api.storage.local.get([HM.store.KEYS.investigator, HM.store.KEYS.filterLists]); })
      .then(function (got) {
        if (verdictsRefreshDue(got[HM.store.KEYS.investigator], got[HM.store.KEYS.filterLists], Date.now())) {
          return globalThis.HM.refresher.refreshOne('hm-verdicts');
        }
      })
      .catch(function () { /* next start tries again */ });

    // The toolbar count, per tab: songs skipped or removed from the queue there (Wai,
    // 2026-11-13: "see how lastpass has this 1 symbol, show the same for human music").
    const badge = chrome.action || chrome.browserAction;
    try {
      if (badge && badge.setBadgeBackgroundColor) badge.setBadgeBackgroundColor({ color: '#5f6368' });
      if (badge && badge.setBadgeTextColor) badge.setBadgeTextColor({ color: '#ffffff' });
    } catch (e) { /* cosmetic only */ }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'hm-count') {
        const tabId = sender && sender.tab && sender.tab.id;
        const n = Math.max(0, Math.floor(Number(msg.count) || 0));
        if (typeof tabId === 'number' && badge && badge.setBadgeText) {
          try { badge.setBadgeText({ tabId: tabId, text: n === 0 ? '' : n > 999 ? '999+' : String(n) }); } catch (e) { /* tab gone */ }
        }
        return false;
      }
      if (msg && msg.type === 'dev-mode') {
        if (devMode !== null) { sendResponse(isDev()); return false; }
        waitDev(function(value) { sendResponse(value); });
        return true;
      }
      if (msg && msg.type === 'dev-reload') {
        if (isDev()) chrome.runtime.reload();
        return false;
      }
      // Unknown artists for the investigator. Only a development copy ever sends (Wai,
      // 2026-11-16: "my developer copy is the only one that calls the investigator"),
      // and only with the key she pasted into it. At most 20 a batch: the service refuses more.
      if (msg && msg.type === 'hm-investigate' && Array.isArray(msg.items)) {
        waitDev(function (dev) {
          if (dev) globalThis.HM.investigator.send(msg.items.slice(0, 20)).catch(function () { /* recorded as lastError */ });
        });
        return false;
      }
      if (msg && msg.type === 'refresh' && typeof msg.id === 'string') {
        globalThis.HM.refresher.refreshOne(msg.id).then(sendResponse);
        return true;
      }
      return false;
    });
  }
})();
