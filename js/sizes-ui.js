// Interface des dimensions multiples et des compositions modulables
import { esc, modal, toast, num } from './ui.js';
import { src, storeImages } from './data/media.js';
import { sizesOf, dimsLabel, isModular, layoutModules, newModule, defaultModules } from './sizes.js';

const sid = () => 'c' + Math.random().toString(36).slice(2, 8);

/** Fenêtre de création / modification d'une dimension. Résout avec la dimension ou null. */
export function sizeDialog(size = {}, { title = 'Nouvelle dimension', modular = false } = {}) {
  const s = { ...size };
  return new Promise((resolve) => {
    let result = null;
    const m = modal({
      title,
      onClose: () => resolve(result),
      content: `
        <form id="szform" autocomplete="off">
          <div class="field"><label>Nom</label><input name="label" value="${esc(s.label || '')}" placeholder="${modular ? 'Ex. Chauffeuse 90, Angle, Méridienne gauche' : 'Ex. 3 places, L. 312'}"></div>
          <div class="grid-3">
            <div class="field"><label>Largeur</label><div class="unit" data-unit="cm"><input name="length" type="number" min="1" required value="${s.length ?? ''}"></div></div>
            <div class="field"><label>Profondeur</label><div class="unit" data-unit="cm"><input name="width" type="number" min="1" value="${s.width ?? ''}"></div></div>
            <div class="field"><label>Hauteur</label><div class="unit" data-unit="cm"><input name="height" type="number" min="1" value="${s.height ?? ''}"></div></div>
          </div>
          <label class="check"><input type="checkbox" name="round" ${s.round ? 'checked' : ''}> Rond (largeur = diamètre)</label>
          <div class="field" style="margin-top:12px"><label>Schéma vu de dessus (photo, facultatif)</label>
            <div style="display:flex;gap:10px;align-items:center">
              <span id="szpic">${s.picto ? `<img ${src(s.picto)} alt="" style="height:56px;width:auto;border:1px solid var(--line)">` : '<span class="muted small">Aucun</span>'}</span>
              <input type="file" accept="image/*" id="szfile">
            </div>
          </div>
        </form>`,
      footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn" data-ok>Enregistrer</button>`,
    });
    m.el.querySelector('#szfile').addEventListener('change', async (e) => {
      if (!e.target.files.length) return;
      try {
        const [p] = await storeImages([e.target.files[0]]);
        s.picto = p.media;
        m.el.querySelector('#szpic').innerHTML = `<img ${src(p.media)} alt="" style="height:56px;width:auto;border:1px solid var(--line)">`;
      } catch (err) { toast(err.message, 'err'); }
    });
    m.el.querySelector('[data-ok]').onclick = () => {
      const form = m.el.querySelector('#szform');
      if (!form.reportValidity()) return;
      const round = form.round.checked;
      const length = num(form.length.value);
      result = {
        ...s, id: s.id || sid(), origin: s.origin || 'custom',
        length, width: round ? length : num(form.width.value), height: num(form.height.value),
        round: round || undefined,
      };
      result.label = form.label.value.trim() || dimsLabel(result);
      m.close();
    };
  });
}

/** Petite vignette d'une dimension (schéma ou rectangle) */
export function sizeThumb(s, extra = '') {
  return `<span class="size-thumb ${extra}">${s.picto ? `<img ${src(s.picto)} alt="">` : `<i class="${s.round ? 'round' : ''}"></i>`}</span>`;
}

// ---------------------------------------------------------------------
// Éditeur des dimensions dans la fiche meuble (bibliothèque)
// ---------------------------------------------------------------------
export function sizesEditorHTML() {
  return `<div class="field"><label>Dimensions et éléments</label>
    <p class="hint">Toutes les dimensions proposées pour ce meuble. Pour un meuble modulable, ce sont ses éléments ; ceux cochés « présenté » forment la composition proposée par défaut.</p>
    <div id="szlist" class="sizes"></div>
    <button type="button" class="btn btn--light btn--sm" data-szadd>+ Ajouter une dimension</button>
  </div>`;
}

/** @param el conteneur ; @param f meuble en cours d'édition (f.sizes est modifié) ; @param modular () => bool */
export function bindSizesEditor(el, f, modular) {
  const list = el.querySelector('#szlist');
  const draw = () => {
    const sizes = f.sizes || [];
    list.innerHTML = sizes.length ? sizes.map((s, i) => `
      <div class="size-row" data-i="${i}">
        ${sizeThumb(s)}
        <div class="size-row__txt"><strong>${esc(s.label || dimsLabel(s))}</strong><span class="muted small">${esc(dimsLabel(s))}</span></div>
        ${modular() ? `<label class="check small"><input type="checkbox" data-pres ${s.presented ? 'checked' : ''}> présenté</label>` : `<label class="check small"><input type="radio" name="szdef" data-def ${s.presented ? 'checked' : ''}> par défaut</label>`}
        <button type="button" class="icon-btn" data-szedit title="Modifier">✎</button>
        <button type="button" class="icon-btn" data-szdel title="Supprimer">✕</button>
      </div>`).join('') : '<p class="muted small">Une seule dimension : celle indiquée ci-dessus.</p>';
  };
  draw();
  el.querySelector('[data-szadd]').onclick = async () => {
    if (!f.sizes?.length && (f.length || f.width)) {
      // la dimension principale devient la première de la liste
      f.sizes = sizesOf(f).map((s) => ({ ...s, id: 'base', origin: 'custom', presented: true }));
    }
    const s = await sizeDialog({ height: f.height, width: f.width }, { modular: modular() });
    if (s) { (f.sizes ||= []).push(s); draw(); }
  };
  list.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (e.target.closest('[data-szdel]')) { f.sizes.splice(i, 1); draw(); }
    else if (e.target.closest('[data-szedit]')) {
      const s = await sizeDialog(f.sizes[i], { title: 'Modifier la dimension', modular: modular() });
      if (s) { f.sizes[i] = s; draw(); }
    }
  });
  list.addEventListener('change', (e) => {
    const row = e.target.closest('[data-i]');
    if (!row) return;
    const i = Number(row.dataset.i);
    if (e.target.matches('[data-pres]')) f.sizes[i].presented = e.target.checked;
    if (e.target.matches('[data-def]')) f.sizes.forEach((s, j) => { s.presented = j === i; });
  });
  return { redraw: draw };
}

// ---------------------------------------------------------------------
// Panneau de l'étape Aménagement : choix de la dimension ou composition
// ---------------------------------------------------------------------
export function placementPanelHTML(it, f) {
  if (!f) return '';
  const sizes = sizesOf(f);
  if (isModular(f)) {
    const lay = layoutModules(f, it.modules || []);
    const byUid = new Map(lay.parts.map((p) => [p.uid, p]));
    return `
      <div class="field"><label>Composition <span class="muted">· ${Math.round(lay.w)} x ${Math.round(lay.d)} cm</span></label>
        <ol class="modules">${(it.modules || []).map((m, i) => {
          const s = sizes.find((x) => x.id === m.sizeId);
          const p = byUid.get(m.uid);
          return `<li data-mi="${i}">${s ? sizeThumb(s, m.ret ? 'rot' : '') : ''}
            <span class="modules__txt"><strong>${esc(s?.label || '?')}</strong><span class="muted small">${p?.side === 'left' ? 'retour gauche' : p?.side === 'right' ? 'retour droit' : 'le long du mur'}</span></span>
            <span class="modules__btns">
              <button type="button" class="icon-btn" data-mup title="Déplacer vers la gauche" ${i === 0 ? 'disabled' : ''}>◀</button>
              <button type="button" class="icon-btn" data-mdown title="Déplacer vers la droite" ${i === it.modules.length - 1 ? 'disabled' : ''}>▶</button>
              <button type="button" class="icon-btn ${m.ret ? 'on' : ''}" data-mret title="Placer en retour (tourné de 90°), au début ou à la fin de la composition">⟲</button>
              <button type="button" class="icon-btn" data-mdel title="Retirer">✕</button>
            </span></li>`;
        }).join('')}</ol>
        <div class="btn-row" style="gap:6px">
          <select class="input" id="maddsel" style="flex:1;min-width:0">${sizes.map((s) => `<option value="${esc(s.id)}">${esc(s.label || dimsLabel(s))}</option>`).join('')}</select>
          <button type="button" class="btn btn--ghost btn--sm" data-madd>+ Ajouter</button>
        </div>
        <div class="btn-row" style="gap:6px;margin-top:8px">
          <button type="button" class="btn btn--light btn--sm" data-mnew>+ Nouvel élément</button>
          <button type="button" class="btn btn--light btn--sm" data-mreset>Composition présentée</button>
        </div>
        <p class="hint">⟲ place un élément « en retour » (angle, méridienne) : en début de liste il part vers l'avant à gauche, en fin de liste à droite.</p>
      </div>`;
  }
  if (sizes.length < 2 && !f.sizes?.length) {
    return `<div class="field"><button type="button" class="btn btn--light btn--sm" data-snew>+ Autre dimension</button></div>`;
  }
  return `
    <div class="field"><label>Dimension</label>
      <div class="size-pick">${sizes.map((s) => `<button type="button" data-spick="${esc(s.id)}" class="${s.id === it.sizeId ? 'sel' : ''}" title="${esc(dimsLabel(s))}">${sizeThumb(s)}<span>${esc(s.label || dimsLabel(s))}</span></button>`).join('')}</div>
      <button type="button" class="btn btn--light btn--sm" data-snew style="margin-top:8px">+ Autre dimension</button>
    </div>`;
}

/**
 * Branche les boutons du panneau.
 * @param onChange (it) => void   appelé après chaque modification de l'élément du plan
 * @param saveFurniture (f) => Promise  enregistre le meuble (nouvelle dimension ajoutée)
 */
export function bindPlacementPanel(panel, it, f, { onChange, saveFurniture }) {
  if (!panel || !f) return;
  const changed = () => onChange(it);
  const addSize = async () => {
    const s = await sizeDialog({ height: f.height, width: f.width }, { title: isModular(f) ? 'Nouvel élément' : 'Nouvelle dimension', modular: isModular(f) });
    if (!s) return null;
    if (!f.sizes?.length) f.sizes = sizesOf(f).map((x) => ({ ...x, id: 'base', origin: 'custom', presented: true }));
    f.sizes.push(s);
    await saveFurniture(f);
    return s;
  };
  panel.querySelectorAll('[data-spick]').forEach((b) => (b.onclick = () => { it.sizeId = b.dataset.spick; changed(); }));
  panel.querySelector('[data-snew]')?.addEventListener('click', async () => { const s = await addSize(); if (s) { it.sizeId = s.id; changed(); } });

  const mods = () => (it.modules ||= []);
  panel.querySelectorAll('[data-mi]').forEach((li) => {
    const i = Number(li.dataset.mi);
    li.querySelector('[data-mup]')?.addEventListener('click', () => { const m = mods(); [m[i - 1], m[i]] = [m[i], m[i - 1]]; changed(); });
    li.querySelector('[data-mdown]')?.addEventListener('click', () => { const m = mods(); [m[i + 1], m[i]] = [m[i], m[i + 1]]; changed(); });
    li.querySelector('[data-mret]')?.addEventListener('click', () => { mods()[i].ret = !mods()[i].ret; changed(); });
    li.querySelector('[data-mdel]')?.addEventListener('click', () => { if (mods().length > 1) { mods().splice(i, 1); changed(); } else toast('Une composition garde au moins un élément', 'err'); });
  });
  panel.querySelector('[data-madd]')?.addEventListener('click', () => { mods().push(newModule(panel.querySelector('#maddsel').value)); changed(); });
  panel.querySelector('[data-mnew]')?.addEventListener('click', async () => { const s = await addSize(); if (s) { mods().push(newModule(s.id)); changed(); } });
  panel.querySelector('[data-mreset]')?.addEventListener('click', () => { it.modules = defaultModules(f); changed(); });
}
