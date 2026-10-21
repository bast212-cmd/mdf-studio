// Reprise des données de l'ancienne version (serveur Node.js) :
// on sélectionne le dossier « data » (db.json + uploads/ + renders/) sur l'ordinateur.
// Les données sont converties puis fusionnées comme un import classique.
import { FORMAT, FORMAT_VERSION } from './bundle.js';

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** @param {FileList|File[]} files fichiers du dossier choisi (input webkitdirectory) */
export async function readLegacyFolder(files) {
  const list = [...files];
  const dbFile = list.find((f) => /(^|\/)db\.json$/.test(f.webkitRelativePath || f.name));
  if (!dbFile) throw new Error("Fichier db.json introuvable : choisissez le dossier « data » de l'ancienne version.");
  const db = JSON.parse(await dbFile.text());

  // "/uploads/abc.jpg" -> fichier
  const byUrl = new Map();
  for (const f of list) {
    const m = (f.webkitRelativePath || f.name).match(/(?:^|\/)(uploads|renders)\/([\w.-]+)$/);
    if (m) byUrl.set(`/${m[1]}/${m[2]}`, f);
  }
  const idFor = (url) => 'old-' + url.replace(/^\/(uploads|renders)\//, '$1-').replace(/\.\w+$/, '').replace(/[^\w-]/g, '');
  const mediaFiles = new Map(); // id -> File

  // Remplace les champs {url:"/uploads/…"} par {media:id} et textureImage:"/uploads/…" par l'id
  const convert = (n) => {
    if (Array.isArray(n)) return n.map(convert);
    if (!n || typeof n !== 'object') return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if ((k === 'url' || k === 'textureImage') && typeof v === 'string' && /^\/(uploads|renders)\//.test(v)) {
        const id = idFor(v);
        if (byUrl.has(v)) mediaFiles.set(id, byUrl.get(v));
        out[k === 'url' ? 'media' : 'textureImage'] = id;
      } else out[k] = convert(v);
    }
    return out;
  };

  const manifest = {
    format: FORMAT, kind: 'backup', version: FORMAT_VERSION, title: "Données de l'ancienne version",
    categories: db.categories || [],
    furniture: convert(db.furniture || []),
    rooms: convert(db.rooms || []),
  };
  return {
    manifest,
    async resolveMedia(id) {
      const f = mediaFiles.get(id);
      if (!f) return null;
      const ext = f.name.split('.').pop().toLowerCase();
      return new Blob([f], { type: f.type || MIME[ext] || 'image/jpeg' });
    },
  };
}
