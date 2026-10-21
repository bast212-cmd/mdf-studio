// Éditeur de plan 2D (vue de dessus, unités en cm)
// x = longueur de la pièce (gauche → droite), y = largeur (haut → bas)
// Meuble : centre (x, y), w = longueur, d = profondeur, rot en degrés (sens horaire), face avant = côté +y local
import { esc } from './ui.js';

const PAD = 70;
const FOV = 70;
const SNAP = 5;
const rad = (d) => (d * Math.PI) / 180;
const snap = (v, s = SNAP) => Math.round(v / s) * s;

export function defaultPlan(dims) {
  return { camera: { x: Math.round(dims.length / 2), y: Math.max(0, dims.width - 20), angle: -90 }, items: [] };
}

/** Garde les éléments dans la pièce (après changement des dimensions) */
export function clampPlan(plan, dims) {
  const L = dims.length, W = dims.width;
  plan.camera.x = Math.min(Math.max(plan.camera.x, 0), L);
  plan.camera.y = Math.min(Math.max(plan.camera.y, 0), W);
  plan.items.forEach((it) => clampItem(it, L, W));
  return plan;
}

function halfExtents(it) {
  const r = rad(it.rot || 0);
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return { hx: (it.w / 2) * c + (it.d / 2) * s, hy: (it.w / 2) * s + (it.d / 2) * c };
}
export function clampItem(it, L, W) {
  const { hx, hy } = halfExtents(it);
  it.x = hx * 2 >= L ? L / 2 : Math.min(Math.max(it.x, hx), L - hx);
  it.y = hy * 2 >= W ? W / 2 : Math.min(Math.max(it.y, hy), W - hy);
}

export class PlanEditor {
  /**
   * @param {HTMLElement} host
   * @param {{room:object, mode:'existing'|'new', onSelect?:Function, onChange?:Function}} opts
   */
  constructor(host, opts) {
    this.host = host;
    this.room = opts.room;
    this.mode = opts.mode;
    this.onSelect = opts.onSelect || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.selected = null;
    this.drag = null;
    this.host.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (this._mv = (e) => this.move(e)));
    window.addEventListener('pointerup', (this._up = (e) => this.up(e)));
    this.render();
  }
  destroy() {
    window.removeEventListener('pointermove', this._mv);
    window.removeEventListener('pointerup', this._up);
  }
  get plan() { return this.room.plan; }
  get L() { return Number(this.room.dims.length) || 400; }
  get W() { return Number(this.room.dims.width) || 300; }
  editable(it) { return it.kind === this.mode; }

  select(id, silent) {
    this.selected = id;
    this.render();
    if (!silent) this.onSelect(id ? this.plan.items.find((i) => i.id === id) : null);
  }

  // ---------- rendu ----------
  render() {
    const { L, W } = this;
    const fs = Math.max(L, W) / 45;
    const vb = `${-PAD} ${-PAD} ${L + PAD * 2} ${W + PAD * 2}`;
    const grid = [];
    for (let x = 50; x < L; x += 50) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${W}"/>`);
    for (let y = 50; y < W; y += 50) grid.push(`<line x1="0" y1="${y}" x2="${L}" y2="${y}"/>`);

    // éléments existants d'abord, nouveaux par-dessus ; le sélectionné en dernier
    const items = [...this.plan.items].sort((a, b) =>
      (a.id === this.selected) - (b.id === this.selected) || (a.kind === 'new') - (b.kind === 'new'));
    const replacedIds = new Set(this.plan.items.filter((i) => i.kind === 'new' && i.replacesId).map((i) => i.replacesId));

    this.host.innerHTML = `
      <svg class="plan-svg" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" style="font-size:${fs}px">
        <defs>
          <pattern id="hatch" width="12" height="12" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="12" height="12" fill="#f7e6e4"/><line x1="0" y1="0" x2="0" y2="12" stroke="#d9a39e" stroke-width="4"/>
          </pattern>
        </defs>
        <rect class="room" x="0" y="0" width="${L}" height="${W}"/>
        <g class="grid">${grid.join('')}</g>
        ${this.dimLines(fs)}
        ${items.map((it) => this.itemSVG(it, replacedIds.has(it.id), fs)).join('')}
        ${this.cameraSVG()}
      </svg>`;
    this.svg = this.host.querySelector('svg');
  }

  dimLines(fs) {
    const { L, W } = this;
    const o = PAD * 0.45;
    return `
      <line class="dimline" x1="0" y1="${-o}" x2="${L}" y2="${-o}"/>
      <line class="dimline" x1="0" y1="${-o - 8}" x2="0" y2="${-o + 8}"/><line class="dimline" x1="${L}" y1="${-o - 8}" x2="${L}" y2="${-o + 8}"/>
      <text class="dim" x="${L / 2}" y="${-o - 8}" text-anchor="middle" style="font-size:${fs * 0.95}px">${Math.round(L)} cm</text>
      <line class="dimline" x1="${-o}" y1="0" x2="${-o}" y2="${W}"/>
      <line class="dimline" x1="${-o - 8}" y1="0" x2="${-o + 8}" y2="0"/><line class="dimline" x1="${-o - 8}" y1="${W}" x2="${-o + 8}" y2="${W}"/>
      <text class="dim" x="${-o - 10}" y="${W / 2}" text-anchor="middle" transform="rotate(-90 ${-o - 10} ${W / 2})" style="font-size:${fs * 0.95}px">${Math.round(W)} cm</text>
      <text class="dim" x="${L}" y="${W + PAD * 0.7}" text-anchor="end" style="font-size:${fs * 0.8}px">Hauteur sous plafond : ${Math.round(this.room.dims.height || 0)} cm</text>`;
  }

  itemSVG(it, isReplaced, fs) {
    const sel = it.id === this.selected;
    const removed = it.kind === 'existing' && (isReplaced || it.remove);
    const locked = !this.editable(it);
    const cls = ['item', it.kind, removed ? 'removed' : '', sel ? 'sel' : ''].join(' ');
    const handle = sel && !locked
      ? `<line x1="0" y1="${-it.d / 2}" x2="0" y2="${-it.d / 2 - 28}" stroke="#e08a00" stroke-width="2"/>
         <circle class="rot-handle" data-rot="${it.id}" cx="0" cy="${-it.d / 2 - 34}" r="${Math.max(9, fs * 0.55)}" fill="#fff" stroke="#e08a00" stroke-width="3" style="cursor:crosshair"/>`
      : '';
    const label = it.kind === 'new' ? it.name : it.name + (removed ? (isReplaced ? ' (remplacé)' : ' (retiré)') : '');
    const showLabel = !(isReplaced && this.mode === 'new'); // évite la superposition avec le meuble qui le remplace
    return `
      <g class="${cls}" data-id="${it.id}" style="${locked ? 'opacity:.55' : ''}">
        <g transform="translate(${it.x} ${it.y}) rotate(${it.rot || 0})">
          <rect class="body" x="${-it.w / 2}" y="${-it.d / 2}" width="${it.w}" height="${it.d}" rx="3"/>
          <line class="front" x1="${-it.w / 2 + 4}" y1="${it.d / 2}" x2="${it.w / 2 - 4}" y2="${it.d / 2}"/>
          ${handle}
        </g>
        ${showLabel ? `<text class="label" x="${it.x}" y="${it.y}" text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>
        <text class="label sub" x="${it.x}" y="${it.y + fs * 1.1}" text-anchor="middle" dominant-baseline="middle" style="font-size:${fs * 0.75}px">${Math.round(it.w)}×${Math.round(it.d)}</text>` : ''}
      </g>`;
  }

  cameraSVG() {
    const c = this.plan.camera;
    const R = Math.min(this.L, this.W) * 0.55;
    const a = rad(c.angle);
    const a1 = rad(c.angle - FOV / 2), a2 = rad(c.angle + FOV / 2);
    const p = (ang, r) => `${c.x + Math.cos(ang) * r},${c.y + Math.sin(ang) * r}`;
    const hx = c.x + Math.cos(a) * R * 0.62, hy = c.y + Math.sin(a) * R * 0.62;
    const s = Math.max(this.L, this.W) / 38;
    return `
      <g class="cam">
        <path class="cone" d="M${c.x},${c.y} L${p(a1, R)} A${R},${R} 0 0 1 ${p(a2, R)} Z" pointer-events="none"/>
        <line x1="${c.x}" y1="${c.y}" x2="${hx}" y2="${hy}" stroke="#e08a00" stroke-width="2" stroke-dasharray="4 4" pointer-events="none"/>
        <g data-cam="body" transform="translate(${c.x} ${c.y}) rotate(${c.angle})">
          <rect class="body" x="${-s}" y="${-s * 0.7}" width="${s * 1.6}" height="${s * 1.4}" rx="${s * 0.25}"/>
          <polygon class="body" points="${s * 0.6},${-s * 0.45} ${s * 1.25},${-s * 0.8} ${s * 1.25},${s * 0.8} ${s * 0.6},${s * 0.45}"/>
        </g>
        <circle class="handle" data-cam="handle" cx="${hx}" cy="${hy}" r="${s * 0.55}"/>
      </g>`;
  }

  // ---------- interactions ----------
  pt(e) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(this.svg.getScreenCTM().inverse());
  }
  down(e) {
    if (!this.svg) return;
    const t = e.target;
    const P = this.pt(e);
    const rot = t.closest('[data-rot]');
    const cam = t.closest('[data-cam]');
    const g = t.closest('[data-id]');
    if (rot) {
      this.drag = { type: 'rot', id: rot.dataset.rot };
    } else if (cam) {
      this.drag = { type: cam.dataset.cam === 'handle' ? 'camrot' : 'cam', ox: P.x - this.plan.camera.x, oy: P.y - this.plan.camera.y };
    } else if (g) {
      const it = this.plan.items.find((i) => i.id === g.dataset.id);
      if (this.selected !== it.id) this.select(it.id);
      if (!this.editable(it)) return;
      this.drag = { type: 'item', id: it.id, ox: P.x - it.x, oy: P.y - it.y };
    } else {
      if (this.selected) this.select(null);
      return;
    }
    this.drag.moved = false;
    e.preventDefault();
  }
  move(e) {
    if (!this.drag) return;
    const P = this.pt(e);
    const d = this.drag;
    d.moved = true;
    if (d.type === 'item') {
      const it = this.plan.items.find((i) => i.id === d.id);
      it.x = snap(P.x - d.ox); it.y = snap(P.y - d.oy);
      clampItem(it, this.L, this.W);
    } else if (d.type === 'rot') {
      const it = this.plan.items.find((i) => i.id === d.id);
      const ang = (Math.atan2(P.y - it.y, P.x - it.x) * 180) / Math.PI + 90;
      it.rot = ((e.shiftKey ? Math.round(ang) : snap(ang, 15)) + 360) % 360;
      clampItem(it, this.L, this.W);
    } else if (d.type === 'cam') {
      const c = this.plan.camera;
      c.x = Math.min(Math.max(snap(P.x - d.ox), 0), this.L);
      c.y = Math.min(Math.max(snap(P.y - d.oy), 0), this.W);
    } else if (d.type === 'camrot') {
      const c = this.plan.camera;
      const ang = (Math.atan2(P.y - c.y, P.x - c.x) * 180) / Math.PI;
      c.angle = e.shiftKey ? Math.round(ang) : snap(ang, 5);
    }
    this.render();
  }
  up() {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.onChange();
  }

  // ---------- actions ----------
  rotateSelected(delta) {
    const it = this.plan.items.find((i) => i.id === this.selected);
    if (!it || !this.editable(it)) return;
    it.rot = (((it.rot || 0) + delta) % 360 + 360) % 360;
    clampItem(it, this.L, this.W);
    this.render();
    this.onChange();
  }
}
