(function () {
  globalThis.HM = globalThis.HM || {};
  // The service worker loads only this file; the helpers come in here (paths relative to src/).
  if (typeof importScripts === 'function') importScripts('core/text.js', 'core/lists.js', 'core/settings.js');

  function createRefresher(opts) {
    var storage = opts.storage;
    var fetchFn = opts.fetch;
    var nowFn = opts.now;

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

        var resp = await fetchFn(list.url);
        if (!resp.ok) {
          await recordFailure(id, 'HTTP ' + resp.status);
          return false;
        }

        var text = await resp.text();
        var parsed = JSON.parse(text);
        var listData = globalThis.HM.lists.parseFilterList(parsed);

        if (listData === null) {
          await recordFailure(id, 'Not a filter list');
          return false;
        }

        var setObj = {};
        setObj['hm.list.' + id] = listData;
        await storage.set(setObj);

        var lists = await storage.get('hm.filterLists');
        for (var i = 0; i < lists['hm.filterLists'].length; i++) {
          if (lists['hm.filterLists'][i].id === id) {
            lists['hm.filterLists'][i].count = listData.artists.length;
            lists['hm.filterLists'][i].lastRefresh = nowFn();
            lists['hm.filterLists'][i].lastError = null;
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
    globalThis.HM.refresher = globalThis.HM.createRefresher({
      storage: chrome.storage.local,
      fetch: function (url) { return fetch(url); },
      now: function () { return Date.now(); },
      assetUrl: function (path) { return chrome.runtime.getURL(path); }
    });

    // Installing, updating and reloading the extension all land here.
    chrome.runtime.onInstalled.addListener(function () {
      globalThis.HM.refresher.install();
    });

    // After a reload or update Chrome leaves YouTube Music tabs that are already open with
    // a cut-off content script (it stands down) and does not inject the new one. So each
    // time this worker starts, ping every open YouTube Music tab and put the current
    // script into any tab that doesn't answer. (A self-reload does not fire onInstalled.)
    function ensureContentScripts() {
      try {
        var files = chrome.runtime.getManifest().content_scripts[0].js;
        chrome.tabs.query({ url: 'https://music.youtube.com/*' }, function (tabs) {
          (tabs || []).forEach(function (tab) {
            try {
              chrome.tabs.sendMessage(tab.id, { type: 'hm-ping' }, function (reply) {
                var missing = chrome.runtime.lastError || reply !== true;
                if (!missing) return;
                try {
                  var done = chrome.scripting.executeScript({ target: { tabId: tab.id }, files: files });
                  if (done && done.catch) done.catch(function () {});
                } catch (e) { /* a tab that can't take it */ }
              });
            } catch (e) { /* tab went away */ }
          });
        });
      } catch (e) { /* nothing to do */ }
    }
    ensureContentScripts();

    if (chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(function () {
        globalThis.HM.refresher.importBundled();
      });
    }

    chrome.alarms.create('hm-refresh', { periodInMinutes: 60 });

    chrome.alarms.onAlarm.addListener(function (alarm) {
      if (alarm.name === 'hm-refresh') {
        globalThis.HM.refresher.refreshDue();
      }
    });

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      // Development only: an unpacked extension (no update_url) can be told to reload
      // itself, so new code is picked up without a trip to chrome://extensions.
      if (msg && msg.type === 'dev-reload' && !('update_url' in chrome.runtime.getManifest())) {
        chrome.runtime.reload();
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
