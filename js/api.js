// Couche de données de l'application : remplace l'ancienne API REST du serveur.
// Tout est stocké sur l'appareil (IndexedDB). Les pages appellent ces fonctions
// exactement comme avant elles appelaient le serveur.
//
// Préparation de la synchronisation (étape 2, Google Drive) :
//  - chaque enregistrement a un id stable, createdAt et updatedAt ;
//  - les suppressions laissent une trace (meta "tombstones") ;
//  - chaque modification est signalée via onChange(), qu'un futur module de
//    synchronisation pourra écouter sans toucher aux pages.
import { idb, tx, uid, now } from './data/db.js';
import { storeImages, deleteMedia, collectMediaIds } from './data/media.js';

export { uid, now };

export const DEFAULT_CATEGORIES = [
  { id: 'salon', name: 'Salon', types: ['Canapé', 'Fauteuil', 'Table basse', 'Meuble TV', 'Bibliothèque', 'Buffet', 'Pouf'] },
  { id: 'salle-a-manger', name: 'Salle à manger', types: ['Table', 'Chaise', 'Buffet', 'Vaisselier', 'Banc'] },
  { id: 'cuisine', name: 'Cuisine', types: ['Table', 'Chaise', 'Tabouret', 'Îlot', 'Desserte'] },
  { id: 'chambre', name: 'Chambre', types: ['Lit', 'Table de chevet', 'Commode', 'Armoire', 'Dressing', 'Coiffeuse'] },
  { id: 'bureau', name: 'Bureau', types: ['Bureau', 'Chaise de bureau', 'Rangement', 'Étagère'] },
  { id: 'entree', name: 'Entrée', types: ['Console', 'Meuble à chaussures', 'Banc', 'Miroir'] },
];

export const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('c');

// ---------- Notifications de changement ----------
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(store, id, op) { listeners.forEach((fn) => { try { fn({ store, id, op }); } catch (e) { console.error(e); } }); }

// ---------- Méta (réglages, catégories, suppressions) ----------
const meta = {
  get: (k) => idb.get('meta', k),
  set: (k, v) => idb.put('meta', v, k),
};

async function tombstone(store, id) {
  const t = (await meta.get('tombstones')) || {};
  (t[store] ??= {})[id] = now();
  await meta.set('tombstones', t);
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const notFound = (what) => Object.assign(new Error(`${what} introuvable`), { status: 404 });

const FURN_FIELDS = ['name', 'reference', 'category', 'type', 'length', 'width', 'height', 'seatHeight', 'topHeight', 'extra', 'notes', 'photos', 'cover', 'sourceUrl', 'sizes', 'modular'];
// mode : 'full' (parcours en 4 étapes, par défaut) ou 'quick' (rendu rapide : photo + zone + meuble)
const ROOM_FIELDS = ['name', 'category', 'dims', 'photos', 'refPhoto', 'plan', 'extraInstructions', 'mode', 'quick'];

/** Supprime des images, sauf celles encore utilisées par un autre projet ou meuble */
async function releaseMedia(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return;
  const used = new Set();
  (await idb.all('rooms')).forEach((r) => collectMediaIds(r, used));
  (await idb.all('furniture')).forEach((f) => collectMediaIds(f, used));
  await deleteMedia(list.filter((m) => !used.has(m)));
}

const byDateDesc = (k) => (a, b) => String(b[k] || '').localeCompare(String(a[k] || ''));

export const api = {
  meta,
  releaseMedia,
  /** Signale un import groupé (pour un futur module de synchronisation) */
  notifyImport() { emit('*', null, 'import'); },

  // ----- Réglages -----
  async settings() { return (await meta.get('settings')) || {}; },
  async saveSettings(s) { await meta.set('settings', s); emit('meta', 'settings', 'put'); return s; },

  // ----- Catégories (niveau 1 = pièce, niveau 2 = type) -----
  async categories() {
    let c = await meta.get('categories');
    if (!c) { c = structuredClone(DEFAULT_CATEGORIES); await meta.set('categories', c); }
    return c;
  },
  async saveCategories(cats) {
    if (!Array.isArray(cats)) throw new Error('Liste attendue');
    const clean = cats.map((c) => ({
      id: c.id || slug(c.name),
      name: String(c.name || '').trim(),
      types: [...new Set((c.types || []).map((t) => String(t).trim()).filter(Boolean))],
    })).filter((c) => c.name);
    await meta.set('categories', clean);
    await meta.set('categoriesUpdatedAt', now());
    emit('meta', 'categories', 'put');
    return clean;
  },
  async resetCategories() { return this.saveCategories(structuredClone(DEFAULT_CATEGORIES)); },

  // ----- Meubles -----
  async furniture(q = {}) {
    let list = (await idb.all('furniture')).sort(byDateDesc('createdAt'));
    if (q.category) list = list.filter((f) => f.category === q.category);
    if (q.type) list = list.filter((f) => f.type === q.type);
    if (q.q) {
      const s = String(q.q).toLowerCase();
      list = list.filter((f) => [f.name, f.reference, f.type].join(' ').toLowerCase().includes(s));
    }
    return list;
  },
  async getFurniture(id) {
    const f = await idb.get('furniture', id);
    if (!f) throw notFound('Meuble');
    return f;
  },
  async createFurniture(data) {
    const body = pick(data, FURN_FIELDS);
    if (!body.name) throw new Error('Le nom est obligatoire');
    const item = { id: uid('f'), createdAt: now(), updatedAt: now(), photos: [], ...body };
    await idb.put('furniture', item);
    emit('furniture', item.id, 'put');
    return item;
  },
  async updateFurniture(id, data) {
    const old = await idb.get('furniture', id);
    if (!old) throw notFound('Meuble');
    const item = { ...old, ...pick(data, FURN_FIELDS), id, updatedAt: now() };
    await idb.put('furniture', item);
    // photos retirées de la fiche : on libère la place
    const keep = collectMediaIds(item);
    await releaseMedia([...collectMediaIds(old)].filter((m) => !keep.has(m)));
    emit('furniture', id, 'put');
    return item;
  },
  async deleteFurniture(id) {
    const old = await idb.get('furniture', id);
    if (!old) return { ok: false };
    await idb.del('furniture', id);
    await releaseMedia([...collectMediaIds(old)]);
    await tombstone('furniture', id);
    emit('furniture', id, 'delete');
    return { ok: true };
  },

  // ----- Pièces (projets) -----
  async rooms() { return (await idb.all('rooms')).sort(byDateDesc('updatedAt')); },
  async room(id) {
    const r = await idb.get('rooms', id);
    if (!r) throw notFound('Pièce');
    return r;
  },
  async createRoom(data = {}) {
    const room = {
      id: uid('r'), createdAt: now(), updatedAt: now(),
      name: 'Ma pièce', dims: { length: 500, width: 400, height: 250 }, photos: [], refPhoto: 0,
      plan: null, renders: [], ...pick(data, ROOM_FIELDS),
    };
    await idb.put('rooms', room);
    emit('rooms', room.id, 'put');
    return room;
  },
  async updateRoom(id, data) {
    return this._patchRoom(id, (r) => Object.assign(r, pick(data, ROOM_FIELDS)));
  },
  /** Modifie une pièce dans une seule transaction (évite d'écraser un rendu ajouté entre-temps) */
  async _patchRoom(id, fn) {
    let out;
    await tx('rooms', 'readwrite', async (s) => {
      const r = await idb.wrap(s.rooms.get(id));
      if (!r) throw notFound('Pièce');
      fn(r);
      r.id = id;
      r.updatedAt = now();
      await idb.wrap(s.rooms.put(r));
      out = r;
    });
    emit('rooms', id, 'put');
    return out;
  },
  async deleteRoom(id) {
    const old = await idb.get('rooms', id);
    if (!old) return { ok: false };
    await idb.del('rooms', id);
    await releaseMedia([...collectMediaIds(old)]);
    await tombstone('rooms', id);
    emit('rooms', id, 'delete');
    return { ok: true };
  },

  // ----- Rendus -----
  async addRender(roomId, render, maxUnsaved = 20) {
    let dropped = [];
    const room = await this._patchRoom(roomId, (r) => {
      r.renders = [render, ...(r.renders || [])];
      const unsaved = r.renders.filter((x) => !x.saved);
      if (unsaved.length > maxUnsaved) {
        dropped = unsaved.slice(maxUnsaved);
        const ids = new Set(dropped.map((x) => x.id));
        r.renders = r.renders.filter((x) => !ids.has(x.id));
      }
    });
    if (dropped.length) await releaseMedia(dropped.map((x) => x.media));
    return room;
  },
  async updateRender(roomId, rid, patch) {
    let out;
    await this._patchRoom(roomId, (r) => {
      const x = r.renders?.find((y) => y.id === rid);
      if (!x) throw notFound('Rendu');
      if (patch.saved !== undefined) x.saved = Boolean(patch.saved);
      if (patch.title !== undefined) x.title = String(patch.title);
      out = x;
    });
    return out;
  },
  async deleteRender(roomId, rid) {
    let media = null;
    await this._patchRoom(roomId, (r) => {
      media = r.renders?.find((x) => x.id === rid)?.media;
      r.renders = (r.renders || []).filter((x) => x.id !== rid);
    });
    if (media) await releaseMedia([media]);
    return { ok: true };
  },

  // ----- IA (chargée à la demande) -----
  async status() { return (await import('./ai/ai.js')).aiStatus(); },
  async analyzeRoom(id) { return (await import('./ai/ai.js')).analyzeRoom(await this.room(id)); },
  async generateQuick(id) {
    return (await import('./ai/ai.js')).generateQuickRender(await this.room(id));
  },
  async generate(id, extraInstructions) {
    if (extraInstructions !== undefined) await this.updateRoom(id, { extraInstructions: String(extraInstructions) });
    return (await import('./ai/ai.js')).generateRender(await this.room(id));
  },
};

/** Enregistre des images sur l'appareil ; renvoie [{media, w, h}] */
export const uploadImages = storeImages;
