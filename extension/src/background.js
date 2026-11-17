(function () {
  globalThis.HM = globalThis.HM || {};
  // The service worker loads only this file; the helpers come in here (paths relative to src/).
  if (typeof importScripts === 'function') importScripts('core/text.js', 'core/store.js', 'core/lists.js', 'core/settings.js');

  function createRefresher(opts) {
    const storage = opts.storage;
    const fetchFn = opts.fetch;
    const nowFn = opts.now;
    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;
    const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : 5000000;

    async function install() {
      const stored = await storage.get([HM.store.KEYS.filterLists, HM.store.KEYS.user, HM.store.KEYS.settings]);

      if (!stored[HM.store.KEYS.filterLists]) {
        await storage.set({
          [HM.store.KEYS.filterLists]: [{ ...globalThis.HM.lists.SOUL_OVER_AI }, { ...globalThis.HM.lists.HM_VERDICTS }, { ...globalThis.HM.lists.CEVVAL }]
        });
      }

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
      // Ensure the built-in verdict list is always present after bundled import
      // (no list meta yet means install has not run: leave the storage to it)
      let metas = (await storage.get(HM.store.KEYS.filterLists))[HM.store.KEYS.filterLists];
      if (Array.isArray(metas) && !metas.some(m => m.id === 'hm-verdicts')) {
        metas = metas.concat([{ ...HM.lists.HM_VERDICTS }]);
        await storage.set({ [HM.store.KEYS.filterLists]: metas });
      }
      if (Array.isArray(metas) && !metas.some(m => m.id === 'cevval')) {
        metas = metas.concat([{ ...HM.lists.CEVVAL }]);
        await storage.set({ [HM.store.KEYS.filterLists]: metas });
      }
      // Built-in lists take their name and address from the code, so a list that moves
      // (the verdict list did, 2026-11-17) follows on the next start. The person's own
      // choices (on or off, Watch only) and the refresh record stay.
      if (Array.isArray(metas)) {
        const BUILT_INS = [HM.lists.SOUL_OVER_AI, HM.lists.HM_VERDICTS, HM.lists.CEVVAL];
        let changed = false;
        const next = metas.map(m => {
          const code = m && m.builtIn === true ? BUILT_INS.find(b => b.id === m.id) : null;
          if (!code || (m.url === code.url && m.name === code.name)) return m;
          changed = true;
          return { ...m, url: code.url, name: code.name };
        });
        if (changed) await storage.set({ [HM.store.KEYS.filterLists]: next });
      }
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
              const metas = (await storage.get(HM.store.KEYS.filterLists))[HM.store.KEYS.filterLists] || [];
              await storage.set({ [HM.store.KEYS.filterLists]: metas.map(function (m) {
                return m.id === f.id ? Object.assign({}, m, { count: parsed.artists.length }) : m;
              }) });
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

    async function refreshOne(id) {
      try {
        let lists = await storage.get(HM.store.KEYS.filterLists);
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

        const setObj = {};
        setObj[HM.store.listKey(id)] = listData;
        await storage.set(setObj);

        lists = await storage.get(HM.store.KEYS.filterLists);
        for (let j = 0; j < lists[HM.store.KEYS.filterLists].length; j++) {
          if (lists[HM.store.KEYS.filterLists][j].id === id) {
            lists[HM.store.KEYS.filterLists][j].count = listData.artists.length;
            lists[HM.store.KEYS.filterLists][j].lastRefresh = nowFn();
            lists[HM.store.KEYS.filterLists][j].lastError = null;
            lists[HM.store.KEYS.filterLists][j].calibrated = listData.calibrated;
            break;
          }
        }
        await storage.set({ [HM.store.KEYS.filterLists]: lists[HM.store.KEYS.filterLists] });
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
      const lists = await storage.get(HM.store.KEYS.filterLists);
      if (!lists[HM.store.KEYS.filterLists] || lists[HM.store.KEYS.filterLists].length === 0) {
        return;
      }
      for (let i = 0; i < lists[HM.store.KEYS.filterLists].length; i++) {
        if (lists[HM.store.KEYS.filterLists][i].id === id) {
          lists[HM.store.KEYS.filterLists][i].lastError = message;
          lists[HM.store.KEYS.filterLists][i].lastFailedAt = nowFn();
          break;
        }
      }
      const setObj = {};
      setObj[HM.store.KEYS.filterLists] = lists[HM.store.KEYS.filterLists];
      await storage.set(setObj);

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

      for (let i = 0; i < lists[HM.store.KEYS.filterLists].length; i++) {
        const list = lists[HM.store.KEYS.filterLists][i];
        if (!list.enabled) {
          continue;
        }
        // A list that failed in the last hour rests, so a broken list isn't fetched at every
        // worker start (the popup's Refresh button still tries at once).
        if (list.lastError && typeof list.lastFailedAt === 'number' && now - list.lastFailedAt < 3600000) continue;
        if (globalThis.HM.lists.isRefreshDue(list.lastRefresh, settings.refresh, now)) {
          refreshed.push(list.id);
          await refreshOne(list.id);
        }
      }

      return refreshed;
    }

    return { install: install, refreshOne: refreshOne, refreshDue: refreshDue, importBundled: importBundled };
  }

  globalThis.HM.createRefresher = createRefresher;

  function createInvestigator(opts) {
    const storage = opts.storage;
    const fetchFn = opts.fetch;
    const nowFn = opts.now;
    let state = null;
    let loading = null;

    async function loadState() {
      const key = HM.store.KEYS.investigator;
      const existing = (await storage.get(key))[key];
      if (existing && typeof existing === 'object') {
        state = existing;
        if (typeof state.token !== 'string') state.token = '';
        if (typeof state.base !== 'string') state.base = 'https://wai-lau.net/human-music';
        if (!state.sent || typeof state.sent !== 'object') state.sent = {};
      } else {
        state = { token: '', base: 'https://wai-lau.net/human-music', sent: {} };
      }
      return state;
    }

    async function saveState() {
      const key = HM.store.KEYS.investigator;
      const obj = {};
      obj[key] = state;
      await storage.set(obj);
    }

    async function send(items) {
      if (!Array.isArray(items) || items.length === 0) return { sent: 0, skipped: 0 };
      items = items.filter(function (it) { return it && typeof it === 'object'; });

      if (loading) await loading;
      loading = loadState();
      await loading;
      loading = null;

      if (!state.token || state.token.length === 0) {
        return { sent: 0, skipped: items.length };
      }

      // The token only ever travels over https.
      if (!/^https:\/\//.test(state.base)) {
        state.lastError = 'The investigator address must start with https://';
        try { await saveState(); } catch (e) { /* storage failure is acceptable */ }
        return { sent: 0, skipped: items.length };
      }

      const today = new Date(nowFn()).toISOString().slice(0, 10);

      // Prune sent entries older than 7 days
      for (const k in state.sent) {
        if (state.sent[k] && state.sent[k].length === 10) {
          try {
            if (nowFn() - new Date(state.sent[k] + 'T00:00:00Z').getTime() > 7 * 24 * 3600 * 1000) {
              delete state.sent[k];
            }
          } catch (e) {
            delete state.sent[k];
          }
        }
      }

      let sentCount;
      let skippedCount = 0;
      const toSend = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
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
        if (!key) key = 'unknown';

        if (state.sent[key] && state.sent[key] === today) {
          skippedCount++;
        } else {
          toSend.push({ key: key, item: item });
        }
      }

      if (toSend.length === 0) {
        return { sent: 0, skipped: skippedCount };
      }

      const payload = {
        items: toSend.map(function (t) {
          return t.item;
        })
      };

      try {
        const url = state.base + '/api/investigate';
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + state.token
        };
        const resp = await fetchFn(url, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload)
        });

        state.lastError = resp.ok ? null : 'HTTP ' + resp.status;

        // Mark all sent for today regardless of response
        for (let i = 0; i < toSend.length; i++) {
          state.sent[toSend[i].key] = today;
        }
        state.lastSentAt = nowFn();
        sentCount = toSend.length;
      } catch (e) {
        state.lastError = e.message;
        // Still mark as sent to prevent retry storm
        for (let i = 0; i < toSend.length; i++) {
          state.sent[toSend[i].key] = today;
        }
        sentCount = 0;
      }

      try {
        await saveState();
      } catch (e) {
        // storage failure is acceptable
      }

      return { sent: sentCount, skipped: skippedCount };
    }

    return { send: send };
  }

  globalThis.HM.createInvestigator = createInvestigator;

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
      assetUrl: function (path) { return chrome.runtime.getURL(path); }
    });
    globalThis.HM.investigator = globalThis.HM.createInvestigator({
      storage: api.storage.local,
      fetch: function (url, init) { return fetch(url, init); },
      now: function () { return Date.now(); }
    });

    // Development mode: only true when management.getSelf() reports installType 'development'
    // (unpacked Chrome extension or temporary Firefox add-on). Cached after first answer.
    let devMode = null;
    let devCallbacks = [];
    function setDevMode(value) {
      devMode = value;
      for (let i = 0; i < devCallbacks.length; i++) devCallbacks[i](value);
      devCallbacks = [];
    }
    (function determineDevMode() {
      const m = chrome.management || {};
      if (!m.getSelf) { setDevMode(false); return; }
      try {
        const result = m.getSelf(function(info) { setDevMode(info && info.installType === 'development'); });
        if (result && typeof result.then === 'function') {
          result.then(function(info) { setDevMode(info && info.installType === 'development'); }).catch(function() { setDevMode(false); });
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

    // No alarms (Wai, 2026-11-13: "minimize required permissions"): the worker starts whenever
    // a music tab opens or talks to it (and when the popup asks), and each start refreshes
    // the lists that are due.
    Promise.resolve().then(function () { return globalThis.HM.refresher.refreshDue(); })
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
      // and only with the key she pasted into it.
      if (msg && msg.type === 'hm-investigate' && Array.isArray(msg.items)) {
        waitDev(function (dev) {
          if (dev) globalThis.HM.investigator.send(msg.items.slice(0, 50)).catch(function () { /* recorded as lastError */ });
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
