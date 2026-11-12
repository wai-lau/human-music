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

      await refreshOne('soul-over-ai');
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

    return { install: install, refreshOne: refreshOne, refreshDue: refreshDue };
  }

  globalThis.HM.createRefresher = createRefresher;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    globalThis.HM.refresher = globalThis.HM.createRefresher({
      storage: chrome.storage.local,
      fetch: fetch,
      now: function () { return Date.now(); }
    });

    chrome.runtime.onInstalled.addListener(function () {
      globalThis.HM.refresher.install();
    });

    chrome.alarms.create('hm-refresh', { periodInMinutes: 60 });

    chrome.alarms.onAlarm.addListener(function (alarm) {
      if (alarm.name === 'hm-refresh') {
        globalThis.HM.refresher.refreshDue();
      }
    });

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.type === 'refresh' && typeof msg.id === 'string') {
        globalThis.HM.refresher.refreshOne(msg.id).then(sendResponse);
        return true;
      }
      return false;
    });
  }
})();
