(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

  // Where Human Music keeps things in extension storage, in one place. The key strings are
  // what is stored: changing one loses that data.

  globalThis.HM.store = {
    KEYS: {
      user: 'hm.user',
      settings: 'hm.settings',
      filterLists: 'hm.filterLists',
      log: 'hm.log',
      bundled: 'hm.bundled',
      investigator: 'hm.investigator'
    },
    listPrefix: 'hm.list.',
    listKey: function (id) {
      return globalThis.HM.store.listPrefix + id;
    },
    emptyUser: function () {
      return { artists: [], songs: [], keywords: [], neverSkip: [] };
    },
    // Every read-modify-write of hm.user, hm.settings and hm.filterLists goes through here, from
    // the popup, the worker and the content scripts alike, so one context's edit never undoes
    // another's. Under a Web Lock named for the key (when navigator.locks exists), it reads what
    // is stored right now, calls fn(current), and writes the result. fn may be async; returning
    // undefined means no write. Resolves to the new value (or the current one when unchanged).
    // A failure rejects and writes nothing; the error carries stage 'read', 'change' or 'write'.
    // opts.locks injects a locks object for tests (null means none). Without Web Locks the
    // edit still runs, just without the cross-context guarantee.
    modify: function (storage, key, fn, opts) {
      let locks = opts && opts.locks !== undefined ? opts.locks : null;
      if (!(opts && opts.locks !== undefined)) {
        try { locks = typeof navigator !== 'undefined' && navigator && navigator.locks ? navigator.locks : null; } catch (e) { locks = null; }
      }
      const tag = function (stage, e) {
        if (e && typeof e === 'object') e.stage = stage;
        return e;
      };
      const body = async function () {
        let cur;
        try { cur = ((await storage.get(key)) || {})[key]; } catch (e) { throw tag('read', e); }
        let next;
        try { next = await fn(cur); } catch (e) { throw tag('change', e); }
        if (next === undefined) return cur;
        try { await storage.set({ [key]: next }); } catch (e) { throw tag('write', e); }
        return next;
      };
      return locks && typeof locks.request === 'function' ? locks.request('hm-' + key, body) : body();
    },
    // Firefox's browser.* always returns promises (its chrome.* may not); Chrome has no browser.
    api: function () {
      if (typeof browser !== 'undefined' && browser.storage) {
        return browser;
      }
      return globalThis.chrome;
    }
  };
})();