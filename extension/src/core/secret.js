(function () {
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};

  function createSecrets(backend) {
    if (backend) {
      return {
        get: function (name) { return Promise.resolve(backend.get(name)); },
        set: function (name, value) { return Promise.resolve(backend.set(name, value)); },
        remove: function (name) { return Promise.resolve(backend.remove(name)); }
      };
    }

    // IndexedDB backend: only extension pages and the worker can open it; content scripts on
    // music pages cannot (the extension's origin is not their origin).
    const DB_NAME = 'hm-secrets';
    const STORE_NAME = 'kv';
    function openDB() {
      return new Promise(function (resolve, reject) {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () {
            if (!req.result.objectStoreNames.contains(STORE_NAME)) {
              req.result.createObjectStore(STORE_NAME);
            }
          };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        } catch (e) { reject(e); }
      });
    }
    return {
      get: function (name) {
        return openDB().then(function (db) {
          return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(name);
            req.onsuccess = function () { resolve(req.result === undefined ? null : req.result); };
            req.onerror = function () { reject(req.error); };
          });
        });
      },
      set: function (name, value) {
        return openDB().then(function (db) {
          return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(value, name);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
          });
        });
      },
      remove: function (name) {
        return openDB().then(function (db) {
          return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(name);
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { reject(tx.error); };
          });
        });
      }
    };
  }

  globalThis.HM.createSecrets = createSecrets;
  globalThis.HM.secrets = createSecrets(typeof globalThis.__hmSecretBackend === 'object' ? globalThis.__hmSecretBackend : null);
})();