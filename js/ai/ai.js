// Orchestration de l'IA côté appareil : portage des routes /analyze et /generate de l'ancien serveur.
import { api, uid, now } from '../api.js';
import { getMediaBlob, blobToBase64, base64ToBlob, putMedia } from '../data/media.js';
import { buildPrompt, buildQuickPrompt, nearestRatio } from './prompt.js';
import { PROVIDERS, getProvider, providerConfig } from './providers/index.js';

async function active() {
  const settings = await api.settings();
  const provider = getProvider(settings.provider);
  return { settings, provider, cfg: providerConfig(settings, provider.id) };
}

export async function aiStatus() {
  const { provider, cfg } = await active();
  return { configured: provider.isConfigured(cfg), provider: provider.label, imageModel: provider.modelLabel(cfg) };
}

/** Image locale → {mimeType, data base64} pour l'envoi à l'IA */
async function readImage(mediaId) {
  const blob = await getMediaBlob(mediaId);
  if (!blob) return null;
  return { mimeType: blob.type || 'image/jpeg', data: await blobToBase64(blob) };
}

const notConfigured = () => Object.assign(new Error("Code d'accès ou clé API non renseigné : ouvrez les Réglages pour l'ajouter."), { code: 'NO_KEY' });

// ---------- Détection des meubles présents sur les photos ----------
export async function analyzeRoom(room) {
  const { settings, provider, cfg } = await active();
  // fournisseur actif s'il sait analyser, sinon le premier fournisseur configuré qui sait le faire
  let p = provider, c = cfg;
  if (!p.analyzeJSON || !p.isConfigured(c)) {
    p = PROVIDERS.find((x) => x.analyzeJSON && x.isConfigured(providerConfig(settings, x.id)));
    c = p && providerConfig(settings, p.id);
  }
  if (!p) throw notConfigured();

  const photos = (await Promise.all((room.photos || []).slice(0, 4).map((ph) => readImage(ph.media)))).filter(Boolean);
  if (!photos.length) throw new Error('Ajoutez au moins une photo de la pièce');
  const { length, width, height } = room.dims;
  const prompt = `These photos show the same room. The room is ${length} cm long (x axis, left to right on a top-down plan) and ${width} cm wide (y axis, top to bottom), ceiling ${height} cm.
Photo 1 is the main view. Estimate a top-down floor plan.
Return JSON only: {"camera":{"x":cm,"y":cm,"angle":degrees},"items":[{"name":"French name e.g. Canapé 3 places","length":cm,"width":cm,"height":cm,"x":cm,"y":cm,"rot":degrees}]}
Rules: x,y are the CENTER of each item, within 0..${length} and 0..${width}. "angle" for the camera: 0 = looking towards +x, 90 = towards +y (clockwise). "rot" for items: 0 = front of the item faces +y, 90 = faces -x, 180 = faces -y, 270 = faces +x. Include only movable furniture (sofas, tables, chairs, beds, cabinets, rugs), max 12 items. The camera of photo 1 is usually near a wall.`;

  // la vue principale en premier
  const ref = room.refPhoto || 0;
  if (ref > 0 && ref < photos.length) photos.unshift(photos.splice(ref, 1)[0]);

  const out = await p.analyzeJSON(prompt, photos, c);
  const clamp = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  const items = (out.items || []).slice(0, 12).map((i) => ({
    id: uid('e'), kind: 'existing', name: String(i.name || 'Meuble'),
    w: Math.max(20, Number(i.length) || 80), d: Math.max(20, Number(i.width) || 60), h: Number(i.height) || 80,
    x: clamp(i.x, length), y: clamp(i.y, width), rot: Number(i.rot) || 0,
  }));
  const camera = out.camera ? { x: clamp(out.camera.x, length), y: clamp(out.camera.y, width), angle: Number(out.camera.angle) || 0 } : null;
  return { items, camera };
}

// ---------- Génération de l'image finale ----------
export async function generateRender(room) {
  const { provider, cfg } = await active();
  if (!provider.isConfigured(cfg)) throw notConfigured();

  const ref = room.photos[room.refPhoto || 0] || room.photos[0];
  const refImg = await readImage(ref?.media);
  if (!refImg) throw new Error('Photo de référence de la pièce introuvable');

  const images = [refImg];
  const refIdx = 1;
  const ctxIdx = [];
  for (const p of room.photos.filter((x) => x !== ref).slice(0, 2)) {
    const im = await readImage(p.media);
    if (im) { images.push(im); ctxIdx.push(images.length); }
  }

  const newItems = (room.plan?.items || []).filter((i) => i.kind === 'new');
  const hasRemoval = (room.plan?.items || []).some((i) => i.kind === 'existing' && i.remove);
  if (!newItems.length && !hasRemoval && !room.extraInstructions?.trim()) throw new Error('Ajoutez au moins un meuble sur le plan');

  const enriched = [];
  for (const it of newItems) {
    const furniture = it.furnitureId ? await api.getFurniture(it.furnitureId).catch(() => null) : null;
    const f = furniture || { name: it.name, length: it.w, width: it.d, height: it.h };
    const imageIdx = [];
    const photos = f.photos || [];
    const ordered = [photos[f.cover || 0], ...photos.filter((_, i) => i !== (f.cover || 0))].filter(Boolean);
    for (const p of ordered.slice(0, 2)) {
      const im = await readImage(p.media);
      if (im && images.length < 12) { images.push(im); imageIdx.push(images.length); }
    }
    let textureIdx = null;
    if (it.textureImage && !it.keepOriginal) {
      const im = await readImage(it.textureImage);
      if (im && images.length < 14) { images.push(im); textureIdx = images.length; }
    }
    enriched.push({ ...it, furniture: f, imageIdx, textureIdx });
  }

  const prompt = buildPrompt({ room, items: enriched, refIdx, ctxIdx, extraInstructions: room.extraInstructions });
  const result = await provider.generateImage({ prompt, images, aspectRatio: nearestRatio(ref.w, ref.h) }, cfg);

  const img = result.images[0];
  const media = await putMedia(base64ToBlob(img.data, img.mimeType || 'image/png'));
  const render = {
    id: uid('g'), media, createdAt: now(), saved: false,
    prompt, modelText: result.text || '', provider: provider.id, model: provider.modelLabel(cfg),
    planSnapshot: structuredClone(room.plan),
  };
  await api.addRender(room.id, render);
  return render;
}

// ---------- Rendu rapide ----------

/** Copie de la photo avec la zone entourée en rouge (repère pour l'IA) */
async function markedImage(mediaId, zone, keep = []) {
  const blob = await getMediaBlob(mediaId);
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d');
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  const lw = Math.max(4, Math.round(Math.max(c.width, c.height) / 220));
  g.strokeStyle = '#ff0000';
  g.lineWidth = lw;
  g.strokeRect(zone.x * c.width, zone.y * c.height, zone.w * c.width, zone.h * c.height);
  // objets à garder devant le nouveau meuble : en bleu
  g.strokeStyle = '#0050ff';
  for (const k of keep) g.strokeRect(k.x * c.width, k.y * c.height, k.w * c.width, k.h * c.height);
  const out = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.9));
  return { mimeType: 'image/jpeg', data: await blobToBase64(out) };
}

export async function generateQuickRender(room) {
  const { provider, cfg } = await active();
  if (!provider.isConfigured(cfg)) throw notConfigured();
  const q = room.quick || {};
  const ref = room.photos?.[0];
  if (!ref) throw new Error('Ajoutez la photo de la pièce');
  if (!q.zone || q.zone.w < 0.01 || q.zone.h < 0.01) throw new Error('Tracez la zone où placer le meuble');
  const fPhotos = q.furniture?.photos || [];
  if (!fPhotos.length) throw new Error('Ajoutez la photo du meuble');

  const images = [await readImage(ref.media), await markedImage(ref.media, q.zone, q.keep || [])];
  if (!images[0]) throw new Error('Photo de la pièce introuvable');
  const idx = { base: 1, marked: 2, furniture: [], texture: null };
  for (const p of fPhotos.slice(0, 3)) {
    const im = await readImage(p.media);
    if (im) { images.push(im); idx.furniture.push(images.length); }
  }
  if (!idx.furniture.length) throw new Error('Photo du meuble introuvable');
  if (q.texture?.media) {
    const im = await readImage(q.texture.media);
    if (im) { images.push(im); idx.texture = images.length; }
  }

  const prompt = buildQuickPrompt(q, idx);
  const result = await provider.generateImage({ prompt, images, aspectRatio: nearestRatio(ref.w, ref.h) }, cfg);
  const img = result.images[0];
  const media = await putMedia(base64ToBlob(img.data, img.mimeType || 'image/png'));
  const render = {
    id: uid('g'), media, createdAt: now(), saved: false,
    prompt, modelText: result.text || '', provider: provider.id, model: provider.modelLabel(cfg),
    quickSnapshot: structuredClone(q),
  };
  await api.addRender(room.id, render);
  return render;
}
