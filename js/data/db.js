// Accès bas niveau à IndexedDB (base locale de l'appareil).
// Magasins :
//   rooms      projets (pièces), clé id
//   furniture  meubles de la bibliothèque, clé id
//   media      images (Blob) : photos, rendus, échantillons, clé id
//   meta       réglages, catégories, traces de suppression… (clé = nom)
const DB_NAME = 'mdf-studio';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) return reject(new Error("Ce navigateur ne permet pas le stockage local (IndexedDB)."));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('rooms')) db.createObjectStore('rooms', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('furniture')) db.createObjectStore('furniture', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Si une autre fenêtre ouvre une version plus récente, on libère la base
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("Base locale bloquée : fermez les autres onglets de l'application."));
  });
  return dbPromise;
}

const wrap = (req) => new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });

/** Exécute fn(stores) dans une transaction ; résout quand la transaction est terminée. */
export async function tx(storeNames, mode, fn) {
  const db = await openDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
    try {
      Promise.resolve(fn(stores)).then((r) => { result = r; }, (e) => { try { t.abort(); } catch { /* déjà terminée */ } reject(e); });
    } catch (e) { t.abort(); reject(e); }
  });
}

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s[store].get(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s[store].getAll())),
  keys: (store) => tx(store, 'readonly', (s) => wrap(s[store].getAllKeys())),
  put: (store, value, key) => tx(store, 'readwrite', (s) => wrap(key === undefined ? s[store].put(value) : s[store].put(value, key))),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s[store].delete(key))),
  /** Supprime plusieurs clés en une transaction */
  delMany: (store, keys) => tx(store, 'readwrite', (s) => Promise.all(keys.map((k) => wrap(s[store].delete(k))))),
  /** Écrit plusieurs valeurs en une transaction */
  putMany: (store, values) => tx(store, 'readwrite', (s) => Promise.all(values.map((v) => wrap(s[store].put(v))))),
  wrap,
};

export const uid = (p = '') => p + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 16) : Math.random().toString(36).slice(2) + Date.now().toString(36));
export const now = () => new Date().toISOString();
