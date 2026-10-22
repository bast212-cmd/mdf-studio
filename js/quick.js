// Rendu rapide, en écrans successifs (pensé pour l'iPad) :
// la pièce → la zone → le meuble (bibliothèque, catalogue ou photo) → finition → résultat
import { api } from './api.js';
import { store } from './store.js';
import { esc, $, $$, toast, confirmDialog, busy, num, furnitureDims } from './ui.js';
import { src, storeImages, getMediaBlob, shareOrDownload } from './data/media.js';
import { furnitureCard } from './library.js';
import { catalogueFurniture } from './catalogue.js';
import { CATALOGUE_MDF } from './data/catalogue-mdf.js';

const pending = new Map(); // roomId -> Promise de génération (survit à la navigation)

const STEPS = [
  { id: 'room', label: 'La pièce' },
  { id: 'zone', label: 'La zone' },
  { id: 'furniture', label: 'Le meuble' },
  { id: 'finish', label: 'Finition' },
];

async function ensureAIReady() {
  store.status = await api.status();
  if (!store.status.configured) {
    if (await confirmDialog("Aucun code d'accès ni clé API n'est renseigné sur cet appareil. Ouvrir les réglages pour l'ajouter ?", 'Ouvrir les réglages', false)) location.hash = '#/reglages';
    return false;
  }
  if (!navigator.onLine) { toast("Pas de connexion internet : l'IA n'est pas disponible hors ligne.", 'err'); return false; }
  return true;
}

/** Appareil photo natif de l'iPad (camera) ou pellicule ; résout avec une liste de fichiers */
function pickImages({ camera, multiple = false }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.capture = 'environment';
    input.multiple = multiple && !camera;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

const sourceButtons = (prefix, { cameraLabel = 'Prendre une photo', libraryLabel = 'Pellicule', big = false } = {}) => `
  <div class="choice ${big ? 'choice--big' : ''}">
    <button data-${prefix}-cam><span class="ico">📷</span><strong>${cameraLabel}</strong></button>
    <button data-${prefix}-imp><span class="ico">🖼️</span><strong>${libraryLabel}</strong></button>
  </div>`;

export async function renderQuick(view, { id }) {
  if (!id || id === 'nouveau') {
    const room = await api.createRoom({ name: 'Rendu rapide', mode: 'quick', quick: { action: 'replace', furniture: { photos: [] } } });
    location.replace(`#/rapide/${room.id}`);
    return;
  }
  let room;
  try { room = await api.room(id); } catch { view.innerHTML = '<div class="empty">Projet introuvable. <a href="#/">Retour à mes projets</a></div>'; return; }
  room.quick ??= { action: 'replace', furniture: { photos: [] } };
  room.quick.furniture ??= { photos: [] };
  room.renders ??= [];
  const q = room.quick;
  await store.loadCategories();

  // ---------- sauvegarde différée ----------
  let saveTimer = null;
  const persist = () => api.updateRoom(room.id, { name: room.name, photos: room.photos, quick: room.quick, mode: 'quick' })
    .catch((e) => toast('Sauvegarde impossible : ' + e.message, 'err'));
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };
  const flush = async () => { clearTimeout(saveTimer); await persist(); };

  const photo = () => room.photos?.[0] || null;
  const hasFurniture = () => q.furniture.photos.length > 0;
  const ready = () => photo() && q.zone && hasFurniture();
  const reachable = (s) => ({ room: true, zone: Boolean(photo()), furniture: Boolean(photo() && q.zone), finish: Boolean(ready()), result: Boolean(current) })[s];

  let current = room.renders[0] || null;
  let loading = false;
  let error = null;
  let tool = 'zone'; // 'zone' : zone du nouveau meuble · 'keep' : objets à garder devant
  let furnTab = q.furniture.source || 'library'; // 'library' · 'catalogue' · 'photo'
  const filter = { q: '', category: '' };
  // écran d'arrivée : le résultat s'il existe, sinon la première étape à faire
  let step = current || pending.has(room.id) ? 'result' : !photo() ? 'room' : !q.zone ? 'zone' : !hasFurniture() ? 'furniture' : 'finish';

  view.innerHTML = `
    <div class="quickwiz">
      <div class="project-head">
        <div style="flex:1;min-width:240px">
          <span class="eyebrow">Rendu rapide</span>
          <input class="input" id="pname" value="${esc(room.name)}" aria-label="Nom du projet">
        </div>
        <button class="btn btn--light btn--sm" id="pdel">Supprimer</button>
      </div>
      <ol class="stepper wiz-steps" id="wsteps"></ol>
      <div class="wiz-body" id="wbody"></div>
      <div class="wiz-nav" id="wnav"></div>
    </div>`;
  $('#pname', view).addEventListener('input', (e) => { room.name = e.target.value; save(); });
  $('#pdel', view).onclick = async () => {
    if (await confirmDialog('Supprimer définitivement ce projet et ses rendus ?', 'Supprimer')) { await api.deleteRoom(room.id); location.hash = '#/'; }
  };
  const stepsEl = $('#wsteps', view);
  const body = $('#wbody', view);
  const nav = $('#wnav', view);

  const go = (s) => { step = s; error = s === 'result' ? error : null; draw(); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  // =================================================================
  // Barre d'étapes et navigation
  // =================================================================
  function drawSteps() {
    const list = [...STEPS, ...(current || loading ? [{ id: 'result', label: 'Résultat' }] : [])];
    const doneOf = { room: Boolean(photo()), zone: Boolean(q.zone), furniture: hasFurniture(), finish: Boolean(current), result: false };
    stepsEl.innerHTML = list.map((s, i) => `
      <li><button data-step="${s.id}" class="${s.id === step ? 'active' : doneOf[s.id] ? 'done' : ''}" ${reachable(s.id) && !loading ? '' : 'disabled'}>
        <span class="n">${s.id === 'result' ? '★' : doneOf[s.id] && s.id !== step ? '✓' : i + 1}</span><span class="t">${s.label}</span>
      </button></li>`).join('');
    $$('[data-step]', stepsEl).forEach((b) => (b.onclick = () => go(b.dataset.step)));
  }

  function drawNav() {
    if (loading) { nav.innerHTML = ''; return; }
    const idx = STEPS.findIndex((s) => s.id === step);
    const back = step === 'result' ? 'finish' : STEPS[idx - 1]?.id;
    const backBtn = back ? `<button class="btn btn--light" data-back>‹ ${step === 'result' ? 'Modifier' : 'Retour'}</button>` : '<span></span>';
    let next = '';
    if (step === 'finish') next = `<button class="btn btn--lg" data-gen ${ready() ? '' : 'disabled'}>${current ? '↻ Relancer le rendu ✨' : 'Lancer le rendu ✨'}</button>`;
    else if (step === 'result') next = `<button class="btn btn--lg" data-gen>↻ Relancer le rendu ✨</button>`;
    else {
      const ok = reachable(STEPS[idx + 1].id);
      const missing = { room: 'Ajoutez la photo de la pièce', zone: 'Tracez la zone sur la photo', furniture: 'Choisissez un meuble' }[step];
      next = `<span class="wiz-next">${ok ? '' : `<span class="muted small">${missing}</span>`}<button class="btn btn--lg" data-next ${ok ? '' : 'disabled'}>Suivant ›</button></span>`;
    }
    nav.innerHTML = backBtn + next;
    $('[data-back]', nav)?.addEventListener('click', () => go(back));
    $('[data-next]', nav)?.addEventListener('click', () => go(STEPS[idx + 1].id));
    $('[data-gen]', nav)?.addEventListener('click', generate);
  }

  function draw() {
    drawSteps();
    drawNav();
    if (loading) return drawLoading();
    ({ room: drawRoom, zone: drawZone, furniture: drawFurniture, finish: drawFinish, result: drawResult })[step]();
  }

  // =================================================================
  // 1. La pièce
  // =================================================================
  async function drawRoom() {
    const p = photo();
    body.innerHTML = `
      <div class="wiz-head"><div><h2>La pièce</h2>
        <p class="muted">Photo prise à hauteur d'yeux, en mode paysage, pièce bien éclairée.</p></div></div>
      ${p ? `<div class="wiz-photo"><img ${src(p.media)} alt="Photo de la pièce"></div><p class="muted small wiz-center">Photo choisie. Vous pouvez la remplacer :</p>` : ''}
      ${sourceButtons('room', { big: !p })}
      <div id="recent"></div>`;
    const setRoom = async (ph) => {
      if (q.zone && !(await confirmDialog('Remplacer la photo de la pièce ? La zone tracée sera effacée.', 'Remplacer', false))) return;
      room.photos = [ph];
      delete q.zone;
      delete q.keep;
      save();
      go('zone');
    };
    const add = async (camera) => {
      const files = await pickImages({ camera });
      if (!files?.length) return;
      try { const [ph] = await storeImages([files[0]]); await setRoom(ph); } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-room-cam]', body).onclick = () => add(true);
    $('[data-room-imp]', body).onclick = () => add(false);

    // photos des derniers projets, pour ne pas reprendre la même pièce
    const seen = new Set(p ? [p.media] : []);
    const recent = [];
    for (const r of await api.rooms()) {
      const ph = r.id !== room.id && r.photos?.[0];
      if (ph?.media && !seen.has(ph.media)) { seen.add(ph.media); recent.push({ ph, name: r.name }); }
      if (recent.length >= 8) break;
    }
    if (!recent.length || !view.isConnected || step !== 'room') return;
    $('#recent', body).innerHTML = `
      <h3 class="wiz-sub">Ou reprendre une pièce récente</h3>
      <div class="history recent">${recent.map((x, i) => `<button data-recent="${i}" title="${esc(x.name)}"><img ${src(x.ph.media)} alt=""><span class="recent__name">${esc(x.name)}</span></button>`).join('')}</div>`;
    $$('[data-recent]', body).forEach((b) => (b.onclick = () => { const { ph } = recent[Number(b.dataset.recent)]; setRoom({ media: ph.media, w: ph.w, h: ph.h }); }));
  }

  // =================================================================
  // 2. La zone
  // =================================================================
  function drawZone() {
    const p = photo();
    const keep = q.keep || [];
    body.innerHTML = `
      <div class="zone-bar">
        <div class="seg tools">
          <button data-tool="zone" class="${tool === 'zone' ? 'sel' : ''}">▭ Zone du meuble</button>
          <button data-tool="keep" class="${tool === 'keep' ? 'sel keep' : ''}">▭ Objet devant${keep.length ? ` (${keep.length})` : ''}</button>
          ${q.zone ? '<button data-zclear>Effacer</button>' : ''}
        </div>
        <div class="seg">
          <button data-action="replace" class="${q.action !== 'add' ? 'sel' : ''}">Remplacer ce qui s'y trouve</button>
          <button data-action="add" class="${q.action === 'add' ? 'sel' : ''}">Ajouter sans rien retirer</button>
        </div>
      </div>
      <p class="muted small zone-hint">${tool === 'keep'
        ? 'Entourez chaque objet qui doit rester <strong>devant</strong> le nouveau meuble (table basse, fauteuil, plante…). Il ne sera ni retiré ni modifié.'
        : 'Tracez au doigt l\'emplacement du meuble, y compris la partie cachée derrière un autre objet. Glissez la zone pour la déplacer.'}</p>
      <div class="zone-editor ${tool === 'keep' ? 'tool-keep' : ''}" id="zed">
        <img ${src(p.media)} alt="Photo de la pièce" draggable="false">
        <div class="zone ${q.zone ? '' : 'hidden'}"><span>${q.action === 'add' ? 'Ajouter ici' : 'Remplacer ici'}</span></div>
        ${keep.map((k, i) => `<div class="keepbox" style="left:${k.x * 100}%;top:${k.y * 100}%;width:${k.w * 100}%;height:${k.h * 100}%"><span>Devant</span><button data-krm="${i}" aria-label="Retirer">×</button></div>`).join('')}
      </div>`;
    bindZone($('#zed', body));
    $$('[data-action]', body).forEach((b) => (b.onclick = () => { q.action = b.dataset.action; save(); draw(); }));
    $$('[data-tool]', body).forEach((b) => (b.onclick = () => { tool = b.dataset.tool; draw(); }));
    $('[data-zclear]', body)?.addEventListener('click', () => { delete q.zone; save(); draw(); });
  }

  function bindZone(ed) {
    const box = $('.zone', ed);
    let ghost = null; // rectangle en cours de tracé (outil « objet devant »)
    const place = (el, z) => {
      el.style.left = `${z.x * 100}%`; el.style.top = `${z.y * 100}%`;
      el.style.width = `${z.w * 100}%`; el.style.height = `${z.h * 100}%`;
      el.classList.remove('hidden');
    };
    if (q.zone) place(box, q.zone);
    const rel = (e) => {
      const r = ed.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    };
    let drag = null;
    ed.addEventListener('pointerdown', (e) => {
      const rm = e.target.closest('[data-krm]');
      if (rm) { q.keep.splice(Number(rm.dataset.krm), 1); save(); draw(); return; }
      e.preventDefault();
      ed.setPointerCapture(e.pointerId);
      const P = rel(e);
      const z = q.zone;
      if (tool === 'zone' && z && P.x > z.x && P.x < z.x + z.w && P.y > z.y && P.y < z.y + z.h) drag = { type: 'move', ox: P.x - z.x, oy: P.y - z.y };
      else drag = { type: 'draw', sx: P.x, sy: P.y };
      if (tool === 'keep') { ghost = document.createElement('div'); ghost.className = 'keepbox hidden'; ed.appendChild(ghost); }
    });
    ed.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const P = rel(e);
      if (drag.type === 'move') {
        const z = q.zone;
        z.x = Math.min(1 - z.w, Math.max(0, P.x - drag.ox));
        z.y = Math.min(1 - z.h, Math.max(0, P.y - drag.oy));
        place(box, z);
      } else {
        drag.z = { x: Math.min(drag.sx, P.x), y: Math.min(drag.sy, P.y), w: Math.abs(P.x - drag.sx), h: Math.abs(P.y - drag.sy) };
        place(tool === 'keep' ? ghost : box, drag.z);
      }
    });
    const end = () => {
      if (!drag) return;
      const wasDraw = drag.type === 'draw';
      const big = drag.z && drag.z.w > 0.02 && drag.z.h > 0.02;
      if (wasDraw && tool === 'keep') {
        if (big) { q.keep = [...(q.keep || []), drag.z].slice(-4); }
        ghost?.remove(); ghost = null;
      } else if (wasDraw) {
        if (big && drag.z.w > 0.03 && drag.z.h > 0.03) q.zone = drag.z;
        else if (q.zone) place(box, q.zone); else box.classList.add('hidden');
      }
      drag = null;
      save();
      if (wasDraw) draw();
    };
    ed.addEventListener('pointerup', end);
    ed.addEventListener('pointercancel', end);
  }

  // =================================================================
  // 3. Le meuble : bibliothèque, catalogue ou photo
  // =================================================================
  // Copie des photos et cotes d'un meuble de la bibliothèque (les images sont partagées, pas dupliquées)
  const useFurniture = (f, source) => {
    const ph = [...(f.photos || [])];
    if (f.cover) ph.unshift(...ph.splice(f.cover, 1));
    q.furniture = {
      photos: ph.slice(0, 3).map(({ media, w, h }) => ({ media, w, h })),
      name: f.name || '', length: f.length, width: f.width, height: f.height, notes: f.notes || '',
      libraryId: f.id, source,
    };
    save();
    go('finish');
  };

  async function drawFurniture() {
    const f = q.furniture;
    const all = await api.furniture();
    if (!view.isConnected || step !== 'furniture') return;
    const tabs = [['library', `Ma bibliothèque <span class="muted">(${all.length})</span>`], ['catalogue', 'Catalogue MDF'], ['photo', 'Photo du meuble']];
    body.innerHTML = `
      <div class="wiz-head"><div><h2>Le meuble</h2><p class="muted">Choisissez un modèle, ou photographiez le meuble.</p></div></div>
      ${hasFurniture() ? `<div class="selbar"><img ${src(f.photos[0].media)} alt=""><div><strong>${esc(f.name || 'Meuble photographié')}</strong>
        <div class="muted small">${f.length || f.width || f.height ? furnitureDims(f) : `${f.photos.length} photo(s)`}</div></div>
        <span class="tag-ok">Sélectionné</span></div>` : ''}
      <div class="seg tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${furnTab === k ? 'sel' : ''}">${l}</button>`).join('')}</div>
      <div id="tab"></div>`;
    $$('[data-tab]', body).forEach((b) => (b.onclick = () => { furnTab = b.dataset.tab; drawFurniture(); }));
    const tab = $('#tab', body);
    if (furnTab === 'library') drawLibraryTab(tab, all);
    else if (furnTab === 'catalogue') drawCatalogueTab(tab, all);
    else drawPhotoTab(tab);
  }

  const filtersHTML = (cats) => `
    <div class="filters">
      <input class="input" data-q placeholder="Rechercher…" value="${esc(filter.q)}" type="search">
      <select class="input" data-cat><option value="">Toutes les pièces</option>${cats.map((c) => `<option value="${c.id}" ${c.id === filter.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    </div>`;
  const bindFilters = (el, redraw) => {
    $('[data-q]', el).addEventListener('input', (e) => { filter.q = e.target.value; redraw(); });
    $('[data-cat]', el).onchange = (e) => { filter.category = e.target.value; redraw(); };
  };
  const matches = (x) => (!filter.category || x.category === filter.category)
    && (!filter.q || [x.name, x.type, x.reference].join(' ').toLowerCase().includes(filter.q.toLowerCase()));

  function drawLibraryTab(tab, all) {
    if (!all.length) {
      tab.innerHTML = `<div class="empty">Bibliothèque vide. Choisissez un modèle dans le <button class="linklike" data-goto="catalogue">catalogue Mobilier de France</button>, ou <button class="linklike" data-goto="photo">photographiez le meuble</button>.</div>`;
      $$('[data-goto]', tab).forEach((b) => (b.onclick = () => { furnTab = b.dataset.goto; drawFurniture(); }));
      return;
    }
    const cats = store.categories.filter((c) => all.some((f) => f.category === c.id));
    tab.innerHTML = `${filtersHTML(cats)}<div class="cards cards--pick" id="lgrid"></div>`;
    const grid = $('#lgrid', tab);
    const redraw = () => {
      const list = all.filter(matches);
      grid.innerHTML = list.map((f) => furnitureCard(f)).join('') || '<div class="empty" style="grid-column:1/-1">Aucun meuble ne correspond.</div>';
      if (q.furniture.libraryId) $(`[data-fid="${CSS.escape(q.furniture.libraryId)}"]`, grid)?.classList.add('selected');
    };
    redraw();
    bindFilters(tab, redraw);
    grid.addEventListener('click', (e) => {
      const c = e.target.closest('[data-fid]');
      const f = c && all.find((x) => x.id === c.dataset.fid);
      if (!f) return;
      if (!f.photos?.length) return toast('Ce meuble n\'a pas de photo : ajoutez-en une dans la bibliothèque.', 'err');
      useFurniture(f, 'library');
    });
  }

  function drawCatalogueTab(tab, all) {
    const have = new Map(all.map((f) => [f.id, f]));
    const cats = store.categories.filter((c) => CATALOGUE_MDF.some((x) => x.category === c.id));
    tab.innerHTML = `${filtersHTML(cats)}
      <p class="muted small">Modèles relevés sur mobilierdefrance.com. Au premier choix, la photo est téléchargée et le modèle est ajouté à votre bibliothèque.</p>
      <div class="catpick" id="cgrid"></div>`;
    const grid = $('#cgrid', tab);
    const redraw = () => {
      const list = CATALOGUE_MDF.filter(matches);
      grid.innerHTML = list.map((it) => {
        const f = have.get(it.id);
        const cover = f?.photos?.[f.cover || 0]?.media;
        return `<button class="catpick__item ${q.furniture.libraryId === it.id ? 'selected' : ''}" data-cid="${esc(it.id)}">
          <span class="catpick__img">${cover ? `<img ${src(cover)} alt="">` : '<span class="muted small">Photo au premier choix</span>'}</span>
          <span class="catpick__body"><strong>${esc(it.name)}</strong><span class="muted small">${esc(it.type)} · ${furnitureDims(it)}</span></span>
        </button>`;
      }).join('') || '<div class="empty" style="grid-column:1/-1">Aucun modèle ne correspond.</div>';
    };
    redraw();
    bindFilters(tab, redraw);
    grid.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cid]');
      const it = b && CATALOGUE_MDF.find((x) => x.id === b.dataset.cid);
      if (!it) return;
      busy(b, true, 'Téléchargement…');
      try { useFurniture(await catalogueFurniture(it), 'catalogue'); } catch (err) { toast(err.message, 'err'); busy(b, false); }
    });
  }

  function drawPhotoTab(tab) {
    const f = q.furniture;
    const own = f.source === 'photo' ? f.photos : [];
    tab.innerHTML = `
      <p class="muted">Le meuble entier, net, de face ou de trois-quarts. Une 2e photo sous un autre angle peut aider.</p>
      ${own.length ? `<div class="qthumbs">${own.map((x, i) => `<div class="thumb"><img ${src(x.media)} alt=""><div class="thumb__actions"><button title="Retirer" data-frm="${i}">✕</button></div></div>`).join('')}</div>` : ''}
      ${sourceButtons('f', { cameraLabel: own.length ? 'Autre photo' : 'Prendre une photo' })}
      <details class="qmore" ${own.length && (f.name || f.length || f.width || f.height || f.notes) ? 'open' : ''}>
        <summary>Nom et dimensions (facultatif)</summary>
        <div class="field" style="margin-top:12px"><label>Nom</label><input data-f="name" value="${esc(own.length ? f.name || '' : '')}" placeholder="Ex. Canapé 3 places Milano"></div>
        <div class="grid-3">
          <div class="field"><label>Long.</label><div class="unit" data-unit="cm"><input data-f="length" type="number" min="1" inputmode="numeric" value="${own.length ? f.length ?? '' : ''}"></div></div>
          <div class="field"><label>Prof.</label><div class="unit" data-unit="cm"><input data-f="width" type="number" min="1" inputmode="numeric" value="${own.length ? f.width ?? '' : ''}"></div></div>
          <div class="field"><label>Haut.</label><div class="unit" data-unit="cm"><input data-f="height" type="number" min="1" inputmode="numeric" value="${own.length ? f.height ?? '' : ''}"></div></div>
        </div>
        <div class="field" style="margin:0"><label>Précisions</label><input data-f="notes" value="${esc(own.length ? f.notes || '' : '')}" placeholder="Ex. pieds noirs, coussins assortis"></div>
      </details>`;
    const add = async (camera) => {
      const files = await pickImages({ camera, multiple: true });
      if (!files?.length) return;
      try {
        const added = await storeImages(files.slice(0, 3));
        // une photo remplace un meuble choisi dans la bibliothèque ou le catalogue
        if (q.furniture.source !== 'photo') q.furniture = { photos: [], source: 'photo' };
        q.furniture.photos = [...q.furniture.photos, ...added].slice(-3);
        save(); drawFurniture();
      } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-f-cam]', tab).onclick = () => add(true);
    $('[data-f-imp]', tab).onclick = () => add(false);
    $$('[data-frm]', tab).forEach((b) => (b.onclick = () => { q.furniture.photos.splice(Number(b.dataset.frm), 1); save(); drawFurniture(); }));
    $$('[data-f]', tab).forEach((inp) => inp.addEventListener('input', () => {
      if (q.furniture.source !== 'photo') return; // champs liés aux photos prises ici
      const k = inp.dataset.f;
      q.furniture[k] = inp.type === 'number' ? num(inp.value) : inp.value;
      save();
    }));
  }

  // =================================================================
  // 4. Finition : matière et consignes, puis lancement
  // =================================================================
  function drawFinish() {
    const p = photo();
    const f = q.furniture;
    body.innerHTML = `
      ${errorHTML()}
      <div class="wiz-head"><div><h2>Finition</h2><p class="muted">Facultatif : changez la matière ou donnez une consigne, puis lancez le rendu.</p></div></div>
      <div class="recap">
        <div><img ${src(p.media)} alt=""><span class="muted small">La pièce · ${q.action === 'add' ? 'ajout' : 'remplacement'}</span></div>
        <div><img ${src(f.photos[0].media)} alt=""><span class="muted small">${esc(f.name || 'Meuble photographié')}</span></div>
      </div>
      <div class="grid-2 finish">
        <section class="panel">
          <h3>Matière</h3>
          ${q.texture ? `<div class="texrow"><img ${src(q.texture.media)} alt=""><button class="btn btn--light btn--sm" data-trm>Retirer</button></div>`
            : '<p class="small">Photo d\'un tissu, d\'un cuir ou d\'un bois : le meuble sera rendu dans cette matière.</p>'}
          ${sourceButtons('t', { cameraLabel: 'Photographier' })}
          <div class="field" style="margin:0"><label>Ou en mots</label><input id="tnotes" value="${esc(q.textureNotes || '')}" placeholder="Ex. velours vert sauge"></div>
        </section>
        <section class="panel">
          <h3>Consignes pour l'IA</h3>
          <div class="field" style="margin:0"><textarea id="qextra" rows="5" placeholder="Ex. garder le tapis, ajouter un plaid beige">${esc(q.extraInstructions || '')}</textarea></div>
        </section>
      </div>`;
    const addTex = async (camera) => {
      const files = await pickImages({ camera });
      if (!files?.length) return;
      try { [q.texture] = await storeImages([files[0]]); save(); drawFinish(); } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-t-cam]', body).onclick = () => addTex(true);
    $('[data-t-imp]', body).onclick = () => addTex(false);
    $('[data-trm]', body)?.addEventListener('click', () => { delete q.texture; save(); drawFinish(); });
    $('#tnotes', body).addEventListener('input', (e) => { q.textureNotes = e.target.value; save(); });
    $('#qextra', body).addEventListener('input', (e) => { q.extraInstructions = e.target.value; save(); });
  }

  // =================================================================
  // Génération et résultat
  // =================================================================
  async function generate() {
    if (!ready() || !(await ensureAIReady())) return;
    await flush();
    const p = api.generateQuick(room.id)
      .then((r) => ({ ok: true, render: r }))
      .catch((e) => ({ ok: false, error: e.message }))
      .finally(() => setTimeout(() => pending.delete(room.id), 0));
    pending.set(room.id, p);
    run(p);
  }

  async function run(promise) {
    loading = true; error = null; step = 'result';
    draw();
    const res = await promise;
    loading = false;
    if (!view.isConnected) return; // l'utilisateur a quitté la page
    if (res.ok) {
      if (!room.renders.some((r) => r.id === res.render.id)) room.renders.unshift(res.render);
      current = room.renders.find((r) => r.id === res.render.id);
      toast('Rendu prêt !', 'ok');
    } else {
      error = res.error;
      if (!current) step = 'finish'; // pas encore de rendu : retour à la finition, avec le message
    }
    draw();
  }

  function drawLoading() {
    const p = photo();
    body.innerHTML = `
      <div class="loader" style="aspect-ratio:${p ? `${p.w}/${p.h}` : '4/3'};max-height:70vh;margin:0 auto">
        ${p ? `<img ${src(p.media)} alt="">` : ''}
        <div><div class="spinner"></div><h2>Création de votre rendu…</h2>
        <p class="muted">Cela prend généralement 20 à 60 secondes.<br><strong>Gardez l'application ouverte</strong> pendant la création.</p></div>
      </div>`;
  }

  const errorHTML = () => (error ? `<div class="alert"><strong>Le rendu a échoué.</strong><br>${esc(error)}${/Réglages|Clé API|code d'accès/i.test(error) ? ' <a href="#/reglages">Ouvrir les réglages</a>' : ''}</div>` : '');

  function drawResult() {
    if (!current) return go('finish');
    const p = photo();
    body.innerHTML = `
      ${errorHTML()}
      <div class="compare" id="cmp">
        <img ${src(p?.media || current.media)} alt="Avant">
        <div class="after" style="clip-path:inset(0 0 0 50%)"><img ${src(current.media)} alt="Après"></div>
        <span class="tag" style="left:12px">Avant</span><span class="tag" style="right:12px">Après</span>
        <div class="bar" style="left:50%"></div>
      </div>
      <p class="muted small" style="margin-top:8px">Faites glisser le curseur pour comparer avant / après.</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn ${current.saved ? '' : 'btn--ghost'} btn--sm" data-save>${current.saved ? '★ Sauvegardé' : '☆ Sauvegarder'}</button>
        <button class="btn btn--ghost btn--sm" data-dl>Enregistrer / partager l'image</button>
        <button class="btn btn--light btn--sm" data-other>Essayer un autre meuble</button>
        <button class="btn btn--danger btn--sm" data-delr>Supprimer ce rendu</button>
      </div>
      ${room.renders.length > 1 ? `<h3 style="margin-top:24px">Historique</h3>
        <div class="history">${room.renders.map((r) => `<button data-r="${r.id}" class="${r.id === current.id ? 'sel' : ''}"><img ${src(r.media)} alt="">${r.saved ? '<span class="star">★</span>' : ''}</button>`).join('')}</div>` : ''}
      <details class="prompt panel" style="margin-top:20px"><summary>Instructions envoyées à l'IA</summary><pre>${esc(current.prompt || '')}</pre></details>`;

    const cmp = $('#cmp', body);
    const after = $('.after', cmp), bar = $('.bar', cmp);
    const set = (x) => { const r = cmp.getBoundingClientRect(); const v = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)); after.style.clipPath = `inset(0 0 0 ${v}%)`; bar.style.left = v + '%'; };
    let dragging = false;
    cmp.addEventListener('pointerdown', (e) => { dragging = true; cmp.setPointerCapture(e.pointerId); set(e.clientX); });
    cmp.addEventListener('pointermove', (e) => dragging && set(e.clientX));
    cmp.addEventListener('pointerup', () => (dragging = false));

    $$('[data-r]', body).forEach((b) => (b.onclick = () => { current = room.renders.find((r) => r.id === b.dataset.r); error = null; draw(); }));
    $('[data-other]', body).onclick = () => go('furniture');
    $('[data-save]', body).onclick = async () => {
      Object.assign(current, await api.updateRender(room.id, current.id, { saved: !current.saved }));
      toast(current.saved ? 'Rendu sauvegardé' : 'Rendu retiré des sauvegardes', 'ok');
      draw();
    };
    $('[data-dl]', body).onclick = async () => {
      const blob = await getMediaBlob(current.media);
      if (!blob) return toast('Image introuvable sur cet appareil', 'err');
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      await shareOrDownload(blob, `rendu-${room.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'rapide'}.${ext}`, room.name);
    };
    $('[data-delr]', body).onclick = async () => {
      if (!(await confirmDialog('Supprimer ce rendu ?', 'Supprimer'))) return;
      await api.deleteRender(room.id, current.id);
      room.renders = room.renders.filter((r) => r.id !== current.id);
      current = room.renders[0] || null;
      if (!current) step = 'finish';
      draw();
    };
  }

  if (pending.has(room.id)) run(pending.get(room.id));
  else draw();
}
