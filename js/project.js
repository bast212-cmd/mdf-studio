// Parcours projet : 1. Pièce → 2. Plan → 3. Aménagement → 4. Rendu IA
import { api, uploadImages } from './api.js';
import { store, COLORS, TEXTURES, TEXTURE_EN } from './store.js';
import { esc, $, $$, modal, toast, confirmDialog, bindDropzone, busy, num, furnitureDims } from './ui.js';
import { capturePhotos } from './camera.js';
import { src, getMediaBlob, shareOrDownload } from './data/media.js';
import { PlanEditor, defaultPlan, clampPlan, clampItem } from './plan.js';
import { openFurnitureForm, pickFurniture } from './library.js';

const STEPS = ['La pièce', 'Le plan', 'Aménagement', 'Rendu IA'];

/** Sélecteur de photos existantes (sur iPad : « Photothèque » ; sur ordinateur : fichiers) */
function pickFromRoll() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve([...input.files].slice(0, 4));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/** Vérifie qu'une clé est renseignée et que l'appareil est en ligne avant un appel à l'IA */
async function ensureAIReady() {
  store.status = await api.status();
  if (!store.status.configured) {
    const ok = await confirmDialog("Aucune clé API n'est renseignée sur cet appareil. Ouvrir les réglages pour l'ajouter ?", 'Ouvrir les réglages', false);
    if (ok) location.hash = '#/reglages';
    return false;
  }
  if (!navigator.onLine) { toast("Pas de connexion internet : l'IA n'est pas disponible hors ligne.", 'err'); return false; }
  return true;
}
const pending = new Map(); // roomId -> Promise de génération en cours (survit à la navigation)
const uid = () => Math.random().toString(36).slice(2, 10);

export async function renderProject(view, { id, step }) {
  await store.loadCategories();

  if (id === 'nouveau') {
    const room = await api.createRoom({ name: 'Nouveau projet', category: store.categories[0]?.id || '' });
    location.replace(`#/projet/${room.id}/1`);
    return;
  }

  let room;
  try { room = await api.room(id); } catch { view.innerHTML = `<div class="empty">Projet introuvable. <a href="#/">Retour à mes projets</a></div>`; return; }
  room.plan ??= null;
  room.renders ??= [];
  step = Math.min(4, Math.max(1, Number(step) || 1));
  if (step > 1 && !room.plan) step = 1;

  // ---------- sauvegarde différée ----------
  let saveTimer = null;
  const persist = () => api.updateRoom(room.id, {
    name: room.name, category: room.category, dims: room.dims, photos: room.photos,
    refPhoto: room.refPhoto, plan: room.plan, extraInstructions: room.extraInstructions,
  }).catch((e) => toast('Sauvegarde impossible : ' + e.message, 'err'));
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); };
  const flush = async () => { clearTimeout(saveTimer); await persist(); };
  const go = async (n, extra = '') => { await flush(); location.hash = `#/projet/${room.id}/${n}${extra}`; };

  const canReach = (n) => n === 1 || (n <= 3 && room.plan) || (n === 4 && room.plan && (room.renders.length || pending.has(room.id)));

  view.innerHTML = `
    <div class="project-head">
      <div style="flex:1;min-width:240px">
        <span class="eyebrow">Projet d'aménagement</span>
        <input class="input" id="pname" value="${esc(room.name)}" style="font-family:var(--serif);font-size:28px;border:0;padding:0;background:transparent" aria-label="Nom du projet">
      </div>
      <button class="btn btn--light btn--sm" id="pdel">Supprimer le projet</button>
    </div>
    <ol class="stepper">${STEPS.map((s, i) => `
      <li><button data-step="${i + 1}" class="${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}" ${canReach(i + 1) ? '' : 'disabled'}>
        <span class="n">${i + 1}</span><span class="t">${s}</span></button></li>`).join('')}
    </ol>
    <div id="stepbody"></div>`;

  $('#pname', view).addEventListener('input', (e) => { room.name = e.target.value; save(); });
  $('#pdel', view).onclick = async () => {
    if (await confirmDialog('Supprimer définitivement ce projet et ses rendus ?', 'Supprimer')) {
      await api.deleteRoom(room.id); location.hash = '#/';
    }
  };
  $$('[data-step]', view).forEach((b) => (b.onclick = () => go(b.dataset.step)));

  const body = $('#stepbody', view);
  const ctx = { room, body, save, flush, go };
  [step1, step2, step3, step4][step - 1](ctx);
}

// =====================================================================
// ÉTAPE 1 : photos + dimensions
// =====================================================================
function step1({ room, body, save, go }) {
  body.innerHTML = `
    <div class="layout">
      <div class="panel">
        <h3>Photos de la pièce</h3>
        <p class="muted small">Ajoutez une ou plusieurs photos. La photo marquée « Vue principale » sera retouchée par l'IA : prenez-la à hauteur d'yeux, en mode paysage, pièce bien éclairée.</p>
        <div class="choice">
          <button type="button" data-cam><span class="ico">📷</span><strong>Prendre une photo</strong></button>
          <button type="button" data-imp><span class="ico">🖼️</span><strong>Importer des photos</strong></button>
        </div>
        <div class="dropzone" id="rdrop"><strong>Glissez-déposez vos photos ici</strong><span class="muted small">JPEG, PNG ou WebP</span></div>
        <input type="file" id="rfile" accept="image/*" multiple hidden>
        <div class="thumbs" id="rthumbs"></div>
      </div>
      <div class="sticky">
        <form class="panel" id="rform">
          <h3>Informations</h3>
          <div class="field"><label>Type de pièce</label>
            <select name="category">${store.categories.map((c) => `<option value="${c.id}" ${c.id === room.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label>Longueur</label><div class="unit" data-unit="cm"><input name="length" type="number" min="100" max="5000" required value="${room.dims.length ?? ''}"></div></div>
          <div class="field"><label>Largeur</label><div class="unit" data-unit="cm"><input name="width" type="number" min="100" max="5000" required value="${room.dims.width ?? ''}"></div></div>
          <div class="field"><label>Hauteur sous plafond</label><div class="unit" data-unit="cm"><input name="height" type="number" min="150" max="1000" required value="${room.dims.height ?? ''}"></div></div>
          <p class="hint muted small">Longueur = mur de gauche à droite sur le plan, largeur = profondeur de la pièce.</p>
          <button class="btn btn--block btn--lg" type="submit">Générer le plan →</button>
        </form>
      </div>
    </div>`;

  const drawThumbs = () => {
    $('#rthumbs', body).innerHTML = room.photos.map((p, i) => `
      <div class="thumb ${i === (room.refPhoto || 0) ? 'ref' : ''}">
        <img ${src(p.media)} alt="">
        ${i === (room.refPhoto || 0) ? '<span class="thumb__tag">Vue principale</span>' : ''}
        <div class="thumb__actions">
          <button type="button" title="Définir comme vue principale" data-ref="${i}">★</button>
          <button type="button" title="Supprimer" data-rm="${i}">✕</button>
        </div>
      </div>`).join('');
  };
  const add = async (files) => {
    try {
      toast('Enregistrement des photos…');
      room.photos.push(...(await uploadImages(files)));
      drawThumbs(); save();
    } catch (e) { toast(e.message, 'err'); }
  };
  drawThumbs();
  bindDropzone($('#rdrop', body), $('#rfile', body), add);
  $('[data-imp]', body).onclick = () => $('#rfile', body).click();
  $('[data-cam]', body).onclick = async () => { const s = await capturePhotos({ title: 'Photographier la pièce' }); if (s?.length) add(s); };
  $('#rthumbs', body).addEventListener('click', (e) => {
    const r = e.target.closest('[data-ref]'); const d = e.target.closest('[data-rm]');
    if (r) room.refPhoto = Number(r.dataset.ref);
    if (d) {
      const i = Number(d.dataset.rm);
      room.photos.splice(i, 1);
      if ((room.refPhoto || 0) >= room.photos.length || i === room.refPhoto) room.refPhoto = 0;
      else if (i < room.refPhoto) room.refPhoto--;
    }
    drawThumbs(); save();
  });

  const form = $('#rform', body);
  form.addEventListener('input', () => {
    room.category = form.category.value;
    room.dims = { length: num(form.length.value), width: num(form.width.value), height: num(form.height.value) };
    save();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!room.photos.length) return toast('Ajoutez au moins une photo de la pièce', 'err');
    if (!form.reportValidity()) return;
    room.plan = room.plan ? clampPlan(room.plan, room.dims) : defaultPlan(room.dims);
    go(2);
  });
}

// =====================================================================
// Outils communs aux étapes 2 et 3 (plan)
// =====================================================================
function planBlock() {
  return `
    <div class="plan-wrap">
      <div class="plan-toolbar">
        <button class="btn btn--light btn--sm" data-rot="-90" title="Pivoter de -90°">⟲ 90°</button>
        <button class="btn btn--light btn--sm" data-rot="-15">⟲ 15°</button>
        <button class="btn btn--light btn--sm" data-rot="15">15° ⟳</button>
        <button class="btn btn--light btn--sm" data-rot="90">90° ⟳</button>
        <span class="sep"></span>
        <span class="muted small">Glissez les meubles · poignée ronde = rotation · Maj = sans aimantation</span>
      </div>
      <div id="planhost"></div>
      <div class="plan-legend">
        <span><i style="background:#e4ddd1;border-color:#8a8172"></i>Meuble présent</span>
        <span><i style="background:rgba(10,61,124,.16);border-color:#0a3d7c"></i>Nouveau meuble</span>
        <span><i style="background:#f7e6e4;border-color:#b3261e;border-style:dashed"></i>Retiré / remplacé</span>
        <span><i style="background:#e08a00;border-color:#e08a00;border-radius:50%"></i>Point de vue de la photo</span>
        <span>Trait épais = face avant</span>
      </div>
    </div>`;
}

function itemPropsCommon(it) {
  return `
    <div class="grid-3">
      <div class="field"><label>Longueur</label><div class="unit" data-unit="cm"><input data-p="w" type="number" min="10" value="${Math.round(it.w)}"></div></div>
      <div class="field"><label>Prof.</label><div class="unit" data-unit="cm"><input data-p="d" type="number" min="10" value="${Math.round(it.d)}"></div></div>
      <div class="field"><label>Rotation</label><div class="unit" data-unit="°"><input data-p="rot" type="number" step="5" value="${Math.round(it.rot || 0)}"></div></div>
    </div>`;
}

function bindProps(panel, it, editor, save, onAny) {
  panel.addEventListener('input', (e) => {
    const p = e.target.dataset.p;
    if (!p) return;
    if (e.target.type === 'checkbox') it[p] = e.target.checked;
    else if (e.target.type === 'number') { const v = num(e.target.value); if (v === undefined) return; it[p] = p === 'rot' ? ((v % 360) + 360) % 360 : v; }
    else it[p] = e.target.value;
    clampItem(it, editor.L, editor.W);
    editor.render();
    save();
    onAny?.(p);
  });
}

// =====================================================================
// ÉTAPE 2 : plan de la pièce (meubles existants + point de vue)
// =====================================================================
function step2({ room, body, save, go }) {
  body.innerHTML = `
    <div class="layout">
      <div>${planBlock()}</div>
      <div class="sticky" id="side"></div>
    </div>
    <div class="footer-actions">
      <button class="btn btn--light" data-back>← La pièce</button>
      <button class="btn btn--lg" data-next>Continuer vers l'aménagement →</button>
    </div>`;

  const editor = new PlanEditor($('#planhost', body), {
    room, mode: 'existing',
    onSelect: () => side(),
    onChange: () => { save(); side(); },
  });
  $$('[data-rot]', body).forEach((b) => (b.onclick = () => editor.rotateSelected(Number(b.dataset.rot))));
  $('[data-back]', body).onclick = () => go(1);
  $('[data-next]', body).onclick = () => go(3);

  function side() {
    const sel = room.plan.items.find((i) => i.id === editor.selected && i.kind === 'existing');
    const existing = room.plan.items.filter((i) => i.kind === 'existing');
    const el = $('#side', body);
    el.innerHTML = `
      <div class="panel panel--sand">
        <h3>Point de vue</h3>
        <p class="small">Placez l'icône orange là où la <strong>vue principale</strong> a été prise et orientez-la avec la poignée ronde. L'IA s'en sert pour situer les meubles dans la photo.</p>
        <div class="thumbs" style="grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px">
          ${room.photos.map((p, i) => `<button class="thumb ${i === (room.refPhoto || 0) ? 'ref' : ''}" data-ref="${i}" style="padding:0;cursor:pointer" title="Choisir comme vue principale"><img ${src(p.media)} alt=""></button>`).join('')}
        </div>
      </div>
      ${sel ? `
      <div class="panel" id="props">
        <h3>${esc(sel.name)}</h3>
        <div class="field"><label>Nom</label><input data-p="name" value="${esc(sel.name)}"></div>
        ${itemPropsCommon(sel)}
        <label class="check"><input type="checkbox" data-p="remove" ${sel.remove ? 'checked' : ''}> Retirer ce meuble de la photo</label>
        <button class="btn btn--danger btn--sm" data-del>Supprimer du plan</button>
      </div>` : ''}
      <div class="panel">
        <h3>Meubles déjà présents</h3>
        <ul class="item-list">${existing.map((i) => `<li data-sel="${i.id}" class="${i.id === editor.selected ? 'sel' : ''}"><span class="dot" style="background:${i.remove ? '#b3261e' : '#8a8172'}"></span>${esc(i.name)}<span class="meta">${Math.round(i.w)}×${Math.round(i.d)}</span></li>`).join('') || '<li class="muted small" style="cursor:default">Aucun meuble pour l\'instant.</li>'}</ul>
        <form id="addex" class="grid-2">
          <div class="field" style="grid-column:1/-1;margin-bottom:8px"><label>Ajouter un meuble présent</label><input name="name" placeholder="Ex. Canapé, table…" required></div>
          <div class="field" style="margin-bottom:8px"><div class="unit" data-unit="cm"><input name="w" type="number" min="10" placeholder="Longueur" required></div></div>
          <div class="field" style="margin-bottom:8px"><div class="unit" data-unit="cm"><input name="d" type="number" min="10" placeholder="Profondeur" required></div></div>
          <div class="field" style="grid-column:1/-1"><button class="btn btn--ghost btn--sm btn--block">Ajouter au plan</button></div>
        </form>
        <button class="btn btn--light btn--block btn--sm" data-ai>✨ Détecter les meubles sur mes photos (IA)</button>
      </div>`;

    el.querySelectorAll('[data-ref]').forEach((b) => (b.onclick = () => { room.refPhoto = Number(b.dataset.ref); save(); side(); }));
    el.querySelectorAll('[data-sel]').forEach((li) => (li.onclick = () => editor.select(li.dataset.sel)));
    if (sel) {
      bindProps($('#props', el), sel, editor, save, (p) => { if (p === 'name' || p === 'remove') { editor.render(); } });
      $('[data-del]', el).onclick = () => {
        room.plan.items = room.plan.items.filter((i) => i.id !== sel.id);
        room.plan.items.forEach((i) => { if (i.replacesId === sel.id) delete i.replacesId; });
        editor.select(null); save();
      };
    }
    $('#addex', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const it = { id: 'e' + uid(), kind: 'existing', name: f.name.value.trim(), w: num(f.w.value), d: num(f.d.value), h: 80, x: room.dims.length / 2, y: room.dims.width / 2, rot: 0 };
      clampItem(it, room.dims.length, room.dims.width);
      room.plan.items.push(it);
      save(); editor.select(it.id);
    });
    $('[data-ai]', el).onclick = async (e) => {
      if (!(await ensureAIReady())) return;
      if (room.plan.items.some((i) => i.kind === 'existing') && !(await confirmDialog('Remplacer les meubles présents du plan par ceux détectés par l\'IA ?', 'Remplacer', false))) return;
      busy(e.target, true, 'Analyse des photos…');
      try {
        await persist(room);
        const out = await api.analyzeRoom(room.id);
        const keepNew = room.plan.items.filter((i) => i.kind === 'new');
        keepNew.forEach((i) => delete i.replacesId);
        room.plan.items = [...out.items, ...keepNew];
        if (out.camera) room.plan.camera = out.camera;
        save(); editor.select(null);
        toast(`${out.items.length} meuble(s) détecté(s). Ajustez leur position si besoin.`, 'ok');
      } catch (err) { toast(err.message, 'err'); busy(e.target, false); }
    };
  }
  side();
}

const persist = (room) => api.updateRoom(room.id, { plan: room.plan, refPhoto: room.refPhoto, dims: room.dims, photos: room.photos });

// =====================================================================
// ÉTAPE 3 : ajout / remplacement de meubles + couleur et matière
// =====================================================================
function step3({ room, body, save, flush, go }) {
  const furnCache = new Map();
  const getF = async (id) => {
    if (!id) return null;
    if (!furnCache.has(id)) furnCache.set(id, await api.getFurniture(id).catch(() => null));
    return furnCache.get(id);
  };
  const preselect = new URLSearchParams(location.hash.split('?')[1] || '').get('item');

  body.innerHTML = `
    <div class="layout">
      <div>${planBlock()}</div>
      <div class="sticky" id="side"></div>
    </div>
    <div class="footer-actions">
      <button class="btn btn--light" data-back>← Le plan</button>
      <button class="btn btn--lg" data-gen>Valider et générer l'image ✨</button>
    </div>`;

  const editor = new PlanEditor($('#planhost', body), {
    room, mode: 'new',
    onSelect: () => side(),
    onChange: () => {
      save();
      const it = room.plan.items.find((i) => i.id === editor.selected);
      const r = $('#props [data-p=rot]', body);
      if (it && r) r.value = Math.round(it.rot || 0);
    },
  });
  $$('[data-rot]', body).forEach((b) => (b.onclick = () => { editor.rotateSelected(Number(b.dataset.rot)); side(); }));
  $('[data-back]', body).onclick = () => go(2);

  const generate = async (btn) => {
    const news = room.plan.items.filter((i) => i.kind === 'new');
    const removals = room.plan.items.some((i) => i.kind === 'existing' && i.remove);
    if (!news.length && !removals && !room.extraInstructions?.trim()) return toast('Ajoutez au moins un meuble à intégrer', 'err');
    if (!(await ensureAIReady())) return;
    busy(btn, true, 'Préparation…');
    await flush();
    startGeneration(room);
    go(4);
  };
  $('[data-gen]', body).onclick = (e) => generate(e.target);

  async function addFurniture(f, forcedReplace) {
    if (!f || f === 'deleted') return;
    furnCache.set(f.id, f);
    const existing = room.plan.items.filter((i) => i.kind === 'existing' && !room.plan.items.some((n) => n.replacesId === i.id));
    let replacesId = forcedReplace || null;
    if (!forcedReplace && existing.length) {
      replacesId = await new Promise((resolve) => {
        let r;
        const m = modal({
          title: 'Comment placer ce meuble ?',
          onClose: () => resolve(r),
          content: `
            <p><strong>${esc(f.name)}</strong> <span class="muted">· ${furnitureDims(f)}</span></p>
            <div class="choice" style="grid-template-columns:1fr">
              <button data-free><span class="ico">✥</span><strong>Le placer librement</strong><span class="small muted">Vous le déplacez où vous voulez sur le plan</span></button>
            </div>
            <h3 style="margin-top:20px">Ou remplacer un meuble existant</h3>
            <div class="choice">${existing.map((e) => `<button data-rep="${e.id}"><span class="ico">⇄</span><strong>${esc(e.name)}</strong><span class="small muted">${Math.round(e.w)}×${Math.round(e.d)} cm</span></button>`).join('')}</div>`,
        });
        m.el.querySelector('[data-free]').onclick = () => { r = null; m.close(); };
        m.el.querySelectorAll('[data-rep]').forEach((b) => (b.onclick = () => { r = b.dataset.rep; m.close(); }));
      });
    }
    const it = {
      id: 'n' + uid(), kind: 'new', furnitureId: f.id, name: f.name,
      w: f.length || 100, d: f.width || 60, h: f.height || 80,
      x: room.dims.length / 2, y: room.dims.width / 2, rot: 0, keepOriginal: true,
    };
    const rep = replacesId && room.plan.items.find((i) => i.id === replacesId);
    if (rep) { it.x = rep.x; it.y = rep.y; it.rot = rep.rot || 0; it.replacesId = rep.id; }
    else {
      // orienté face à l'appareil photo
      const c = room.plan.camera;
      const vx = c.x - it.x, vy = c.y - it.y;
      it.rot = (Math.round((Math.atan2(-vx, vy) * 180) / Math.PI / 15) * 15 + 360) % 360;
    }
    clampItem(it, room.dims.length, room.dims.width);
    room.plan.items.push(it);
    save();
    editor.select(it.id);
  }

  async function side() {
    const el = $('#side', body);
    const news = room.plan.items.filter((i) => i.kind === 'new');
    const sel = news.find((i) => i.id === editor.selected);
    const existing = room.plan.items.filter((i) => i.kind === 'existing');
    const f = sel ? await getF(sel.furnitureId) : null;
    if (sel && editor.selected !== sel.id) return; // sélection changée entre-temps
    const selEx = existing.find((i) => i.id === editor.selected);
    const replacer = selEx && news.find((n) => n.replacesId === selEx.id);

    el.innerHTML = `
      <div class="panel">
        <h3>Ajouter un meuble</h3>
        <div class="choice choice--3">
          <button data-shoot><span class="ico">📷</span><strong>Photo en direct</strong></button>
          <button data-roll><span class="ico">🖼️</span><strong>Pellicule</strong></button>
          <button data-lib><span class="ico">📚</span><strong>Bibliothèque</strong></button>
        </div>
        ${news.length ? `<ul class="item-list" style="margin-top:12px">${news.map((i) => `<li data-sel="${i.id}" class="${i.id === editor.selected ? 'sel' : ''}"><span class="dot" style="background:${i.keepOriginal ? '#0a3d7c' : i.color || '#0a3d7c'}"></span>${esc(i.name)}<span class="meta">${i.replacesId ? 'remplace' : 'libre'}</span></li>`).join('')}</ul>` : '<p class="muted small" style="margin-top:12px">Aucun nouveau meuble. Ajoutez-en un, puis placez-le sur le plan.</p>'}
      </div>
      ${sel ? selPanel(sel, f, existing) : ''}
      ${selEx ? `<div class="panel panel--sand">
        <h3>${esc(selEx.name)}</h3>
        ${replacer ? `<p class="small">Remplacé par <strong>${esc(replacer.name)}</strong>.</p><button class="btn btn--light btn--sm" data-sel="${replacer.id}">Voir le nouveau meuble</button>`
          : `<p class="small">Meuble présent dans la pièce. Remplacez-le par un meuble :</p>
        <div class="choice choice--3"><button data-repshoot><span class="ico">📷</span><strong>Photo en direct</strong></button><button data-reproll><span class="ico">🖼️</span><strong>Pellicule</strong></button><button data-replib><span class="ico">📚</span><strong>Bibliothèque</strong></button></div>`}
      </div>` : ''}
      <div class="panel panel--sand">
        <h3>Instructions pour l'IA</h3>
        <div class="field" style="margin:0"><textarea id="extra" placeholder="Optionnel. Ex. : ajouter un plaid beige sur le canapé, garder le tapis.">${esc(room.extraInstructions || '')}</textarea></div>
      </div>`;

    el.querySelectorAll('[data-sel]').forEach((li) => (li.onclick = () => editor.select(li.dataset.sel)));
    $('[data-lib]', el).onclick = async () => addFurniture(await pickFurniture({ category: room.category }));
    $('[data-shoot]', el).onclick = async () => {
      const shots = await capturePhotos({ title: 'Photographier le meuble à intégrer' });
      if (!shots?.length) return;
      addFurniture(await openFurnitureForm({ defaults: { category: room.category }, files: shots }));
    };
    // Photo(s) déjà prises : pellicule de l'iPad / dossier de l'ordinateur
    const fromRoll = async (replaceId) => {
      const files = await pickFromRoll();
      if (files.length) addFurniture(await openFurnitureForm({ defaults: { category: room.category }, files }), replaceId);
    };
    $('[data-roll]', el).onclick = () => fromRoll();
    $('[data-reproll]', el)?.addEventListener('click', () => fromRoll(selEx.id));
    $('#extra', el).addEventListener('input', (e) => { room.extraInstructions = e.target.value; save(); });
    $('[data-replib]', el)?.addEventListener('click', async () => addFurniture(await pickFurniture({ category: room.category }), selEx.id));
    $('[data-repshoot]', el)?.addEventListener('click', async () => {
      const shots = await capturePhotos({ title: 'Photographier le meuble à intégrer' });
      if (shots?.length) addFurniture(await openFurnitureForm({ defaults: { category: room.category }, files: shots }), selEx.id);
    });

    if (!sel) return;
    const panel = $('#props', el);
    bindProps(panel, sel, editor, save, (p) => {
      if (p === 'keepOriginal') { panel.querySelector('#look').classList.toggle('hidden', sel.keepOriginal); }
      if (p === 'replacesId') {
        const rep = room.plan.items.find((i) => i.id === sel.replacesId);
        if (rep) { sel.x = rep.x; sel.y = rep.y; sel.rot = rep.rot || 0; clampItem(sel, editor.L, editor.W); }
        if (!sel.replacesId) delete sel.replacesId;
        editor.render(); save(); side();
      }
    });
    panel.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => {
      sel.color = b.dataset.color; sel.colorName = b.title; sel.keepOriginal = false; save(); side();
    }));
    $('#cpick', panel).addEventListener('change', (e) => { sel.color = e.target.value; sel.colorName = ''; sel.keepOriginal = false; save(); side(); });
    panel.querySelectorAll('[data-tex]').forEach((b) => (b.onclick = () => {
      const t = b.dataset.tex;
      if (sel.texture === t) { delete sel.texture; delete sel.textureEn; } else { sel.texture = t; sel.textureEn = TEXTURE_EN[t] || t; }
      sel.keepOriginal = false; save(); side();
    }));
    $('#texfile', panel).addEventListener('change', async (e) => {
      if (!e.target.files.length) return;
      try { const [p] = await uploadImages(e.target.files); sel.textureImage = p.media; sel.keepOriginal = false; save(); side(); }
      catch (err) { toast(err.message, 'err'); }
    });
    $('[data-rmtex]', panel)?.addEventListener('click', () => { delete sel.textureImage; save(); side(); });
    $('[data-edit]', panel)?.addEventListener('click', async () => {
      const res = await openFurnitureForm({ furniture: f });
      if (res && res !== 'deleted') {
        furnCache.set(res.id, res);
        sel.name = res.name;
        if (res.length) sel.w = res.length;
        if (res.width) sel.d = res.width;
        clampItem(sel, editor.L, editor.W); editor.render(); save(); side();
      }
    });
    $('[data-swap]', panel).onclick = async () => {
      const nf = await pickFurniture({ category: room.category });
      if (!nf || nf === 'deleted') return;
      furnCache.set(nf.id, nf);
      Object.assign(sel, { furnitureId: nf.id, name: nf.name, w: nf.length || sel.w, d: nf.width || sel.d, h: nf.height || sel.h });
      clampItem(sel, editor.L, editor.W); editor.render(); save(); side();
    };
    $('[data-del]', panel).onclick = () => { room.plan.items = room.plan.items.filter((i) => i.id !== sel.id); save(); editor.select(null); };
  }

  function selPanel(sel, f, existing) {
    const cover = f?.photos?.[f.cover || 0]?.media;
    const taken = new Set(room.plan.items.filter((i) => i.kind === 'new' && i.id !== sel.id && i.replacesId).map((i) => i.replacesId));
    return `
      <div class="panel" id="props">
        <div style="display:flex;gap:14px;align-items:center;margin-bottom:16px">
          <div style="width:84px;aspect-ratio:4/3;background:var(--sand);flex:none">${cover ? `<img ${src(cover)} style="width:100%;height:100%;object-fit:cover">` : ''}</div>
          <div><strong>${esc(sel.name)}</strong><div class="muted small">${f ? furnitureDims(f) : 'Meuble supprimé de la bibliothèque'}</div>
            <div class="btn-row" style="gap:6px;margin-top:6px">${f ? '<button class="btn btn--light btn--sm" data-edit>Fiche</button>' : ''}<button class="btn btn--light btn--sm" data-swap>Changer</button></div></div>
        </div>
        <div class="field"><label>Placement</label>
          <select data-p="replacesId">
            <option value="">Placement libre</option>
            ${existing.filter((e) => !taken.has(e.id)).map((e) => `<option value="${e.id}" ${sel.replacesId === e.id ? 'selected' : ''}>Remplace : ${esc(e.name)}</option>`).join('')}
          </select></div>
        ${itemPropsCommon(sel)}
        <h3 style="margin-top:8px">Couleur et matière</h3>
        <label class="check"><input type="checkbox" data-p="keepOriginal" ${sel.keepOriginal ? 'checked' : ''}> Conserver le coloris d'origine</label>
        <div id="look" class="${sel.keepOriginal ? 'hidden' : ''}">
          <div class="swatches">${COLORS.map((c) => `<button class="swatch ${sel.color === c.hex ? 'sel' : ''}" style="background:${c.hex}" title="${c.name}" data-color="${c.hex}"></button>`).join('')}</div>
          <div class="color-row" style="margin-bottom:14px"><input type="color" id="cpick" value="${sel.color || '#9b8b7a'}"><span class="small">${sel.color ? `Choisi : <strong>${esc(sel.colorName || sel.color)}</strong>` : 'Couleur personnalisée'}</span></div>
          <div class="textures">${TEXTURES.map((t) => `<button class="texture ${sel.texture === t.name ? 'sel' : ''}" data-tex="${t.name}"><div class="sw" style="background:${t.css}"></div>${t.name}</button>`).join('')}</div>
          <div class="field">
            <label>Échantillon de matière (photo)</label>
            ${sel.textureImage ? `<div style="display:flex;gap:10px;align-items:center"><img ${src(sel.textureImage)} style="width:60px;height:45px;object-fit:cover"><button class="btn btn--light btn--sm" data-rmtex>Retirer</button></div>` : ''}
            <input type="file" id="texfile" accept="image/*">
          </div>
        </div>
        <div class="field"><label>Précisions</label><input data-p="notes" value="${esc(sel.notes || '')}" placeholder="Ex. coussins assortis, pieds noirs"></div>
        <button class="btn btn--danger btn--sm" data-del>Retirer ce meuble</button>
      </div>`;
  }

  if (preselect && room.plan.items.some((i) => i.id === preselect)) editor.select(preselect);
  else side();
}

// =====================================================================
// ÉTAPE 4 : génération et résultat
// =====================================================================
function startGeneration(room) {
  const p = api.generate(room.id, room.extraInstructions || '')
    .then((r) => ({ ok: true, render: r }))
    .catch((e) => ({ ok: false, error: e.message }))
    .finally(() => setTimeout(() => pending.delete(room.id), 0));
  pending.set(room.id, p);
  return p;
}

async function step4({ room, body, go }) {
  const ref = room.photos[room.refPhoto || 0] || room.photos[0];
  let current = room.renders[0] || null;
  let error = null;

  const draw = (loading) => {
    if (loading) {
      body.innerHTML = `
        <div class="loader" style="aspect-ratio:${ref ? `${ref.w}/${ref.h}` : '4/3'};max-height:70vh;margin:0 auto">
          ${ref ? `<img ${src(ref.media)} alt="">` : ''}
          <div><div class="spinner"></div><h2>Création de votre rendu…</h2>
          <p class="muted">L'IA intègre vos meubles dans la photo de la pièce.<br>Cela prend généralement 20 à 60 secondes.<br><strong>Gardez l'application ouverte</strong> pendant la création.</p></div>
        </div>`;
      return;
    }
    body.innerHTML = `
      ${error ? `<div class="alert"><strong>La génération a échoué.</strong><br>${esc(error)}${/Réglages|Clé API/i.test(error) ? ' <a href="#/reglages">Ouvrir les réglages</a>' : ''}</div>` : ''}
      <div class="layout">
        <div>
          ${current ? `
            <div class="compare" id="cmp">
              <img ${src(ref?.media || current.media)} alt="Avant">
              <div class="after" style="clip-path:inset(0 0 0 50%)"><img ${src(current.media)} alt="Après"></div>
              <span class="tag" style="left:12px">Avant</span><span class="tag" style="right:12px">Après</span>
              <div class="bar" style="left:50%"></div>
            </div>
            <p class="muted small" style="margin-top:8px">Faites glisser le curseur pour comparer avant / après.</p>`
            : '<div class="empty">Aucun rendu pour le moment.</div>'}
          ${room.renders.length > 1 ? `
            <h3 style="margin-top:28px">Historique des rendus</h3>
            <div class="history">${room.renders.map((r) => `<button data-r="${r.id}" class="${r.id === current?.id ? 'sel' : ''}" title="${new Date(r.createdAt).toLocaleString('fr-FR')}"><img ${src(r.media)} alt="">${r.saved ? '<span class="star">★</span>' : ''}</button>`).join('')}</div>` : ''}
        </div>
        <div class="sticky">
          ${current ? `
          <div class="panel">
            <h3>Votre rendu</h3>
            <p class="muted small">Généré le ${new Date(current.createdAt).toLocaleString('fr-FR')}${current.saved ? ' · <strong style="color:var(--blue)">Sauvegardé</strong>' : ''}</p>
            <div style="display:grid;gap:10px">
              <button class="btn btn--block" data-save>${current.saved ? '★ Sauvegardé (retirer)' : '☆ Sauvegarder le rendu'}</button>
              <button class="btn btn--ghost btn--block" data-dl>Enregistrer / partager l'image</button>
              <button class="btn btn--light btn--block" data-layout>Modifier l'aménagement</button>
              <button class="btn btn--light btn--block" data-furn>Modifier le meuble (couleur, matière…)</button>
              <button class="btn btn--light btn--block" data-again>↻ Générer une autre version</button>
              ${current.planSnapshot ? '<button class="btn btn--light btn--block btn--sm" data-restore>Reprendre l\'aménagement de ce rendu</button>' : ''}
              <button class="btn btn--danger btn--block btn--sm" data-delr>Supprimer ce rendu</button>
            </div>
          </div>
          <details class="prompt panel"><summary>Instructions envoyées à l'IA</summary><pre>${esc(current.prompt || '')}</pre></details>`
          : `<div class="panel"><button class="btn btn--block" data-again>Lancer la génération</button><button class="btn btn--light btn--block" style="margin-top:10px" data-layout>Modifier l'aménagement</button></div>`}
        </div>
      </div>`;
    bind();
  };

  function bind() {
    const cmp = $('#cmp', body);
    if (cmp) {
      const after = $('.after', cmp), bar = $('.bar', cmp);
      const set = (clientX) => {
        const r = cmp.getBoundingClientRect();
        const p = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
        after.style.clipPath = `inset(0 0 0 ${p}%)`; bar.style.left = p + '%';
      };
      let dragging = false;
      cmp.addEventListener('pointerdown', (e) => { dragging = true; cmp.setPointerCapture(e.pointerId); set(e.clientX); });
      cmp.addEventListener('pointermove', (e) => dragging && set(e.clientX));
      cmp.addEventListener('pointerup', () => (dragging = false));
    }
    $$('[data-r]', body).forEach((b) => (b.onclick = () => { current = room.renders.find((r) => r.id === b.dataset.r); error = null; draw(); }));
    $('[data-layout]', body)?.addEventListener('click', () => go(3));
    $('[data-furn]', body)?.addEventListener('click', () => {
      const first = room.plan.items.find((i) => i.kind === 'new');
      go(3, first ? `?item=${first.id}` : '');
    });
    $('[data-again]', body)?.addEventListener('click', async () => { if (await ensureAIReady()) run(startGeneration(room)); });
    $('[data-dl]', body)?.addEventListener('click', async () => {
      const blob = await getMediaBlob(current.media);
      if (!blob) return toast('Image introuvable sur cet appareil', 'err');
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      const name = `amenagement-${room.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'rendu'}.${ext}`;
      await shareOrDownload(blob, name, room.name);
    });
    $('[data-save]', body)?.addEventListener('click', async () => {
      const r = await api.updateRender(room.id, current.id, { saved: !current.saved });
      Object.assign(current, r);
      toast(r.saved ? 'Rendu sauvegardé dans le projet' : 'Rendu retiré des sauvegardes', 'ok');
      draw();
    });
    $('[data-restore]', body)?.addEventListener('click', async () => {
      if (!(await confirmDialog("Remplacer l'aménagement actuel par celui de ce rendu ?", 'Reprendre', false))) return;
      room.plan = structuredClone(current.planSnapshot);
      await api.updateRoom(room.id, { plan: room.plan });
      go(3);
    });
    $('[data-delr]', body)?.addEventListener('click', async () => {
      if (!(await confirmDialog('Supprimer ce rendu ?', 'Supprimer'))) return;
      await api.deleteRender(room.id, current.id);
      room.renders = room.renders.filter((r) => r.id !== current.id);
      current = room.renders[0] || null;
      draw();
    });
  }

  async function run(promise) {
    error = null;
    draw(true);
    const res = await promise;
    if (!body.isConnected) return; // l'utilisateur a quitté la page
    if (res.ok) { if (!room.renders.some((r) => r.id === res.render.id)) room.renders.unshift(res.render); current = room.renders.find((r) => r.id === res.render.id); toast('Rendu prêt !', 'ok'); }
    else error = res.error;
    draw();
  }

  if (pending.has(room.id)) run(pending.get(room.id));
  else draw();
}
