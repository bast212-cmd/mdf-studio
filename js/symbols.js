// Schémas vus de dessus des meubles, dans l'esprit des pictogrammes du catalogue Mobilier de France :
// contour foncé, dossier et accoudoirs grisés, séparations de coussins, angles et méridiennes.
// Coordonnées locales en cm, centrées sur le meuble ; l'avant du meuble est vers +y (en bas).
// « left » / « right » : côté vu par une personne debout face au meuble (left = −x).

export const SHAPES = [
  ['sofa', 'Canapé droit'],
  ['sofa_corner', "Canapé d'angle"],
  ['sofa_chaise', 'Canapé avec méridienne'],
  ['armchair', 'Fauteuil'],
  ['coffee_table', 'Table basse'],
  ['round_table', 'Table ronde'],
  ['oval_table', 'Table ovale'],
  ['dining_table', 'Table de repas'],
  ['chair', 'Chaise'],
  ['bed', 'Lit'],
  ['nightstand', 'Chevet'],
  ['sideboard', 'Buffet / commode'],
  ['tv_unit', 'Meuble TV'],
  ['bookcase', 'Bibliothèque / vitrine'],
  ['wardrobe', 'Armoire'],
  ['console', 'Console'],
  ['desk', 'Bureau'],
  ['pouf', 'Pouf'],
  ['other', 'Autre'],
];
export const SIDED = new Set(['sofa_corner', 'sofa_chaise']);
const KNOWN = new Set(SHAPES.map(([k]) => k));
export const normShape = (s) => (KNOWN.has(s) ? s : 'other');

/** Devine la forme d'après le nom ou le type du meuble (meubles ajoutés à la main, bibliothèque) */
export function guessShape(text = '', { round = false } = {}) {
  const t = String(text).toLowerCase();
  if (/canap|sofa/.test(t)) {
    if (/angle|corner/.test(t)) return 'sofa_corner';
    if (/m[ée]ridienne|chaise longue/.test(t)) return 'sofa_chaise';
    return 'sofa';
  }
  if (/fauteuil|bergère|armchair/.test(t)) return 'armchair';
  if (/pouf/.test(t)) return 'pouf';
  if (/table basse|bout de canap|guéridon|gueridon/.test(t)) return round || /ronde|Ø/.test(t) ? 'round_table' : 'coffee_table';
  if (/ovale/.test(t)) return 'oval_table';
  if (/table|îlot|ilot/.test(t)) return round || /ronde|Ø/.test(t) ? 'round_table' : 'dining_table';
  if (/chaise|tabouret|banc/.test(t)) return 'chair';
  if (/chevet/.test(t)) return 'nightstand';
  if (/\blit\b|lit |ensemble de lit|bed/.test(t)) return 'bed';
  if (/meuble tv|tv/.test(t)) return 'tv_unit';
  if (/biblioth|vitrine|vaisselier|étag|etag|colonne/.test(t)) return 'bookcase';
  if (/armoire|dressing|penderie/.test(t)) return 'wardrobe';
  if (/buffet|bahut|commode|chiffonnier|pantalonni/.test(t)) return 'sideboard';
  if (/console|meuble d'entr|entrée/.test(t)) return 'console';
  if (/bureau|desk/.test(t)) return 'desk';
  return 'other';
}

const cl = (v, a, b) => Math.max(a, Math.min(b, v));
const r = (x, y, w, h, cls = 'sym', rx = 2) => `<rect class="${cls}" x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" rx="${rx}"/>`;
const ln = (x1, y1, x2, y2, cls = 'sym-line') => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const poly = (pts, cls = 'sym') => `<polygon class="${cls}" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;

/** Lignes de séparation des coussins sur une assise horizontale */
function cushions(x0, x1, y0, y1, n) {
  let s = '';
  for (let i = 1; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n; s += ln(x, y0, x, y1); }
  return s;
}

/**
 * @param {string} shape  une des clés de SHAPES
 * @param {number} w largeur (x), d profondeur (y)
 * @param {{side?:'left'|'right', seats?:number, mainDepth?:number}} o
 * @returns {string} éléments SVG
 */
export function symbolSVG(shape, w, d, o = {}) {
  const X0 = -w / 2, Y0 = -d / 2, X1 = w / 2, Y1 = d / 2;
  const right = o.side !== 'left';
  switch (normShape(shape)) {
    case 'sofa':
    case 'armchair': {
      const bd = cl(d * 0.22, 10, 25), aw = cl(w * 0.1, 8, 22);
      const n = shape === 'armchair' ? 1 : (o.seats || Math.max(1, Math.round((w - 2 * aw) / 62)));
      return r(X0, Y0, w, d, 'sym', 6) + r(X0 + aw, Y0, w - 2 * aw, bd, 'sym-soft', 3)
        + r(X0, Y0, aw, d, 'sym-soft', 5) + r(X1 - aw, Y0, aw, d, 'sym-soft', 5)
        + cushions(X0 + aw, X1 - aw, Y0 + bd, Y1 - 3, n);
    }
    case 'sofa_corner': {
      const md = cl(o.mainDepth || Math.min(d, w) * 0.45, 60, Math.min(d, w) - 10);
      const bd = cl(md * 0.22, 10, 24), aw = cl(md * 0.2, 8, 22);
      // L : rangée du fond + retour sur le côté choisi (vu de face)
      const rx = right ? X1 - md : X0; // x de départ du retour
      const outline = right
        ? [[X0, Y0], [X1, Y0], [X1, Y1], [X1 - md, Y1], [X1 - md, Y0 + md], [X0, Y0 + md]]
        : [[X0, Y0], [X1, Y0], [X1, Y0 + md], [X0 + md, Y0 + md], [X0 + md, Y1], [X0, Y1]];
      const backSide = right ? r(X1 - bd, Y0, bd, d, 'sym-soft', 3) : r(X0, Y0, bd, d, 'sym-soft', 3);
      const armEnd = right ? r(X0, Y0, aw, md, 'sym-soft', 5) : r(X1 - aw, Y0, aw, md, 'sym-soft', 5);
      const armRet = r(rx, Y1 - aw, md, aw, 'sym-soft', 5);
      const seatX0 = right ? X0 + aw : X0 + md, seatX1 = right ? X1 - md : X1 - aw;
      const nMain = Math.max(1, Math.round((seatX1 - seatX0) / 62));
      const retY0 = Y0 + md, retY1 = Y1 - aw, nRet = Math.max(1, Math.round((retY1 - retY0) / 62));
      let retLines = '';
      for (let i = 1; i < nRet; i++) { const y = retY0 + ((retY1 - retY0) * i) / nRet; retLines += right ? ln(X1 - md, y, X1 - bd, y) : ln(X0 + bd, y, X0 + md, y); }
      return poly(outline) + r(X0, Y0, w, bd, 'sym-soft', 3) + backSide + armEnd + armRet
        + cushions(seatX0, seatX1, Y0 + bd, Y0 + md - 3, nMain) + retLines
        + (right ? ln(X1 - md, Y0 + bd, X1 - md, Y0 + md) : ln(X0 + md, Y0 + bd, X0 + md, Y0 + md));
    }
    case 'sofa_chaise': {
      const md = cl(o.mainDepth || d * 0.58, 60, d - 20);
      const cw = cl(w * 0.3, 65, w * 0.5); // largeur de la méridienne
      const bd = cl(md * 0.22, 10, 24), aw = cl(w * 0.07, 8, 20);
      const outline = right
        ? [[X0, Y0], [X1, Y0], [X1, Y1], [X1 - cw, Y1], [X1 - cw, Y0 + md], [X0, Y0 + md]]
        : [[X0, Y0], [X1, Y0], [X1, Y0 + md], [X0 + cw, Y0 + md], [X0 + cw, Y1], [X0, Y1]];
      const armIn = right ? r(X0, Y0, aw, md, 'sym-soft', 5) : r(X1 - aw, Y0, aw, md, 'sym-soft', 5);
      const armOut = right ? r(X1 - aw, Y0, aw, d, 'sym-soft', 5) : r(X0, Y0, aw, d, 'sym-soft', 5);
      const seatX0 = right ? X0 + aw : X0 + cw, seatX1 = right ? X1 - cw : X1 - aw;
      const n = Math.max(1, Math.round((seatX1 - seatX0) / 62));
      const sep = right ? ln(X1 - cw, Y0 + bd, X1 - cw, Y0 + md) : ln(X0 + cw, Y0 + bd, X0 + cw, Y0 + md);
      return poly(outline) + r(X0, Y0, w, bd, 'sym-soft', 3) + armIn + armOut + cushions(seatX0, seatX1, Y0 + bd, Y0 + md - 3, n) + sep;
    }
    case 'coffee_table':
    case 'dining_table': {
      const i = cl(Math.min(w, d) * 0.08, 3, 8);
      return r(X0, Y0, w, d, 'sym', 3) + r(X0 + i, Y0 + i, w - 2 * i, d - 2 * i, 'sym-line', 2);
    }
    case 'round_table': {
      const R = Math.min(w, d) / 2;
      return `<circle class="sym" cx="0" cy="0" r="${R}"/><circle class="sym-line" cx="0" cy="0" r="${R * 0.82}"/>`;
    }
    case 'oval_table':
      return `<ellipse class="sym" cx="0" cy="0" rx="${w / 2}" ry="${d / 2}"/><ellipse class="sym-line" cx="0" cy="0" rx="${w / 2 * 0.85}" ry="${d / 2 * 0.8}"/>`;
    case 'chair': {
      const bd = cl(d * 0.2, 5, 12);
      return r(X0 + w * 0.05, Y0, w * 0.9, d, 'sym', 5) + r(X0 + w * 0.05, Y0, w * 0.9, bd, 'sym-soft', 3);
    }
    case 'pouf':
      return Math.abs(w - d) < 8
        ? `<circle class="sym" cx="0" cy="0" r="${Math.min(w, d) / 2}"/><circle class="sym-line" cx="0" cy="0" r="${Math.min(w, d) / 2 * 0.7}"/>`
        : r(X0, Y0, w, d, 'sym', 10) + r(X0 + 5, Y0 + 5, w - 10, d - 10, 'sym-line', 8);
    case 'bed': {
      // tête de lit en haut (contre le mur), pied vers l'avant
      const hb = cl(d * 0.05, 4, 10), pillowH = cl(d * 0.13, 18, 35);
      const two = w >= 120, pw = two ? (w - 30) / 2 : w - 24;
      const pillows = two
        ? r(X0 + 10, Y0 + hb + 6, pw, pillowH, 'sym-soft', 8) + r(X0 + 20 + pw, Y0 + hb + 6, pw, pillowH, 'sym-soft', 8)
        : r(X0 + 12, Y0 + hb + 6, pw, pillowH, 'sym-soft', 8);
      const fold = Y0 + hb + pillowH + 18;
      return r(X0, Y0, w, d, 'sym', 4) + r(X0, Y0, w, hb, 'sym-soft', 2) + pillows
        + ln(X0 + 3, fold, X1 - 3, fold) + `<path class="sym-line" d="M${X1 - 3} ${Y1 - d * 0.28} L${X1 - w * 0.28} ${Y1 - 3}"/>`;
    }
    case 'nightstand':
      return r(X0, Y0, w, d, 'sym', 2) + `<line class="sym-back" x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}"/>` + r(X0 + w * 0.3, Y1 - 4, w * 0.4, 2, 'sym-soft', 1);
    case 'sideboard':
    case 'tv_unit':
    case 'bookcase':
    case 'wardrobe':
    case 'console':
    case 'desk': {
      const n = shape === 'desk' || shape === 'console' ? 1 : Math.max(1, Math.round(w / (shape === 'wardrobe' ? 50 : 60)));
      let s = r(X0, Y0, w, d, 'sym', 2) + `<line class="sym-back" x1="${X0}" y1="${Y0}" x2="${X1}" y2="${Y0}"/>`;
      s += cushions(X0, X1, Y0 + 3, Y1, n);
      if (shape === 'bookcase') s += ln(X0 + 3, Y0 + d * 0.5, X1 - 3, Y0 + d * 0.5);
      if (shape === 'desk') s += r(X0 + w * 0.06, Y0 + d * 0.12, w * 0.88, d * 0.76, 'sym-line', 2);
      return s;
    }
    default:
      return r(X0, Y0, w, d, 'sym sym-other', 4);
  }
}
