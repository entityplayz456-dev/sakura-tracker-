'use strict';
/* IndexedDB layer — the single source of truth for all records.
   Store "days": one record per local calendar date, keyed by "YYYY-MM-DD".
   Store "meta": small app settings.
   Versioning rule: upgrades are ADDITIVE ONLY. Never delete or recreate a store
   that holds user records; add a new `if (old < N)` block for each new version. */
const DB_NAME = 'sakura-tracker';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error('IndexedDB is not available in this browser'));
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return reject(e); }
    req.onupgradeneeded = (e) => {
      const db = req.result, old = e.oldVersion;
      if (old < 1) {
        db.createObjectStore('days', { keyPath: 'date' });
        db.createObjectStore('meta', { keyPath: 'key' });
      }
      // if (old < 2) { ...future additive changes go here... }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };
    req.onerror = () => reject(req.error || new Error('Could not open the database'));
    req.onblocked = () => reject(new Error('Database update blocked. Close other open tabs of this app and reload.'));
  });
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(store, mode); } catch (e) { _db = null; return reject(e); }
    const s = t.objectStore(store);
    let out;
    const q = fn(s);
    if (q && 'onsuccess' in q) q.onsuccess = () => { out = q.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error || new Error('Database error'));
    t.onabort = () => reject(t.error || new Error('Database write was aborted (storage may be full)'));
  }));
}

const DB = {
  all: () => tx('days', 'readonly', (s) => s.getAll()),
  get: (date) => tx('days', 'readonly', (s) => s.get(date)),
  put: (rec) => tx('days', 'readwrite', (s) => s.put(rec)),
  del: (date) => tx('days', 'readwrite', (s) => s.delete(date)),
  clear: () => tx('days', 'readwrite', (s) => s.clear()),
  /* merge: put() overwrites by date key, so a date never duplicates */
  merge: (recs) => tx('days', 'readwrite', (s) => { recs.forEach((r) => s.put(r)); }),
  /* replace: clear + put in ONE transaction — if anything fails, nothing changes */
  replaceAll: (recs) => tx('days', 'readwrite', (s) => { s.clear(); recs.forEach((r) => s.put(r)); }),
  getMeta: (key) => tx('meta', 'readonly', (s) => s.get(key)).then((r) => (r ? r.value : undefined)),
  setMeta: (key, value) => tx('meta', 'readwrite', (s) => s.put({ key, value })),
};
