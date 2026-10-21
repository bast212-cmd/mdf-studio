// Export / import de la bibliothèque (et sauvegarde complète) sous forme d'un fichier .zip :
//   studio.json        description (catégories, meubles, éventuellement projets)
//   media/<id>.jpg     photos des meubles, des pièces, rendus…
//
// Règle de fusion à l'import : chaque élément a un identifiant stable. S'il existe déjà
// sur l'appareil, la version la plus récente (updatedAt) est conservée.
// Cette même logique servira à la synchronisation Google Drive (étape 2).
import { idb, now } from './db.js';
import { getMediaBlob, putMedia, hasMedia, collectMediaIds } from './media.js';
import { createZip, readZip } from './zip.js';
import { api, slug } from '../api.js';

export const FORMAT = 'mdf-studio';
export const FORMAT_VERSION = 1;
const MANIFEST = 'studio.json';

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const today = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function buildZip(manifest, records, onProgress) {
  const ids = new Set();
  records.forEach((r) => collectMediaIds(r, ids));
  const files = [];
  const missing = [];
  for (const id of ids) {
    const blob = await getMediaBlob(id);
    if (!blob) { missing.push(id); continue; }
    files.push({ name: `media/${id}.${EXT[blob.type] || 'jpg'}`, data: blob });
  }
  manifest.mediaCount = files.length;
  files.unshift({ name: MANIFEST, data: JSON.stringify(manifest, null, 1) });
  const blob = await createZip(files, onProgress);
  return { blob, missing: missing.length };
}

/** Exporte la bibliothèque (toute ou une seule pièce) */
export async function exportLibrary({ categoryId = '', onProgress } = {}) {
  const allCats = await api.categories();
  const categories = categoryId ? allCats.filter((c) => c.id === categoryId) : allCats;
  const furniture = (await api.furniture()).filter((f) => !categoryId || f.category === categoryId);
  const title = categoryId ? `Bibliothèque ${categories[0]?.name || ''}`.trim() : 'Bibliothèque complète';
  const manifest = { format: FORMAT, kind: 'library', version: FORMAT_VERSION, exportedAt: now(), title, categories, furniture };
  const { blob, missing } = await buildZip(manifest, furniture, onProgress);
  const filename = `Bibliotheque-${categoryId ? safeName(categories[0]?.name || categoryId) + '-' : ''}${today()}.zip`;
  return { blob, filename, count: furniture.length, missing };
}

/** Sauvegarde complète : bibliothèque + projets et rendus (sans la clé API) */
export async function exportBackup({ onProgress } = {}) {
  const categories = await api.categories();
  const furniture = await api.furniture();
  const rooms = await api.rooms();
  const manifest = { format: FORMAT, kind: 'backup', version: FORMAT_VERSION, exportedAt: now(), title: 'Sauvegarde complète', categories, furniture, rooms };
  const { blob, missing } = await buildZip(manifest, [...furniture, ...rooms], onProgress);
  return { blob, filename: `Sauvegarde-Studio-IA-${today()}.zip`, count: furniture.length + rooms.length, missing };
}

/** Lit un fichier exporté ; renvoie un « paquet » prêt à être analysé puis importé */
export async function readBundle(file) {
  let entries;
  try { entries = await readZip(file); } catch (e) { throw new Error(`Fichier illisible : ${e.message}`); }
  const mf = entries.get(MANIFEST) || [...entries.values()].find((e) => e.name.endsWith('/' + MANIFEST));
  if (!mf) throw new Error("Ce fichier n'est pas un export du Studio d'aménagement (studio.json absent).");
  const manifest = JSON.parse(await mf.text());
  if (manifest.format !== FORMAT) throw new Error("Format de fichier inconnu.");
  if (manifest.version > FORMAT_VERSION) throw new Error("Ce fichier provient d'une version plus récente de l'application : mettez-la à jour.");
  const byId = new Map();
  for (const e of entries.values()) {
    const m = e.name.match(/(?:^|\/)media\/([^/]+)\.(\w+)$/);
    if (m) byId.set(m[1], { entry: e, type: MIME[m[2].toLowerCase()] || 'image/jpeg' });
  }
  return {
    manifest,
    async resolveMedia(id) {
      const x = byId.get(id);
      if (!x) return null;
      return new Blob([await x.entry.blob()], { type: x.type });
    },
  };
}

const newer = (a, b) => String(a?.updatedAt || '') > String(b?.updatedAt || '');

/** Prépare l'import : ce qui sera ajouté, mis à jour, ignoré */
export async function planImport(bundle) {
  const { manifest } = bundle;
  const local = {
    furniture: new Map((await idb.all('furniture')).map((x) => [x.id, x])),
    rooms: new Map((await idb.all('rooms')).map((x) => [x.id, x])),
  };
  const sections = {};
  for (const store of ['furniture', 'rooms']) {
    const list = Array.isArray(manifest[store]) ? manifest[store] : [];
    const s = { add: [], update: [], same: 0, keepLocal: 0 };
    for (const item of list) {
      if (!item?.id) continue;
      const mine = local[store].get(item.id);
      if (!mine) s.add.push(item);
      else if (newer(item, mine)) s.update.push(item);
      else if (newer(mine, item)) s.keepLocal++;
      else s.same++;
    }
    sections[store] = s;
  }
  // catégories : ajout des pièces et types manquants (par identifiant, puis par nom)
  const cats = structuredClone(await api.categories());
  const remap = {}; // id importé -> id local
  let newCats = 0, newTypes = 0;
  for (const c of manifest.categories || []) {
    if (!c?.name) continue;
    let mine = cats.find((x) => x.id === c.id) || cats.find((x) => x.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (!mine) { mine = { id: c.id || slug(c.name), name: c.name, types: [] }; cats.push(mine); newCats++; }
    if (c.id && c.id !== mine.id) remap[c.id] = mine.id;
    for (const t of c.types || []) if (!mine.types.some((x) => x.toLowerCase() === String(t).toLowerCase())) { mine.types.push(t); newTypes++; }
  }
  return { kind: manifest.kind, title: manifest.title, exportedAt: manifest.exportedAt, ...sections, categories: cats, remap, newCats, newTypes };
}

/** Applique l'import préparé par planImport */
export async function applyImport(bundle, plan, onProgress) {
  const remapCat = (o) => (o.category && plan.remap[o.category] ? { ...o, category: plan.remap[o.category] } : o);
  const toWrite = {
    furniture: [...plan.furniture.add, ...plan.furniture.update].map(remapCat),
    rooms: [...plan.rooms.add, ...plan.rooms.update].map(remapCat),
  };

  // 1. images manquantes
  const ids = new Set();
  [...toWrite.furniture, ...toWrite.rooms].forEach((r) => collectMediaIds(r, ids));
  let i = 0, missing = 0;
  for (const id of ids) {
    if (!(await hasMedia(id))) {
      const blob = await bundle.resolveMedia(id);
      if (blob) await putMedia(blob, id); else missing++;
    }
    onProgress?.(++i, ids.size);
  }

  // 2. images devenues inutiles dans les éléments mis à jour
  const obsolete = [];
  for (const store of ['furniture', 'rooms']) {
    for (const item of plan[store].update) {
      const old = await idb.get(store, item.id);
      if (!old) continue;
      const keep = collectMediaIds(item);
      collectMediaIds(old).forEach((m) => { if (!keep.has(m)) obsolete.push(m); });
    }
  }

  // 3. enregistrements
  if (plan.newCats || plan.newTypes) await api.saveCategories(plan.categories);
  if (toWrite.furniture.length) await idb.putMany('furniture', toWrite.furniture);
  if (toWrite.rooms.length) await idb.putMany('rooms', toWrite.rooms.map((r) => ({ renders: [], photos: [], ...r })));
  await api.releaseMedia(obsolete);
  api.notifyImport();
  return { furniture: toWrite.furniture.length, rooms: toWrite.rooms.length, missing };
}
