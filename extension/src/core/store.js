(function () {
  globalThis.HM = globalThis.HM || {};

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
    // Firefox's browser.* always returns promises (its chrome.* may not); Chrome has no browser.
    api: function () {
      if (typeof browser !== 'undefined' && browser.storage) {
        return browser;
      }
      return globalThis.chrome;
    }
  };
})();