// Rendu rapide, en écrans successifs (pensé pour l'iPad) :
// la pièce → le meuble (catalogue, bibliothèque ou photo) → finition → résultat ; l'IA choisit l'emplacement du meuble
import { api } from './api.js';
import { store } from './store.js';
import { esc, $, $$, toast, confirmDialog, busy, num, furnitureDims, modal } from './ui.js';
import { src, storeImages, getMediaBlob, shareOrDownload } from './data/media.js';
import { furnitureCard } from './library.js';
import { catalogueFurniture } from './catalogue.js';
import { CATALOGUE_MDF } from './data/catalogue-mdf.js';
import { providerConfig } from './ai/providers/index.js';
import { fetchCatalogueImage } from './ai/providers/gemini.js';

const pending = new Map(); // roomId -> Promise de génération (survit à la navigation)

// Vignettes du catalogue, récupérées par le relais à l'affichage (4 à la fois), gardées pour la session
const thumbs = new Map(); // url -> Promise<objectURL | ''>
let thumbActive = 0;
const thumbWaiting = [];
function catalogueThumb(url, cfg) {
  if (!thumbs.has(url)) {
    thumbs.set(url, new Promise((resolve) => {
      const run = async () => {
        thumbActive++;
        try { resolve(URL.createObjectURL(await fetchCatalogueImage(url, cfg))); } catch { resolve(''); thumbs.delete(url); }
        thumbActive--;
        thumbWaiting.shift()?.();
      };
      if (thumbActive < 4) run(); else thumbWaiting.push(run);
    }));
  }
  return thumbs.get(url);
}
const thumbUrl = (it) => (it.photoUrls || []).find((u) => /home_default/.test(u)) || it.photoUrls?.at(-1);

const STEPS = [
  { id: 'room', label: 'La pièce' },
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

/**
 * Appareil photo natif de l'iPad (camera) ou pellicule ; résout avec une liste de fichiers.
 * La pellicule est toujours ouverte en sélection multiple : sur iPad, la sélection simple affiche
 * un écran d'aperçu blanc à valider avant de revenir à l'application.
 */
function pickImages({ camera, multiple = false }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.capture = 'environment';
    else input.multiple = true;
    input.onchange = () => { const files = [...input.files]; resolve(multiple ? files : files.slice(0, 1)); };
    input.click();
  });
}

/** Voile « Préparation de la photo… » pendant la conversion des images (photos lourdes de l'iPad) */
async function preparing(task) {
  const el = document.createElement('div');
  el.className = 'preparing';
  el.innerHTML = '<div><div class="spinner"></div><p>Préparation de la photo…</p></div>';
  document.body.appendChild(el);
  try { return await task(); } finally { el.remove(); }
}

const MAX_ITEMS = 3; // meubles par rendu (ensemble)

const loadBitmap = async (id) => { const b = id && (await getMediaBlob(id)); return b ? createImageBitmap(b) : null; };
const canvasJpeg = (c) => new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.92));

/** Rendu converti en JPEG (format le mieux accepté par l'app Photos) */
async function toJpeg(blob) {
  if (!blob || blob.type === 'image/jpeg') return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  return canvasJpeg(c);
}

/** Avant / après côte à côte en une seule image, avec la mention du magasin et « visuel généré par IA » */
async function beforeAfterBlob(beforeId, afterId) {
  const [a, b] = await Promise.all([loadBitmap(beforeId), loadBitmap(afterId)]);
  if (!a || !b) return null;
  const h = Math.min(a.height, b.height, 1600);
  const wa = Math.round((a.width * h) / a.height), wb = Math.round((b.width * h) / b.height);
  const gap = Math.round(h * 0.015), band = Math.round(h * 0.075), pad = Math.round(band * 0.35);
  const c = document.createElement('canvas');
  c.width = wa + gap + wb; c.height = h + band;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(a, 0, 0, wa, h);
  g.drawImage(b, wa + gap, 0, wb, h);
  g.fillStyle = '#1d2740'; g.textBaseline = 'middle';
  g.font = `600 ${Math.round(band * 0.38)}px Montserrat, sans-serif`;
  g.fillText('AVANT', pad, h + band / 2);
  g.fillText('APRÈS', wa + gap + pad, h + band / 2);
  g.textAlign = 'right';
  g.font = `400 ${Math.round(band * 0.3)}px Montserrat, sans-serif`;
  g.fillText('Mobilier de France Brest-Morlaix · visuel généré par IA', c.width - pad, h + band / 2);
  return canvasJpeg(c);
}

const sourceButtons = (prefix, { cameraLabel = 'Prendre une photo', libraryLabel = 'Pellicule', big = false } = {}) => `
  <div class="choice ${big ? 'choice--big' : ''}">
    <button data-${prefix}-cam><span class="ico">📷</span><strong>${cameraLabel}</strong></button>
    <button data-${prefix}-imp><span class="ico">🖼️</span><strong>${libraryLabel}</strong></button>
  </div>`;

export async function renderQuick(view, { id }) {
  if (!id || id === 'nouveau') {
    const room = await api.createRoom({ name: 'Rendu rapide', mode: 'quick', quick: { items: [] } });
    location.replace(`#/rapide/${room.id}`);
    return;
  }
  let room;
  try { room = await api.room(id); } catch { view.innerHTML = '<div class="empty">Projet introuvable. <a href="#/">Retour à mes projets</a></div>'; return; }
  room.quick ??= { items: [] };
  room.renders ??= [];
  const q = room.quick;
  // un ou plusieurs meubles (ensemble) ; les anciens projets n'en avaient qu'un, dans q.furniture
  q.items ??= q.furniture?.photos?.length ? [q.furniture] : [];
  // plus de zone tracée : l'IA choisit l'emplacement (on oublie celle des anciens projets)
  delete q.furniture; delete q.zone; delete q.keep; delete q.action;
  await store.loadCategories();

  // ---------- sauvegarde différée ----------
  let saveTimer = null;
  const persist = () => api.updateRoom(room.id, { name: room.name, photos: room.photos, quick: room.quick, mode: 'quick' })
    .catch((e) => toast('Sauvegarde impossible : ' + e.message, 'err'));
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };
  const flush = async () => { clearTimeout(saveTimer); await persist(); };

  const photo = () => room.photos?.[0] || null;
  const hasFurniture = () => q.items.length > 0;
  const ready = () => photo() && hasFurniture();
  const reachable = (s) => ({ room: true, furniture: Boolean(photo()), finish: Boolean(ready()), result: Boolean(current) })[s];

  let current = room.renders[0] || null;
  let loading = false;
  let error = null;
  let furnTab = 'catalogue'; // 'catalogue' · 'library' (catalogue du magasin) · 'photo'
  const filter = { q: '', category: '' };
  // écran d'arrivée : le résultat s'il existe, sinon la première étape à faire
  let step = current || pending.has(room.id) ? 'result' : !photo() ? 'room' : !hasFurniture() ? 'furniture' : 'finish';

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
    const doneOf = { room: Boolean(photo()), furniture: hasFurniture(), finish: Boolean(current), result: false };
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
    else if (step === 'result') next = `<button class="btn btn--lg" data-regen>↻ Relancer le rendu ✨</button>`;
    else {
      const ok = reachable(STEPS[idx + 1].id);
      const missing = { room: 'Ajoutez la photo de la pièce', furniture: 'Choisissez un meuble' }[step];
      next = `<span class="wiz-next">${ok ? '' : `<span class="muted small">${missing}</span>`}<button class="btn btn--lg" data-next ${ok ? '' : 'disabled'}>Suivant ›</button></span>`;
    }
    nav.innerHTML = backBtn + next;
    $('[data-back]', nav)?.addEventListener('click', () => go(back));
    $('[data-next]', nav)?.addEventListener('click', () => go(STEPS[idx + 1].id));
    $('[data-gen]', nav)?.addEventListener('click', () => generate());
    $('[data-regen]', nav)?.addEventListener('click', askRevision);
  }

  function draw() {
    drawSteps();
    drawNav();
    if (loading) return drawLoading();
    ({ room: drawRoom, furniture: drawFurniture, finish: drawFinish, result: drawResult })[step]();
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
    const setRoom = (ph) => {
      room.photos = [ph];
      save();
      go(hasFurniture() ? 'finish' : 'furniture');
    };
    const add = async (camera) => {
      const files = await pickImages({ camera });
      if (!files?.length) return;
      try { const [ph] = await preparing(() => storeImages([files[0]])); setRoom(ph); } catch (e) { toast(e.message, 'err'); }
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
  // 2. Le meuble : catalogue MDF, catalogue du magasin ou photo ; jusqu'à 3 meubles (ensemble)
  // =================================================================
  // Copie des photos et cotes d'un modèle (les images sont partagées avec le catalogue, pas dupliquées)
  const itemFrom = (f, source) => {
    const ph = [...(f.photos || [])];
    if (f.cover) ph.unshift(...ph.splice(f.cover, 1));
    return {
      photos: ph.slice(0, 3).map(({ media, w, h }) => ({ media, w, h })),
      name: f.name || '', type: f.type || '', length: f.length, width: f.width, height: f.height, notes: f.notes || '',
      libraryId: f.id, source,
    };
  };
  const isSelected = (id) => q.items.some((x) => x.libraryId === id);
  const tooMany = () => toast(`${MAX_ITEMS} meubles au maximum par rendu : retirez-en un d'abord.`, 'err');

  // Un toucher ajoute le modèle à la sélection, un second le retire
  const toggleFurniture = (f, source) => {
    const i = q.items.findIndex((x) => x.libraryId === f.id);
    if (i >= 0) {
      q.items.splice(i, 1);
      toast(`${f.name} retiré de la sélection`);
    } else if (q.items.length >= MAX_ITEMS) {
      return tooMany();
    } else {
      q.items.push(itemFrom(f, source));
      toast(q.items.length > 1 ? `${f.name} ajouté : ensemble de ${q.items.length} meubles` : `${f.name} sélectionné`, 'ok');
    }
    save();
    drawSelection();
  };

  const selectionHTML = () => (q.items.length
    ? `<div class="selbar">${q.items.map((it, i) => `
        <div class="selitem"><img ${src(it.photos[0].media)} alt="">
          <div><strong>${esc(it.name || 'Meuble photographié')}</strong>
          <div class="muted small">${it.length || it.width || it.height ? furnitureDims(it) : `${it.photos.length} photo(s)`}</div></div>
          <button class="selitem__rm" data-unsel="${i}" aria-label="Retirer ${esc(it.name || 'ce meuble')}">×</button></div>`).join('')}
        <span class="muted small selcount">${q.items.length} / ${MAX_ITEMS}</span></div>`
    : `<p class="muted small selhint">Touchez un modèle pour le choisir. Pour un ensemble (canapé, table basse, fauteuil…), choisissez-en jusqu'à ${MAX_ITEMS}.</p>`);

  // Met à jour la sélection, les cartes cochées, les étapes et le bouton Suivant, sans redessiner la liste
  function drawSelection() {
    const sel = $('#sel', body);
    if (!sel) return;
    sel.innerHTML = selectionHTML();
    $$('[data-unsel]', sel).forEach((b) => (b.onclick = () => {
      q.items.splice(Number(b.dataset.unsel), 1);
      save();
      if (furnTab === 'photo') drawFurniture(); else drawSelection();
    }));
    $$('[data-fid]', body).forEach((c) => c.classList.toggle('selected', isSelected(c.dataset.fid)));
    $$('[data-cid]', body).forEach((c) => c.classList.toggle('selected', isSelected(c.dataset.cid)));
    drawSteps();
    drawNav();
  }

  async function drawFurniture() {
    const all = await api.furniture();
    if (!view.isConnected || step !== 'furniture') return;
    const tabs = [['catalogue', 'Catalogue MDF'], ['library', `Catalogue du magasin <span class="muted">(${all.length})</span>`], ['photo', 'Photo du meuble']];
    body.innerHTML = `
      <div class="wiz-head"><div><h2>Le meuble</h2><p class="muted">Choisissez un ou plusieurs modèles du catalogue, ou photographiez le meuble.</p></div></div>
      <div id="sel"></div>
      <div class="seg tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${furnTab === k ? 'sel' : ''}">${l}</button>`).join('')}</div>
      <div id="tab"></div>`;
    $$('[data-tab]', body).forEach((b) => (b.onclick = () => { furnTab = b.dataset.tab; drawFurniture(); }));
    const tab = $('#tab', body);
    if (furnTab === 'library') drawLibraryTab(tab, all);
    else if (furnTab === 'catalogue') drawCatalogueTab(tab, all);
    else drawPhotoTab(tab);
    drawSelection();
  }

  // Filtres : pièce, puis type de meuble de cette pièce (seuls ceux présents dans la liste sont proposés)
  const typeOptions = (items) => {
    const inRoom = items.filter((x) => !filter.category || x.category === filter.category);
    const order = store.categories.flatMap((c) => c.types || []);
    const types = [...new Set(inRoom.map((x) => x.type).filter(Boolean))]
      .sort((a, b) => ((order.indexOf(a) + 1) || 999) - ((order.indexOf(b) + 1) || 999) || a.localeCompare(b));
    if (!types.includes(filter.type)) filter.type = '';
    return `<option value="">Tous les types</option>${types.map((t) => `<option ${t === filter.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}`;
  };
  const filtersHTML = (items) => {
    const cats = store.categories.filter((c) => items.some((x) => x.category === c.id));
    if (!cats.some((c) => c.id === filter.category)) filter.category = '';
    return `
    <div class="filters">
      <select class="input" data-cat><option value="">Toutes les pièces</option>${cats.map((c) => `<option value="${c.id}" ${c.id === filter.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select class="input" data-type>${typeOptions(items)}</select>
      <input class="input" data-q placeholder="Rechercher…" value="${esc(filter.q)}" type="search">
    </div>`;
  };
  const bindFilters = (el, items, redraw) => {
    $('[data-q]', el).addEventListener('input', (e) => { filter.q = e.target.value; redraw(); });
    $('[data-cat]', el).onchange = (e) => { filter.category = e.target.value; filter.type = ''; $('[data-type]', el).innerHTML = typeOptions(items); redraw(); };
    $('[data-type]', el).onchange = (e) => { filter.type = e.target.value; redraw(); };
  };
  const matches = (x) => (!filter.category || x.category === filter.category)
    && (!filter.type || x.type === filter.type)
    && (!filter.q || [x.name, x.type, x.reference].join(' ').toLowerCase().includes(filter.q.toLowerCase()));

  function drawLibraryTab(tab, all) {
    if (!all.length) {
      tab.innerHTML = `<div class="empty">Le catalogue du magasin est vide. Choisissez un modèle dans le <button class="linklike" data-goto="catalogue">catalogue Mobilier de France</button>, ou <button class="linklike" data-goto="photo">photographiez le meuble</button>.</div>`;
      $$('[data-goto]', tab).forEach((b) => (b.onclick = () => { furnTab = b.dataset.goto; drawFurniture(); }));
      return;
    }
    tab.innerHTML = `${filtersHTML(all)}<div class="cards cards--pick" id="lgrid"></div>`;
    const grid = $('#lgrid', tab);
    const redraw = () => {
      const list = all.filter(matches);
      grid.innerHTML = list.map((f) => furnitureCard(f)).join('') || '<div class="empty" style="grid-column:1/-1">Aucun meuble ne correspond.</div>';
      $$('[data-fid]', grid).forEach((c) => c.classList.toggle('selected', isSelected(c.dataset.fid)));
    };
    redraw();
    bindFilters(tab, all, redraw);
    grid.addEventListener('click', (e) => {
      const c = e.target.closest('[data-fid]');
      const f = c && all.find((x) => x.id === c.dataset.fid);
      if (!f) return;
      if (!f.photos?.length) return toast('Ce meuble n\'a pas de photo : ajoutez-en une dans le catalogue du magasin.', 'err');
      toggleFurniture(f, 'library');
    });
  }

  function drawCatalogueTab(tab, all) {
    const have = new Map(all.map((f) => [f.id, f]));
    tab.innerHTML = `${filtersHTML(CATALOGUE_MDF)}
      <p class="muted small">Modèles relevés sur mobilierdefrance.com. Au premier choix, la photo est téléchargée et le modèle est ajouté au catalogue du magasin.</p>
      <div class="catpick" id="cgrid"></div>`;
    const grid = $('#cgrid', tab);
    // vignettes absentes du catalogue du magasin : chargées par le relais quand elles apparaissent à l'écran
    const cfgP = api.settings().then((s) => providerConfig(s, 'gemini'));
    const io = new IntersectionObserver((entries) => entries.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const u = await catalogueThumb(en.target.dataset.thumb, await cfgP);
      if (u && en.target.isConnected) en.target.innerHTML = `<img src="${u}" alt="">`;
      else if (en.target.isConnected) en.target.innerHTML = '<span class="muted small">Photo indisponible</span>';
    }), { rootMargin: '200px' });
    const redraw = () => {
      io.disconnect();
      const list = CATALOGUE_MDF.filter(matches);
      grid.innerHTML = list.map((it) => {
        const f = have.get(it.id);
        const cover = f?.photos?.[f.cover || 0]?.media;
        const url = !cover && thumbUrl(it);
        return `<button class="catpick__item ${isSelected(it.id) ? 'selected' : ''}" data-cid="${esc(it.id)}">
          <span class="catpick__img" ${url ? `data-thumb="${esc(url)}"` : ''}>${cover ? `<img ${src(cover)} alt="">` : '<span class="spinner spinner--sm"></span>'}</span>
          <span class="catpick__body"><strong>${esc(it.name)}</strong><span class="muted small">${esc(it.type)} · ${furnitureDims(it)}</span></span>
        </button>`;
      }).join('') || '<div class="empty" style="grid-column:1/-1">Aucun modèle ne correspond.</div>';
      $$('[data-thumb]', grid).forEach((el) => io.observe(el));
    };
    redraw();
    bindFilters(tab, CATALOGUE_MDF, redraw);
    grid.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-cid]');
      const it = b && CATALOGUE_MDF.find((x) => x.id === b.dataset.cid);
      if (!it || b.disabled) return;
      if (isSelected(it.id)) return toggleFurniture(it, 'catalogue');
      if (q.items.length >= MAX_ITEMS) return tooMany();
      // premier choix d'un modèle : sa photo est téléchargée (la vignette reste affichée)
      const title = $('.catpick__body strong', b);
      b.disabled = true;
      title.textContent = 'Téléchargement…';
      try { toggleFurniture(await catalogueFurniture(it), 'catalogue'); } catch (err) { toast(err.message, 'err'); }
      title.textContent = it.name;
      b.disabled = false;
    });
  }

  // Photo : chaque import crée un meuble de la sélection ; la fiche porte sur le dernier meuble photographié
  function drawPhotoTab(tab) {
    const cur = [...q.items].reverse().find((x) => x.source === 'photo') || null;
    tab.innerHTML = `
      <p class="muted">Le meuble entier, net, de face ou de trois-quarts. Depuis la pellicule, vous pouvez choisir 2 ou 3 photos du même meuble.</p>
      ${sourceButtons('f')}
      ${cur ? `<div class="panel photoitem">
        <h3>Meuble photographié</h3>
        <div class="qthumbs">${cur.photos.map((x, i) => `<div class="thumb"><img ${src(x.media)} alt=""><div class="thumb__actions"><button title="Retirer" data-frm="${i}">✕</button></div></div>`).join('')}</div>
        <div class="field"><label>Nom (facultatif)</label><input data-f="name" value="${esc(cur.name || '')}" placeholder="Ex. Canapé 3 places TINO"></div>
        <div class="grid-3">
          <div class="field"><label>Long.</label><div class="unit" data-unit="cm"><input data-f="length" type="number" min="1" inputmode="numeric" value="${cur.length ?? ''}"></div></div>
          <div class="field"><label>Prof.</label><div class="unit" data-unit="cm"><input data-f="width" type="number" min="1" inputmode="numeric" value="${cur.width ?? ''}"></div></div>
          <div class="field"><label>Haut.</label><div class="unit" data-unit="cm"><input data-f="height" type="number" min="1" inputmode="numeric" value="${cur.height ?? ''}"></div></div>
        </div>
        <div class="field" style="margin:0"><label>Précisions</label><input data-f="notes" value="${esc(cur.notes || '')}" placeholder="Ex. pieds noirs, coussins assortis"></div>
      </div>` : ''}`;
    const add = async (camera) => {
      if (q.items.length >= MAX_ITEMS) return tooMany();
      const files = await pickImages({ camera, multiple: true });
      if (!files?.length) return;
      try {
        const photos = await preparing(() => storeImages(files.slice(0, 3)));
        q.items.push({ photos, name: '', source: 'photo' });
        save();
        drawFurniture(); // fiche du meuble photographié, sélection et bouton Suivant à jour
      } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-f-cam]', tab).onclick = () => add(true);
    $('[data-f-imp]', tab).onclick = () => add(false);
    if (!cur) return;
    $$('[data-frm]', tab).forEach((b) => (b.onclick = () => {
      cur.photos.splice(Number(b.dataset.frm), 1);
      if (!cur.photos.length) q.items.splice(q.items.indexOf(cur), 1);
      save(); drawFurniture();
    }));
    $$('[data-f]', tab).forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.f;
      cur[k] = inp.type === 'number' ? num(inp.value) : inp.value;
      save();
    }));
  }

  // =================================================================
  // 3. Finition : matière et consignes, puis lancement
  // =================================================================
  function drawFinish() {
    const p = photo();
    const main = q.items[0];
    const many = q.items.length > 1;
    body.innerHTML = `
      ${errorHTML()}
      <div class="wiz-head"><div><h2>Finition</h2><p class="muted">Facultatif : changez la matière ou donnez une consigne, puis lancez le rendu.</p></div></div>
      <div class="recap">
        <div><img ${src(p.media)} alt=""><span class="muted small">La pièce</span></div>
        ${q.items.map((it) => `<div><img ${src(it.photos[0].media)} alt=""><span class="muted small">${esc(it.name || 'Meuble photographié')}</span></div>`).join('')}
      </div>
      <div class="grid-2 finish">
        <section class="panel">
          <h3>Matière${many ? ` <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">· ${esc(main.name || 'premier meuble')}</span>` : ''}</h3>
          ${q.texture ? `<div class="texrow"><img ${src(q.texture.media)} alt=""><button class="btn btn--light btn--sm" data-trm>Retirer</button></div>`
            : `<p class="small">Photo d'un tissu, d'un cuir ou d'un bois : ${many ? `« ${esc(main.name || 'le premier meuble')} » sera rendu` : 'le meuble sera rendu'} dans cette matière.</p>`}
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
      try { [q.texture] = await preparing(() => storeImages([files[0]])); save(); drawFinish(); } catch (e) { toast(e.message, 'err'); }
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
  // Relance depuis le résultat : consigne de correction facultative, valable pour ce nouveau rendu seulement
  function askRevision() {
    const m = modal({
      title: 'Relancer le rendu',
      content: `<p class="small">Que faut-il changer par rapport au rendu actuel ? Facultatif : laissez vide pour simplement relancer.</p>
        <div class="field" style="margin:0"><textarea id="rev" rows="4" placeholder="Ex. le canapé plus à gauche, garder le tapis, tissu un peu plus clair"></textarea></div>`,
      footer: '<button class="btn btn--light" data-close>Annuler</button><button class="btn" data-go>Relancer le rendu ✨</button>',
    });
    const ta = $('#rev', m.el);
    ta.focus();
    $('[data-go]', m.el).onclick = () => { const note = ta.value.trim(); m.close(); generate(note); };
  }

  async function generate(revision = '') {
    if (!ready() || !(await ensureAIReady())) return;
    if (revision) q.revision = revision; else delete q.revision;
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
      startCheck(current); // garde-fou : contrôle du rendu en tâche de fond
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

  // ---------- Garde-fou : contrôle du rendu par l'IA (meubles présents et fidèles au catalogue) ----------
  const checking = new Set(); // rendus en cours de contrôle
  function startCheck(r) {
    if (!r || r.check || checking.has(r.id)) return;
    checking.add(r.id);
    api.checkQuick(room.id, r.id)
      .then((c) => { if (c) r.check = c; })
      .catch((e) => { r.check = { verdict: 'error', summary: e.message }; })
      .finally(() => {
        checking.delete(r.id);
        if (view.isConnected && step === 'result' && !loading && current?.id === r.id) drawResult();
      });
  }

  function checkHTML(r) {
    if (checking.has(r.id)) return '<div class="check check--run"><span class="spinner spinner--sm"></span> Contrôle du rendu : les meubles sont-ils fidèles au catalogue ?</div>';
    const c = r.check;
    if (!c) return '<div class="check"><button class="btn btn--light btn--sm" data-check>Contrôler ce rendu</button> <span class="muted small">Vérifie que les meubles sont fidèles aux photos du catalogue.</span></div>';
    if (c.verdict === 'error') return `<div class="check check--warn">Contrôle impossible : ${esc(c.summary)} <button class="btn btn--light btn--sm" data-check>Réessayer</button></div>`;
    if (c.verdict === 'ok') return `<div class="check check--ok">✓ Contrôle : ${esc(c.summary || 'meubles fidèles au catalogue.')}</div>`;
    const issues = c.items.filter((x) => !x.present || !x.faithful)
      .map((x) => `<li><strong>${esc(x.name)}</strong> : ${esc(x.issue || (x.present ? 'quelques différences avec le modèle du catalogue' : "peu visible sur l'image"))}</li>`).join('')
      + (c.otherChanges ? `<li>${esc(c.otherChanges)}</li>` : '');
    return `<div class="check check--warn"><strong>Rendu légèrement différent du catalogue.</strong> ${esc(c.summary)}
      ${issues ? `<ul>${issues}</ul>` : ''}
      <button class="btn btn--sm" data-fix>↻ Affiner le rendu</button></div>`;
  }

  function drawResult() {
    if (!current) return go('finish');
    const p = photo();
    body.innerHTML = `
      ${errorHTML()}
      ${checkHTML(current)}
      <div class="btn-row result-actions">
        <button class="btn ${current.saved ? '' : 'btn--ghost'} btn--sm" data-save>${current.saved ? '★ Sauvegardé' : '☆ Sauvegarder'}</button>
        <button class="btn btn--ghost btn--sm" data-dl>Enregistrer dans Photos</button>
        ${photo() ? '<button class="btn btn--ghost btn--sm" data-dlba>Avant / après dans Photos</button>' : ''}
        <button class="btn btn--light btn--sm" data-other>Essayer un autre meuble</button>
        <button class="btn btn--danger btn--sm" data-delr>Supprimer ce rendu</button>
        <span class="muted small result-hint">Glissez sur l'image pour comparer avant / après</span>
      </div>
      <div class="compare" id="cmp">
        <img ${src(p?.media || current.media)} alt="Avant">
        <div class="after" style="clip-path:inset(0 0 0 50%)"><img ${src(current.media)} alt="Après"></div>
        <span class="tag" style="left:12px">Avant</span><span class="tag" style="right:12px">Après</span>
        <div class="bar" style="left:50%"></div>
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
    cmp.addEventListener('pointercancel', () => (dragging = false)); // glissé vertical : la page défile

    $$('[data-r]', body).forEach((b) => (b.onclick = () => { current = room.renders.find((r) => r.id === b.dataset.r); error = null; draw(); }));
    $('[data-other]', body).onclick = () => go('furniture');
    $('[data-check]', body)?.addEventListener('click', () => { if (current.check?.verdict === 'error') delete current.check; startCheck(current); drawResult(); });
    $('[data-fix]', body)?.addEventListener('click', () => generate(current.check?.correction || current.check?.summary || ''));
    $('[data-save]', body).onclick = async () => {
      Object.assign(current, await api.updateRender(room.id, current.id, { saved: !current.saved }));
      toast(current.saved ? 'Rendu sauvegardé' : 'Rendu retiré des sauvegardes', 'ok');
      draw();
    };
    // Enregistrement dans l'app Photos : sur iPad, la feuille de partage propose « Enregistrer l'image »
    const base = `rendu-${room.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'rapide'}`;
    const toPhotos = async (btn, makeBlob, filename) => {
      busy(btn, true, 'Préparation…');
      try {
        const blob = await makeBlob();
        if (!blob) return toast('Image introuvable sur cet appareil', 'err');
        if (navigator.canShare) toast("Choisissez « Enregistrer l'image » pour l'ajouter à Photos", 'ok');
        await shareOrDownload(blob, filename, room.name, 'share');
      } catch (e) { toast(e.message, 'err'); } finally { busy(btn, false); }
    };
    $('[data-dl]', body).onclick = (e) => toPhotos(e.currentTarget, async () => toJpeg(await getMediaBlob(current.media)), `${base}.jpg`);
    $('[data-dlba]', body).onclick = (e) => toPhotos(e.currentTarget, () => beforeAfterBlob(photo()?.media, current.media), `${base}-avant-apres.jpg`);
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
