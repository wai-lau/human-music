(function () {
  globalThis.HM = globalThis.HM || {};

  globalThis.HM.store = {
    KEYS: {
      user: 'hm.user',
      settings: 'hm.settings',
      filterLists: 'hm.filterLists',
      log: 'hm.log',
      bundled: 'hm.bundled'
    },
    listPrefix: 'hm.list.',
    listKey: function (id) {
      return HM.store.listPrefix + id;
    },
    emptyUser: function () {
      return { artists: [], songs: [], keywords: [], neverSkip: [] };
    },
    api: function () {
      if (typeof browser !== 'undefined' && browser.storage) {
        return browser;
      }
      return globalThis.chrome;
    }
  };
})();