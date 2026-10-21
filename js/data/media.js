// Images stockées localement (IndexedDB) et affichage dans les pages.
// Une image est référencée par son identifiant de média (ex. "m3f9a…").
// Dans le HTML, on écrit <img ${src(id)}> : l'attribut data-media est résolu
// automatiquement en URL locale (blob:) dès que l'élément apparaît dans la page.
import { idb, uid, now } from './db.js';

const urls = new Map(); // id -> objectURL (cache de session)
const MAX_URLS = 400;

export async function putMedia(blob, id = uid('m')) {
  await idb.put('media', { id, blob, type: blob.type || 'image/jpeg', size: blob.size, createdAt: now() });
  return id;
}

export async function getMediaBlob(id) {
  if (!id) return null;
  const rec = await idb.get('media', id);
  return rec?.blob || null;
}

export async function hasMedia(id) {
  return Boolean(id && (await idb.get('media', id)));
}

export async function deleteMedia(ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return;
  list.forEach((id) => { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } });
  await idb.delMany('media', list);
}

/** URL affichable d'un média (asynchrone, mise en cache) */
export async function mediaURL(id) {
  if (!id) return '';
  if (urls.has(id)) return urls.get(id);
  const blob = await getMediaBlob(id);
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  if (urls.size > MAX_URLS) {
    // on libère les plus anciennes URL (elles seront recréées à la demande)
    const [oldId, oldUrl] = urls.entries().next().value;
    if (!document.querySelector(`img[data-media="${CSS.escape(oldId)}"]`)) { URL.revokeObjectURL(oldUrl); urls.delete(oldId); }
  }
  return u;
}

/** Attributs HTML d'une image locale : <img ${src(id)} alt=""> */
export function src(id) {
  if (!id) return '';
  const u = urls.get(id);
  return `data-media="${String(id).replace(/"/g, '')}"${u ? ` src="${u}"` : ''}`;
}

/** Résout les <img data-media> sans src présents dans root */
export function hydrate(root = document) {
  const imgs = root.matches?.('img[data-media]') ? [root] : [...(root.querySelectorAll?.('img[data-media]') || [])];
  imgs.forEach(async (img) => {
    if (img.getAttribute('src')) return;
    const u = await mediaURL(img.dataset.media);
    if (u) img.src = u;
    else img.classList.add('img-missing');
  });
}

let observing = false;
export function startMediaObserver() {
  if (observing) return;
  observing = true;
  hydrate(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) hydrate(n);
  }).observe(document.body, { childList: true, subtree: true });
}

// ---------- Conversion d'images ----------

/** Redimensionne une image (max 1600 px, JPEG) */
export async function resizeImage(file, max = 1600, quality = 0.88) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  let source = bmp;
  let tmpUrl = null;
  if (!source) {
    source = await new Promise((ok, ko) => {
      const im = new Image();
      im.onload = () => ok(im);
      im.onerror = () => ko(new Error("Image illisible (format non pris en charge ?)"));
      im.src = tmpUrl = URL.createObjectURL(file);
    });
  }
  const w0 = source.width, h0 = source.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(source, 0, 0, w, h);
  bmp?.close?.();
  if (tmpUrl) URL.revokeObjectURL(tmpUrl);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', quality));
  if (!blob) throw new Error("Impossible de convertir l'image");
  return { blob, w, h };
}

/** Enregistre des fichiers image localement ; renvoie [{media, w, h}] */
export async function storeImages(files) {
  const list = [...files].filter((f) => f && (f.type?.startsWith('image/') || (f instanceof Blob && !f.type)));
  const out = [];
  for (const f of list) { // séquentiel : ménage la mémoire de l'iPad
    const r = await resizeImage(f);
    out.push({ media: await putMedia(r.blob), w: r.w, h: r.h });
  }
  return out;
}

export function blobToBase64(blob) {
  return new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result).split(',')[1] || '');
    fr.onerror = () => ko(fr.error);
    fr.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64, type = 'image/png') {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Tous les identifiants de médias référencés par un objet (pièce, meuble…) */
export function collectMediaIds(obj, acc = new Set()) {
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    for (const [k, v] of Object.entries(n)) {
      if ((k === 'media' || k === 'textureImage') && typeof v === 'string') acc.add(v);
      else if (v && typeof v === 'object') walk(v);
    }
  })(obj);
  return acc;
}

/** Supprime les images qui ne sont plus utilisées nulle part (créées il y a plus d'une heure) */
export async function collectGarbage(rooms, furniture) {
  const used = new Set();
  rooms.forEach((r) => collectMediaIds(r, used));
  furniture.forEach((f) => collectMediaIds(f, used));
  const all = await idb.all('media');
  const limit = Date.now() - 3600_000;
  const orphans = all.filter((m) => !used.has(m.id) && Date.parse(m.createdAt || 0) < limit).map((m) => m.id);
  await deleteMedia(orphans);
  return orphans.length;
}

export function canShareFiles() {
  try { return Boolean(navigator.canShare?.({ files: [new File([''], 'x.zip', { type: 'application/zip' })] })); } catch { return false; }
}

export function downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60_000);
}

/**
 * Partage un fichier (feuille de partage iPad : AirDrop, Mail, Fichiers, Photos…) ou le télécharge.
 * mode 'auto' : partage sur tablette / téléphone, téléchargement sur ordinateur.
 * À appeler directement depuis un clic (Safari exige un geste récent de l'utilisateur pour partager).
 */
export async function shareOrDownload(blob, filename, title = '', mode = 'auto') {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (mode === 'share' || (mode === 'auto' && touch)) {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title || filename });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
        // sinon (geste expiré…) : repli sur le téléchargement
      }
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}
