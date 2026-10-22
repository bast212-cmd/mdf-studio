// Dimensions multiples et meubles modulables (logique du site Mobilier de France).
//
// Un meuble peut avoir plusieurs « éléments » (furniture.sizes), chacun avec ses cotes et
// éventuellement son schéma vu de dessus (picto) :
//   { id, label, length, width, height, picto (média), presented (bool), origin: 'catalogue'|'custom' }
// - Meuble simple (fauteuil, table…) : on choisit UNE dimension sur le plan (item.sizeId).
// - Meuble modulable (canapés, rangements) : on assemble des éléments (item.modules),
//   en partant de la composition présentée par Mobilier de France (éléments « presented »).
//   item.modules = [{ uid, sizeId, ret }]  (ret = true : élément placé « en retour », tourné de 90°)

const MODULAR_TYPES = /canap|biblioth|meuble tv|buffet|bahut|vaisselier|vitrine|rangement|étagère|etagere|dressing/i;

export const isModularType = (type) => MODULAR_TYPES.test(type || '');
export const isModular = (f) => Boolean(f) && (f.modular ?? isModularType(f.type));

const muid = () => Math.random().toString(36).slice(2, 9);

/** Liste des dimensions d'un meuble (la dimension principale si aucune n'est définie) */
export function sizesOf(f) {
  if (!f) return [];
  if (f.sizes?.length) return f.sizes;
  return [{ id: 'base', label: dimsLabel(f), length: f.length, width: f.width, height: f.height, presented: true, origin: 'base' }];
}

export const sizeById = (f, id) => sizesOf(f).find((s) => s.id === id) || null;

export function dimsLabel(s) {
  if (!s) return '';
  if (s.round) return `Ø ${Math.round(s.length || 0)}`;
  const p = [];
  if (s.length) p.push(`L. ${Math.round(s.length)}`);
  if (s.width) p.push(`P. ${Math.round(s.width)}`);
  if (s.height) p.push(`H. ${Math.round(s.height)}`);
  return p.join(' x ');
}

/** Dimension proposée par défaut pour un meuble simple */
export const defaultSize = (f) => sizesOf(f).find((s) => s.presented) || sizesOf(f)[0] || null;

/** Composition proposée par défaut pour un meuble modulable : les éléments « présentés » */
export function defaultModules(f) {
  const sizes = sizesOf(f);
  const pres = sizes.filter((s) => s.presented);
  return (pres.length ? pres : sizes.slice(0, 1)).map((s) => ({ uid: muid(), sizeId: s.id, ret: false }));
}

export const newModule = (sizeId, ret = false) => ({ uid: muid(), sizeId, ret });

/**
 * Place les éléments d'une composition (vue de dessus, cm, arrière en haut).
 * Les éléments « en retour » au début de la liste partent vers l'avant à gauche,
 * ceux de la fin partent vers l'avant à droite ; les autres sont alignés le long du mur.
 * @returns {{ w:number, d:number, parts: {uid,sizeId,size,x,y,w,d,rot}[] }}
 */
export function layoutModules(f, modules = []) {
  const list = modules.map((m) => ({ ...m, size: sizeById(f, m.sizeId) })).filter((m) => m.size);
  if (!list.length) return { w: 0, d: 0, parts: [] };
  const L = (s) => Number(s.length) || 60;
  const D = (s) => Number(s.width) || Number(f.width) || 60;
  let a = 0; while (a < list.length && list[a].ret) a++;
  let b = list.length; while (b > a && list[b - 1].ret) b--;
  const lead = list.slice(0, a), back = list.slice(a, b), tail = list.slice(b);
  const parts = [];
  // Rangée du fond
  let x = 0;
  back.forEach((m) => { parts.push({ ...m, side: 'back', x, y: 0, w: L(m.size), d: D(m.size), rot: 0 }); x += L(m.size); });
  const backW = x;
  const firstD = back.length ? D(back[0].size) : 0;
  const lastD = back.length ? D(back[back.length - 1].size) : 0;
  // Retour gauche : du coin vers l'avant (le dernier de la liste est contre le coin)
  let y = firstD;
  [...lead].reverse().forEach((m) => { parts.push({ ...m, side: 'left', x: 0, y, w: D(m.size), d: L(m.size), rot: 270 }); y += L(m.size); });
  // Retour droit
  y = lastD;
  tail.forEach((m) => { const w = D(m.size); parts.push({ ...m, side: 'right', x: Math.max(0, backW - w), y, w, d: L(m.size), rot: 90 }); y += L(m.size); });
  // Rangée vide (que des éléments en retour) : on les aligne simplement
  const minX = Math.min(...parts.map((p) => p.x));
  parts.forEach((p) => { p.x -= minX; });
  const w = Math.max(...parts.map((p) => p.x + p.w));
  const d = Math.max(...parts.map((p) => p.y + p.d));
  return { w, d, parts };
}

/** Met à jour l'emprise (w, d) d'un élément du plan selon sa dimension ou sa composition */
export function applyFootprint(item, f) {
  if (!f) return item;
  if (item.modules?.length) {
    const lay = layoutModules(f, item.modules);
    if (lay.w && lay.d) { item.w = lay.w; item.d = lay.d; }
  } else if (item.sizeId) {
    const s = sizeById(f, item.sizeId);
    if (s) { item.w = Number(s.length) || item.w; item.d = Number(s.width) || Number(f.width) || item.d; if (s.height) item.h = s.height; }
  }
  return item;
}

/** Description texte d'une composition (pour le prompt) */
export function describeModules(f, modules) {
  const lay = layoutModules(f, modules);
  const name = (p) => `${p.size.label || dimsLabel(p.size)} (${Math.round(p.size.length || 0)} x ${Math.round(p.size.width || f.width || 0)} cm)`;
  const by = (side) => lay.parts.filter((p) => p.side === side);
  const lines = [];
  if (by('back').length) lines.push(`along the back, from left to right: ${by('back').map(name).join(', ')}`);
  if (by('left').length) lines.push(`return on the LEFT side going towards the front (closest to the corner first): ${[...by('left')].map(name).join(', ')}`);
  if (by('right').length) lines.push(`return on the RIGHT side going towards the front (closest to the corner first): ${by('right').map(name).join(', ')}`);
  return { text: lines.join('; '), w: lay.w, d: lay.d, count: lay.parts.length };
}

/**
 * Schéma vu de dessus d'une composition ou d'une dimension, dessiné sur un canvas (PNG),
 * envoyé à l'IA pour qu'elle comprenne la forme voulue.
 * @param {Function} getImage  (mediaId) => Promise<ImageBitmap|null>  (schémas des éléments)
 */
export async function drawLayoutPNG(f, item, getImage) {
  const lay = item.modules?.length
    ? layoutModules(f, item.modules)
    : (() => { const s = sizeById(f, item.sizeId) || defaultSize(f); const w = Number(s?.length) || item.w, d = Number(s?.width) || item.d; return { w, d, parts: [{ size: s, x: 0, y: 0, w, d, rot: 0 }] }; })();
  if (!lay.w || !lay.d) return null;
  const pad = 70, k = Math.min(900 / lay.w, 700 / lay.d, 4);
  const c = document.createElement('canvas');
  c.width = Math.round(lay.w * k + pad * 2); c.height = Math.round(lay.d * k + pad * 2 + 30);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.font = '600 18px sans-serif'; g.fillStyle = '#333'; g.textAlign = 'center';
  g.fillText('BACK (against the wall)', c.width / 2, 30);
  g.fillText('FRONT (seat side)', c.width / 2, c.height - 12);
  for (const p of lay.parts) {
    const x = pad + p.x * k, y = pad + p.y * k, w = p.w * k, h = p.d * k;
    g.fillStyle = '#eef2f8'; g.fillRect(x, y, w, h);
    const bmp = p.size?.picto ? await getImage(p.size.picto) : null;
    if (bmp) {
      g.save(); g.translate(x + w / 2, y + h / 2); if (p.rot) g.rotate((p.rot * Math.PI) / 180);
      const bw = p.rot ? h : w, bh = p.rot ? w : h, s = Math.min(bw / bmp.width, bh / bmp.height);
      g.drawImage(bmp, -bmp.width * s / 2, -bmp.height * s / 2, bmp.width * s, bmp.height * s);
      g.restore();
    }
    g.strokeStyle = '#0a3d7c'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
    g.fillStyle = '#0a3d7c'; g.font = '600 15px sans-serif';
    g.fillText(`${Math.round(p.size?.length || 0)} x ${Math.round(p.size?.width || f.width || 0)}`, x + w / 2, y + h / 2 + 5);
  }
  g.fillStyle = '#333'; g.font = '16px sans-serif';
  g.fillText(`Overall ${Math.round(lay.w)} x ${Math.round(lay.d)} cm`, c.width / 2, 52);
  return new Promise((ok) => c.toBlob(ok, 'image/png'));
}
