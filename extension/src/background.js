(function () {
  globalThis.HM = globalThis.HM || {};
  // The service worker loads only this file; the helpers come in here (paths relative to src/).
  if (typeof importScripts === 'function') importScripts('core/text.js', 'core/lists.js', 'core/settings.js');

  function createRefresher(opts) {
    var storage = opts.storage;
    var fetchFn = opts.fetch;
    var nowFn = opts.now;
    var timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 15000;
    var maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : 5000000;

    async function install() {
      var stored = await storage.get(['hm.filterLists', 'hm.user', 'hm.settings']);

      if (!stored['hm.filterLists']) {
        await storage.set({
          'hm.filterLists': [{ ...globalThis.HM.lists.SOUL_OVER_AI }]
        });
      }

      if (!stored['hm.user']) {
        await storage.set({
          'hm.user': { artists: [], songs: [], keywords: [], neverSkip: [] }
        });
      }

      if (!stored['hm.settings']) {
        await storage.set({
          'hm.settings': globalThis.HM.settings.DEFAULTS
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
    async function importBundled() {
      var done = [];
      if (typeof opts.assetUrl !== 'function') return done;
      var HM = globalThis.HM;
      var index;
      try {
        index = JSON.parse(await (await fetchFn(opts.assetUrl('lists/index.json'))).text());
      } catch (e) {
        return done;
      }
      var files = index && Array.isArray(index.files) ? index.files : [];
      var seen = (await storage.get('hm.bundled'))['hm.bundled'] || {};
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        try {
          if (!f || typeof f.file !== 'string' || !/^[\w.-]+\.json$/.test(f.file)) continue;
          var text = await (await fetchFn(opts.assetUrl('lists/' + f.file))).text();
          var print = HM.lists.fingerprint(text);
          if (seen[f.file] === print) continue;
          var data = JSON.parse(text);
          if (f.kind === 'backup') {
            var imported = HM.lists.importBackup(data);
            var cur = await storage.get(['hm.user', 'hm.settings', 'hm.filterLists']);
            var next = HM.lists.applyBackup({
              user: cur['hm.user'], settings: cur['hm.settings'],
              filterLists: cur['hm.filterLists'] || [{ ...HM.lists.SOUL_OVER_AI }]
            }, imported);
            var write = { 'hm.user': next.user };
            if (imported.settings) write['hm.settings'] = HM.settings.sanitize(next.settings);
            if (imported.filterLists) write['hm.filterLists'] = next.filterLists;
            await storage.set(write);
          } else if (f.kind === 'filter-list' && typeof f.id === 'string') {
            var parsed = HM.lists.parseFilterList(data);
            if (!parsed) continue;
            var key = 'hm.list.' + f.id;
            var have = (await storage.get(key))[key];
            if (!have || !Array.isArray(have.artists) || have.artists.length === 0) {
              var setObj = {};
              setObj[key] = parsed;
              await storage.set(setObj);
              var metas = (await storage.get('hm.filterLists'))['hm.filterLists'] || [];
              await storage.set({ 'hm.filterLists': metas.map(function (m) {
                return m.id === f.id ? Object.assign({}, m, { count: parsed.artists.length }) : m;
              }) });
            }
          } else {
            continue;
          }
          seen[f.file] = print;
          await storage.set({ 'hm.bundled': seen });
          done.push(f.file);
        } catch (e) {
          // skip this file; the others still import
        }
      }
      return done;
    }

    async function refreshOne(id) {
      try {
        var lists = await storage.get('hm.filterLists');
        if (!lists['hm.filterLists'] || lists['hm.filterLists'].length === 0) {
          return false;
        }
        var list = null;
        for (var i = 0; i < lists['hm.filterLists'].length; i++) {
          if (lists['hm.filterLists'][i].id === id) {
            list = lists['hm.filterLists'][i];
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

        var controller = null;
        var signal = null;
        var timeoutHandle = null;
        if (typeof AbortController !== 'undefined') {
          controller = new AbortController();
          signal = controller.signal;
        }
        if (typeof setTimeout !== 'undefined' && signal) {
          timeoutHandle = setTimeout(function() { controller.abort(); }, timeoutMs);
        }

        var opts = { redirect: 'error' };
        if (signal) opts.signal = signal;

        var fetchPromise = fetchFn(list.url, opts);

        var resp;
        try {
          if (typeof setTimeout !== 'undefined') {
            var timeoutPromise = new Promise(function(_, reject) {
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
          var cl = resp.headers.get('content-length');
          if (cl !== null && Number(cl) > maxBytes) {
            if (timeoutHandle !== null) clearTimeout(timeoutHandle);
            await recordFailure(id, 'Content-Length over ' + maxBytes + ' bytes');
            return false;
          }
        }

        var textPromise = resp.text();
        var text;
        try {
          if (typeof setTimeout !== 'undefined') {
            var textTimeout = new Promise(function(_, reject) {
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

        if (text.length > maxBytes) {
          await recordFailure(id, 'Body over ' + maxBytes + ' bytes');
          return false;
        }

        var parsed = JSON.parse(text);
        var listData = globalThis.HM.lists.parseFilterList(parsed);

        if (listData === null) {
          await recordFailure(id, 'Not a filter list');
          return false;
        }

        var setObj = {};
        setObj['hm.list.' + id] = listData;
        await storage.set(setObj);

        lists = await storage.get('hm.filterLists');
        for (var j = 0; j < lists['hm.filterLists'].length; j++) {
          if (lists['hm.filterLists'][j].id === id) {
            lists['hm.filterLists'][j].count = listData.artists.length;
            lists['hm.filterLists'][j].lastRefresh = nowFn();
            lists['hm.filterLists'][j].lastError = null;
            break;
          }
        }
        await storage.set({ 'hm.filterLists': lists['hm.filterLists'] });
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

    async function recordFailure(id, message) {
      var lists = await storage.get('hm.filterLists');
      if (!lists['hm.filterLists'] || lists['hm.filterLists'].length === 0) {
        return;
      }
      for (var i = 0; i < lists['hm.filterLists'].length; i++) {
        if (lists['hm.filterLists'][i].id === id) {
          lists['hm.filterLists'][i].lastError = message;
          break;
        }
      }
      var setObj = {};
      setObj['hm.filterLists'] = lists['hm.filterLists'];
      await storage.set(setObj);

      var listKey = 'hm.list.' + id;
      var stored = await storage.get(listKey);
      if (!stored[listKey]) {
        var emptyList = {};
        emptyList[listKey] = { artists: [] };
        await storage.set(emptyList);
      }
    }

    async function refreshDue() {
      var lists = await storage.get('hm.filterLists');
      if (!lists['hm.filterLists'] || lists['hm.filterLists'].length === 0) {
        return [];
      }
      var settings = await storage.get('hm.settings');
      var settings = globalThis.HM.settings.sanitize(settings['hm.settings']);
      var now = nowFn();
      var refreshed = [];

      for (var i = 0; i < lists['hm.filterLists'].length; i++) {
        var list = lists['hm.filterLists'][i];
        if (!list.enabled) {
          continue;
        }
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

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    // Firefox's browser.* always returns promises (its chrome.* may not); Chrome has no browser.
    var api = typeof browser !== 'undefined' && browser.storage ? browser : chrome;
    globalThis.HM.refresher = globalThis.HM.createRefresher({
      storage: api.storage.local,
      fetch: function (url) { return fetch(url); },
      now: function () { return Date.now(); },
      assetUrl: function (path) { return chrome.runtime.getURL(path); }
    });

    // Development mode: only true when management.getSelf() reports installType 'development'
    // (unpacked Chrome extension or temporary Firefox add-on). Cached after first answer.
    var devMode = null;
    var devCallbacks = [];
    function setDevMode(value) {
      devMode = value;
      for (var i = 0; i < devCallbacks.length; i++) devCallbacks[i](value);
      devCallbacks = [];
    }
    (function determineDevMode() {
      var m = chrome.management || {};
      if (!m.getSelf) { setDevMode(false); return; }
      try {
        var result = m.getSelf(function(info) { setDevMode(info && info.installType === 'development'); });
        if (result && typeof result.then === 'function') {
          result.then(function(info) { setDevMode(info && info.installType === 'development'); }).catch(function() { setDevMode(false); });
        }
      } catch (e) { setDevMode(false); }
    })();
    function isDev() { return devMode === true; }
    function waitDev(callback) { if (devMode !== null) callback(devMode); else devCallbacks.push(callback); }
    function devNote(key, value) {
      if (!isDev()) return;
      try { var o = {}; o['hm.dev.' + key] = Object.assign({ at: Date.now() }, value); api.storage.local.set(o); } catch (e) { /* diagnostics only */ }
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
      var site = String(matches[0]).replace(/^https:\/\//, '').replace(/\/\*$/, '');
      var note = function (value) { devNote('inject.' + site, value); };
      try {
        var notes = [];
        chrome.tabs.query({ url: matches }, function (tabs) {
          note({ tabs: (tabs || []).length, scripting: !!chrome.scripting });
          (tabs || []).forEach(function (tab) {
            try {
              chrome.tabs.sendMessage(tab.id, { type: 'hm-ping' }, function (reply) {
                var err = chrome.runtime.lastError;
                var missing = err || reply !== true;
                notes.push({ tab: tab.id, reply: reply === true, err: err ? String(err.message) : null });
                note({ tabs: tabs.length, scripting: !!chrome.scripting, notes: notes });
                if (!missing) return;
                try {
                  var done = chrome.scripting.executeScript({ target: { tabId: tab.id }, files: files });
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
    Promise.resolve().then(function () { return globalThis.HM.refresher.refreshDue(); }).catch(function () { /* next start tries again */ });

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
      if (msg && msg.type === 'refresh' && typeof msg.id === 'string') {
        globalThis.HM.refresher.refreshOne(msg.id).then(sendResponse);
        return true;
      }
      return false;
    });
  }
})();
