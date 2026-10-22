// Bibliothèque de meubles : 2 niveaux (pièce > type de meuble)
import { api, uploadImages } from './api.js';
import { store, SEAT_TYPES, TOP_TYPES } from './store.js';
import { esc, $, $$, modal, toast, confirmDialog, bindDropzone, busy, num, furnitureDims } from './ui.js';
import { capturePhotos } from './camera.js';
import { src } from './data/media.js';
import { exportLibraryDialog, pickAndImport } from './transfer.js';
import { catalogueDialog } from './catalogue.js';
import { sizesEditorHTML, bindSizesEditor, sizeThumb } from './sizes-ui.js';
import { isModularType, sizesOf } from './sizes.js';

const PLACEHOLDER = `<svg width="56" viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 22v-8a4 4 0 014-4h44a4 4 0 014 4v8"/><path d="M2 22a4 4 0 018 0v6h44v-6a4 4 0 018 0v10H2z"/><path d="M8 32v5M56 32v5"/></svg>`;

export function furnitureCard(f, { selectable = false } = {}) {
  const cover = f.photos?.[f.cover || 0]?.media;
  return `
    <article class="card" data-fid="${f.id}" tabindex="0">
      <div class="card__img">${cover ? `<img ${src(cover)} alt="">` : PLACEHOLDER}</div>
      ${f.type ? `<span class="card__badge">${esc(f.type)}</span>` : ''}
      <div class="card__body">
        <div class="card__title">${esc(f.name)}</div>
        <div class="card__meta">${esc(store.catName(f.category) || 'Sans pièce')}${f.reference ? ' · Réf. ' + esc(f.reference) : ''}</div>
        <div class="card__meta">${furnitureDims(f)}${f.sizes?.length > 1 ? ` · ${f.sizes.length} ${isModularType(f.type) ? 'éléments' : 'dimensions'}` : ''}</div>
      </div>
      ${selectable ? '' : ''}
    </article>`;
}

// ------------------------------------------------------------------
// Vue Bibliothèque
// ------------------------------------------------------------------
export async function renderLibrary(app, params = {}) {
  await store.loadCategories();
  const state = { category: params.category || '', type: params.type || '', q: '' };
  let all = await api.furniture();

  app.innerHTML = `
    <div class="section-head">
      <div><span class="eyebrow">Bibliothèque</span><h1>Mes meubles</h1></div>
      <div class="btn-row">
        <button class="btn btn--light" data-cats>Gérer les pièces et types</button>
        <button class="btn btn--light" data-catalog title="Ajouter des modèles du catalogue Mobilier de France">Catalogue MDF</button>
        <button class="btn btn--light" data-import title="Importer une bibliothèque reçue (fichier .zip)">⤓ Importer</button>
        <button class="btn btn--light" data-export title="Créer un fichier à partager">⤴ Partager</button>
        <button class="btn btn--ghost" data-photo>📷 Photographier un meuble</button>
        <button class="btn" data-new>+ Nouveau meuble</button>
      </div>
    </div>
    <div class="lib">
      <aside><ul class="tree" id="tree"></ul></aside>
      <section>
        <div class="breadcrumb" id="crumb"></div>
        <div class="filters"><input class="input" id="search" placeholder="Rechercher un meuble, une référence…"></div>
        <div class="cards" id="grid"></div>
      </section>
    </div>`;

  const drawTree = () => {
    const count = (c, t) => all.filter((f) => (!c || f.category === c) && (!t || f.type === t)).length;
    $('#tree', app).innerHTML = `
      <li><button class="${!state.category ? 'active' : ''}" data-c="">Tous les meubles <span class="count">${all.length}</span></button></li>
      ${store.categories.map((c) => `
        <li>
          <button class="${state.category === c.id ? 'active' : ''}" data-c="${c.id}">${esc(c.name)} <span class="count">${count(c.id)}</span></button>
          ${state.category === c.id ? `<ul>${c.types.map((t) => `
            <li><button class="${state.type === t ? 'active' : ''}" data-c="${c.id}" data-t="${esc(t)}">${esc(t)} <span class="count">${count(c.id, t)}</span></button></li>`).join('')}</ul>` : ''}
        </li>`).join('')}`;
  };

  const drawGrid = () => {
    const q = state.q.toLowerCase();
    const list = all.filter((f) => (!state.category || f.category === state.category) && (!state.type || f.type === state.type)
      && (!q || [f.name, f.reference, f.type].join(' ').toLowerCase().includes(q)));
    $('#crumb', app).textContent = ['Bibliothèque', store.catName(state.category), state.type].filter(Boolean).join(' › ');
    $('#grid', app).innerHTML = `
      <button class="card card--add" data-new><div><span>+</span>Ajouter un meuble</div></button>
      ${list.map((f) => furnitureCard(f)).join('')}
      ${!all.length ? `<div class="empty" style="grid-column:1/-1">Bibliothèque vide. <button class="linklike" data-catalog>Ajoutez des modèles du catalogue Mobilier de France</button>, ajoutez vos propres meubles, ou <button class="linklike" data-import>importez un fichier de bibliothèque</button> reçu d'un autre appareil.</div>` : ''}`;
  };

  const refresh = async () => { all = await api.furniture(); drawTree(); drawGrid(); };
  drawTree(); drawGrid();

  app.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-c]');
    if (c) { state.category = c.dataset.c; state.type = c.dataset.t || ''; drawTree(); drawGrid(); return; }
    if (e.target.closest('[data-new]')) {
      const f = await openFurnitureForm({ defaults: { category: state.category, type: state.type } });
      if (f) refresh();
      return;
    }
    if (e.target.closest('[data-photo]')) {
      const shots = await capturePhotos({ title: 'Photographier un meuble' });
      if (!shots?.length) return;
      const f = await openFurnitureForm({ defaults: { category: state.category, type: state.type }, files: shots });
      if (f) refresh();
      return;
    }
    if (e.target.closest('[data-cats]')) { if (await manageCategories()) { drawTree(); drawGrid(); } return; }
    if (e.target.closest('[data-export]')) { exportLibraryDialog(state.category); return; }
    if (e.target.closest('[data-import]')) { if (await pickAndImport()) refresh(); return; }
    if (e.target.closest('[data-catalog]')) { if (await catalogueDialog()) refresh(); return; }
    const card = e.target.closest('[data-fid]');
    if (card) {
      const f = all.find((x) => x.id === card.dataset.fid);
      const res = await openFurnitureForm({ furniture: f });
      if (res !== null) refresh();
    }
  });
  $('#search', app).addEventListener('input', (e) => { state.q = e.target.value; drawGrid(); });
}

// ------------------------------------------------------------------
// Formulaire meuble (création / édition). Résout avec le meuble, 'deleted' ou null.
// ------------------------------------------------------------------
export async function openFurnitureForm({ furniture, defaults = {}, files = [] } = {}) {
  if (!store.categories.length) await store.loadCategories();
  const f = furniture ? structuredClone(furniture) : { name: '', category: defaults.category || store.categories[0]?.id || '', type: defaults.type || '', photos: [], cover: 0 };
  f.photos ??= [];

  const typeOptions = (cat) => {
    const types = store.categories.find((c) => c.id === cat)?.types || [];
    return `<option value="">— Choisir —</option>` + types.map((t) => `<option ${t === f.type ? 'selected' : ''}>${esc(t)}</option>`).join('');
  };

  return new Promise((resolve) => {
    let result = null;
    const m = modal({
      title: furniture ? 'Modifier le meuble' : 'Nouveau meuble',
      wide: true,
      onClose: () => resolve(result),
      content: `
        <div class="layout" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
          <div>
            <h3>Photos du meuble</h3>
            <div class="choice">
              <button type="button" data-cam><span class="ico">📷</span><strong>Prendre en photo</strong></button>
              <button type="button" data-drop><span class="ico">🖼️</span><strong>Importer des images</strong></button>
            </div>
            <div class="dropzone hidden" id="fdrop"><strong>Déposez vos images ici</strong><span class="muted small">ou cliquez pour parcourir</span></div>
            <input type="file" accept="image/*" multiple hidden id="ffile">
            <p class="muted small">Conseil : une photo nette du meuble entier, sur fond neutre si possible. L'étoile désigne la photo principale.</p>
            <div class="thumbs" id="fthumbs"></div>
          </div>
          <form id="fform" autocomplete="off">
            <div class="field"><label>Nom du meuble *</label><input name="name" required value="${esc(f.name)}" placeholder="Ex. Canapé 3 places Milano"></div>
            <div class="field"><label>Référence</label><input name="reference" value="${esc(f.reference || '')}" placeholder="Optionnel"></div>
            <div class="grid-2">
              <div class="field"><label>Pièce</label><select name="category">${store.categories.map((c) => `<option value="${c.id}" ${c.id === f.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
              <div class="field"><label>Type de meuble</label><select name="type">${typeOptions(f.category)}</select></div>
            </div>
            <div class="grid-3">
              <div class="field"><label>Longueur</label><div class="unit" data-unit="cm"><input name="length" type="number" min="1" step="1" value="${f.length ?? ''}"></div></div>
              <div class="field"><label>Largeur / prof.</label><div class="unit" data-unit="cm"><input name="width" type="number" min="1" step="1" value="${f.width ?? ''}"></div></div>
              <div class="field"><label>Hauteur</label><div class="unit" data-unit="cm"><input name="height" type="number" min="1" step="1" value="${f.height ?? ''}"></div></div>
            </div>
            <div class="grid-2">
              <div class="field" data-seat><label>Hauteur d'assise</label><div class="unit" data-unit="cm"><input name="seatHeight" type="number" min="1" value="${f.seatHeight ?? ''}"></div></div>
              <div class="field" data-top><label>Hauteur de plateau</label><div class="unit" data-unit="cm"><input name="topHeight" type="number" min="1" value="${f.topHeight ?? ''}"></div></div>
            </div>
            ${sizesEditorHTML()}
            <div class="field"><label>Autres cotes</label><input name="extra" value="${esc(f.extra || '')}" placeholder="Ex. profondeur d'assise 58 cm, accoudoirs 20 cm"></div>
            <div class="field"><label>Description / notes</label><textarea name="notes" placeholder="Matière, coloris, pieds, particularités…">${esc(f.notes || '')}</textarea></div>
          </form>
        </div>`,
      footer: `
        ${furniture ? '<button class="btn btn--danger" data-del style="margin-right:auto">Supprimer</button>' : ''}
        <button class="btn btn--light" data-close>Annuler</button>
        <button class="btn" data-save>${furniture ? 'Enregistrer' : 'Ajouter à la bibliothèque'}</button>`,
    });

    const el = m.el;
    const form = $('#fform', el);
    const drawThumbs = () => {
      $('#fthumbs', el).innerHTML = f.photos.map((p, i) => `
        <div class="thumb ${i === (f.cover || 0) ? 'ref' : ''}">
          <img ${src(p.media)} alt="">
          ${i === (f.cover || 0) ? '<span class="thumb__tag">Principale</span>' : ''}
          <div class="thumb__actions">
            <button type="button" title="Photo principale" data-cover="${i}">★</button>
            <button type="button" title="Supprimer" data-rm="${i}">✕</button>
          </div>
        </div>`).join('') || '<p class="muted small">Aucune photo pour le moment.</p>';
    };
    const toggleExtra = () => {
      const t = form.type.value;
      $('[data-seat]', el).classList.toggle('hidden', Boolean(t) && !SEAT_TYPES.test(t));
      $('[data-top]', el).classList.toggle('hidden', Boolean(t) && !TOP_TYPES.test(t));
    };
    const addFiles = async (list) => {
      try {
        toast('Enregistrement des photos…');
        f.photos.push(...(await uploadImages(list)));
        drawThumbs();
      } catch (e) { toast(e.message, 'err'); }
    };
    drawThumbs(); toggleExtra();
    const sizesUI = bindSizesEditor(el, f, () => isModularType(form.type.value));
    form.type.addEventListener('change', () => sizesUI.redraw());
    if (files.length) addFiles(files);

    form.category.addEventListener('change', () => { f.category = form.category.value; f.type = ''; form.type.innerHTML = typeOptions(f.category); toggleExtra(); });
    form.type.addEventListener('change', toggleExtra);
    bindDropzone($('#fdrop', el), $('#ffile', el), addFiles);
    $('[data-drop]', el).onclick = () => { $('#fdrop', el).classList.remove('hidden'); $('#ffile', el).click(); };
    $('[data-cam]', el).onclick = async () => { const s = await capturePhotos({ title: 'Photographier le meuble' }); if (s?.length) addFiles(s); };
    $('#fthumbs', el).addEventListener('click', (e) => {
      const c = e.target.closest('[data-cover]'); const r = e.target.closest('[data-rm]');
      if (c) f.cover = Number(c.dataset.cover);
      if (r) { const i = Number(r.dataset.rm); f.photos.splice(i, 1); if ((f.cover || 0) >= f.photos.length) f.cover = 0; else if (i < (f.cover || 0)) f.cover--; }
      drawThumbs();
    });

    $('[data-save]', el).onclick = async (e) => {
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      const body = {
        name: data.name.trim(), reference: data.reference.trim(), category: data.category, type: data.type,
        length: num(data.length), width: num(data.width), height: num(data.height),
        seatHeight: num(data.seatHeight), topHeight: num(data.topHeight),
        extra: data.extra.trim(), notes: data.notes.trim(), photos: f.photos, cover: f.cover || 0, sizes: f.sizes || [],
      };
      if (!body.photos.length && !(await confirmDialog("Ce meuble n'a pas de photo : l'IA ne pourra s'appuyer que sur sa description. Continuer ?", 'Continuer', false))) return;
      busy(e.target, true, 'Enregistrement…');
      try {
        result = furniture ? await api.updateFurniture(furniture.id, body) : await api.createFurniture(body);
        toast('Meuble enregistré', 'ok');
        m.close();
      } catch (err) { toast(err.message, 'err'); busy(e.target, false); }
    };
    $('[data-del]', el)?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Supprimer « ${furniture.name} » de la bibliothèque ?`, 'Supprimer'))) return;
      await api.deleteFurniture(furniture.id);
      result = 'deleted';
      toast('Meuble supprimé');
      m.close();
    });
  });
}

// ------------------------------------------------------------------
// Sélecteur de meuble depuis la bibliothèque
// ------------------------------------------------------------------
export async function pickFurniture({ category = '' } = {}) {
  await store.loadCategories();
  let all = await api.furniture();
  const st = { category: all.some((f) => f.category === category) ? category : '', type: '', q: '' };

  return new Promise((resolve) => {
    let result = null;
    const m = modal({
      title: 'Choisir dans la bibliothèque',
      wide: true,
      onClose: () => resolve(result),
      content: `
        <div class="filters">
          <select class="input" data-f="category"><option value="">Toutes les pièces</option>${store.categories.map((c) => `<option value="${c.id}" ${c.id === st.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <select class="input" data-f="type"></select>
          <input class="input" data-f="q" placeholder="Rechercher…">
        </div>
        <div class="cards" id="pgrid"></div>`,
      footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn btn--ghost" data-create>+ Créer un nouveau meuble</button>`,
    });
    const el = m.el;
    const types = () => {
      const cats = st.category ? store.categories.filter((c) => c.id === st.category) : store.categories;
      const list = [...new Set(cats.flatMap((c) => c.types))];
      $('[data-f=type]', el).innerHTML = `<option value="">Tous les types</option>` + list.map((t) => `<option ${t === st.type ? 'selected' : ''}>${esc(t)}</option>`).join('');
    };
    const draw = () => {
      const q = st.q.toLowerCase();
      const list = all.filter((f) => (!st.category || f.category === st.category) && (!st.type || f.type === st.type) && (!q || [f.name, f.reference].join(' ').toLowerCase().includes(q)));
      $('#pgrid', el).innerHTML = list.map((f) => furnitureCard(f)).join('') || `<div class="empty" style="grid-column:1/-1">Aucun meuble ne correspond. Créez-en un nouveau !</div>`;
    };
    types(); draw();
    $$('[data-f]', el).forEach((inp) => inp.addEventListener('input', () => {
      st[inp.dataset.f] = inp.value;
      if (inp.dataset.f === 'category') { st.type = ''; types(); }
      draw();
    }));
    $('#pgrid', el).addEventListener('click', (e) => {
      const c = e.target.closest('[data-fid]');
      if (c) { result = all.find((f) => f.id === c.dataset.fid); m.close(); }
    });
    $('[data-create]', el).onclick = async () => {
      const f = await openFurnitureForm({ defaults: { category: st.category, type: st.type } });
      if (f && f !== 'deleted') { result = f; m.close(); }
    };
  });
}

// ------------------------------------------------------------------
// Gestion des catégories (pièces + types)
// ------------------------------------------------------------------
export function manageCategories() {
  const cats = structuredClone(store.categories);
  return new Promise((resolve) => {
    let saved = false;
    const m = modal({
      title: 'Pièces et types de meubles',
      onClose: () => resolve(saved),
      content: `<p class="muted small">Niveau 1 : les pièces. Niveau 2 : les types de meubles de chaque pièce.</p><div id="cats"></div>
        <div class="btn-row" style="margin-top:16px"><input class="input" id="newcat" placeholder="Nouvelle pièce (ex. Salle de bain)" style="flex:1"><button class="btn btn--ghost" id="addcat">Ajouter la pièce</button></div>`,
      footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn" data-save>Enregistrer</button>`,
    });
    const el = m.el;
    const draw = () => {
      $('#cats', el).innerHTML = cats.map((c, i) => `
        <div class="cat-block" data-i="${i}">
          <header><input class="input" data-name value="${esc(c.name)}"><button class="icon-btn" title="Supprimer la pièce" data-delcat>✕</button></header>
          <div class="chips">${c.types.map((t, j) => `<span class="chip">${esc(t)}<button data-deltype="${j}" title="Retirer">×</button></span>`).join('')}</div>
          <div class="btn-row" style="margin-top:10px"><input class="input" data-newtype placeholder="Ajouter un type…" style="flex:1"><button class="btn btn--sm btn--ghost" data-addtype>Ajouter</button></div>
        </div>`).join('');
    };
    draw();
    el.addEventListener('input', (e) => { const b = e.target.closest('[data-i]'); if (b && e.target.matches('[data-name]')) cats[b.dataset.i].name = e.target.value; });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (e.target.matches('[data-delcat]')) { cats.splice(b.dataset.i, 1); draw(); }
      else if (e.target.matches('[data-deltype]')) { cats[b.dataset.i].types.splice(e.target.dataset.deltype, 1); draw(); }
      else if (e.target.matches('[data-addtype]')) {
        const v = $('[data-newtype]', b).value.trim();
        if (v) { cats[b.dataset.i].types.push(v); draw(); $(`[data-i="${b.dataset.i}"] [data-newtype]`, el).focus(); }
      }
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-newtype]')) { e.preventDefault(); e.target.nextElementSibling.click(); } });
    $('#addcat', el).onclick = () => { const v = $('#newcat', el).value.trim(); if (v) { cats.push({ name: v, types: [] }); $('#newcat', el).value = ''; draw(); } };
    $('[data-save]', el).onclick = async () => {
      try {
        store.categories = await api.saveCategories(cats);
        saved = true;
        toast('Catégories enregistrées', 'ok');
        m.close();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}
