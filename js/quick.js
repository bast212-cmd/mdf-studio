// Rendu rapide : photo de la pièce → zone → photo du meuble → texture (facultative) → rendu
import { api } from './api.js';
import { store } from './store.js';
import { esc, $, $$, toast, confirmDialog, busy, num } from './ui.js';
import { capturePhotos } from './camera.js';
import { src, storeImages, getMediaBlob, shareOrDownload } from './data/media.js';

const pending = new Map(); // roomId -> Promise de génération (survit à la navigation)

async function ensureAIReady() {
  store.status = await api.status();
  if (!store.status.configured) {
    if (await confirmDialog("Aucune clé API n'est renseignée sur cet appareil. Ouvrir les réglages pour l'ajouter ?", 'Ouvrir les réglages', false)) location.hash = '#/reglages';
    return false;
  }
  if (!navigator.onLine) { toast("Pas de connexion internet : l'IA n'est pas disponible hors ligne.", 'err'); return false; }
  return true;
}

/** Choix « prendre une photo » ou « importer » ; résout avec une liste de fichiers */
function pickImages({ camera, multiple = false, title }) {
  if (camera) return capturePhotos({ title });
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

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

  // ---------- sauvegarde différée ----------
  let saveTimer = null;
  const persist = () => api.updateRoom(room.id, { name: room.name, photos: room.photos, quick: room.quick, mode: 'quick' })
    .catch((e) => toast('Sauvegarde impossible : ' + e.message, 'err'));
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 400); };
  const flush = async () => { clearTimeout(saveTimer); await persist(); };

  let current = room.renders[0] || null;
  let showResult = Boolean(current) || pending.has(room.id);
  let loading = false;
  let tool = 'zone'; // 'zone' : zone du nouveau meuble · 'keep' : objets à garder devant
  let error = null;

  view.innerHTML = `
    <div class="project-head">
      <div style="flex:1;min-width:240px">
        <span class="eyebrow">Rendu rapide</span>
        <input class="input" id="pname" value="${esc(room.name)}" style="font-family:var(--serif);font-size:28px;border:0;padding:0;background:transparent" aria-label="Nom du projet">
      </div>
      <button class="btn btn--light btn--sm" id="pdel">Supprimer</button>
    </div>
    <div class="layout quick">
      <div id="stage"></div>
      <div class="sticky" id="steps"></div>
    </div>`;
  $('#pname', view).addEventListener('input', (e) => { room.name = e.target.value; save(); });
  $('#pdel', view).onclick = async () => {
    if (await confirmDialog('Supprimer définitivement ce projet et ses rendus ?', 'Supprimer')) { await api.deleteRoom(room.id); location.hash = '#/'; }
  };
  const stage = $('#stage', view);
  const steps = $('#steps', view);

  const photo = () => room.photos?.[0] || null;
  const ready = () => photo() && q.zone && q.furniture.photos.length;

  // =================================================================
  // Colonne de droite : les étapes
  // =================================================================
  function drawSteps() {
    const p = photo();
    const fp = q.furniture.photos;
    const f = q.furniture;
    steps.innerHTML = `
      <div class="panel qstep ${p ? 'done' : 'todo'}">
        <h3><span class="n">1</span>Photo de la pièce</h3>
        ${p ? '<p class="small muted">Photo ajoutée. Vous pouvez la remplacer.</p>' : '<p class="small">Prise à hauteur d\'yeux, en mode paysage, pièce bien éclairée.</p>'}
        <div class="choice"><button data-room-cam><span class="ico">📷</span><strong>Prendre</strong></button><button data-room-imp><span class="ico">🖼️</span><strong>Importer</strong></button></div>
      </div>

      <div class="panel qstep ${q.zone ? 'done' : p ? 'todo' : 'off'}">
        <h3><span class="n">2</span>La zone</h3>
        ${p ? `<p class="small">${q.zone ? 'Zone tracée. Glissez-la pour la déplacer, ou tracez-en une nouvelle.' : '<strong>Tracez un rectangle sur la photo</strong> à l\'endroit où placer le meuble.'}</p>
          <p class="small muted">Le meuble doit passer <strong>derrière</strong> un autre (table basse, fauteuil…) ? Choisissez « Objet devant, à garder » au-dessus de la photo et entourez cet objet.${(q.keep || []).length ? ` <strong>${q.keep.length} objet(s) gardé(s) devant.</strong>` : ''}</p>
          <div class="seg">
            <button data-action="replace" class="${q.action !== 'add' ? 'sel' : ''}">Remplacer ce qui s'y trouve</button>
            <button data-action="add" class="${q.action === 'add' ? 'sel' : ''}">Ajouter sans rien retirer</button>
          </div>` : '<p class="small muted">Ajoutez d\'abord la photo de la pièce.</p>'}
      </div>

      <div class="panel qstep ${fp.length ? 'done' : 'todo'}">
        <h3><span class="n">3</span>Photo du meuble</h3>
        ${fp.length ? `<div class="qthumbs">${fp.map((x, i) => `<div class="thumb"><img ${src(x.media)} alt=""><div class="thumb__actions"><button title="Retirer" data-frm="${i}">✕</button></div></div>`).join('')}</div>` : '<p class="small">Le meuble entier, net, de face ou de trois-quarts. Une 2e photo sous un autre angle peut aider.</p>'}
        <div class="choice"><button data-f-cam><span class="ico">📷</span><strong>Prendre</strong></button><button data-f-imp><span class="ico">🖼️</span><strong>Importer</strong></button></div>
        <details class="qmore" ${f.name || f.length || f.width || f.height || f.notes ? 'open' : ''}>
          <summary>Nom et dimensions (facultatif)</summary>
          <div class="field" style="margin-top:12px"><label>Nom</label><input data-f="name" value="${esc(f.name || '')}" placeholder="Ex. Canapé 3 places Milano"></div>
          <div class="grid-3">
            <div class="field"><label>Long.</label><div class="unit" data-unit="cm"><input data-f="length" type="number" min="1" value="${f.length ?? ''}"></div></div>
            <div class="field"><label>Prof.</label><div class="unit" data-unit="cm"><input data-f="width" type="number" min="1" value="${f.width ?? ''}"></div></div>
            <div class="field"><label>Haut.</label><div class="unit" data-unit="cm"><input data-f="height" type="number" min="1" value="${f.height ?? ''}"></div></div>
          </div>
          <div class="field" style="margin:0"><label>Précisions</label><input data-f="notes" value="${esc(f.notes || '')}" placeholder="Ex. pieds noirs, coussins assortis"></div>
        </details>
      </div>

      <div class="panel qstep ${q.texture ? 'done' : 'opt'}">
        <h3><span class="n">4</span>Texture <span class="muted small" style="text-transform:none;letter-spacing:0;font-weight:400">· facultatif</span></h3>
        ${q.texture ? `<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px"><img ${src(q.texture.media)} alt="" style="width:84px;height:63px;object-fit:cover"><button class="btn btn--light btn--sm" data-trm>Retirer</button></div>`
          : '<p class="small">Photo d\'un tissu, d\'un cuir ou d\'un bois : le meuble sera rendu dans cette matière.</p>'}
        <div class="choice"><button data-t-cam><span class="ico">📷</span><strong>Prendre</strong></button><button data-t-imp><span class="ico">🖼️</span><strong>Importer</strong></button></div>
        <div class="field" style="margin:0"><label>Matière ou couleur en mots</label><input id="tnotes" value="${esc(q.textureNotes || '')}" placeholder="Ex. velours vert sauge"></div>
      </div>

      <div class="panel panel--sand">
        <div class="field"><label>Instructions pour l'IA (facultatif)</label><textarea id="qextra" placeholder="Ex. garder le tapis, ajouter un plaid beige">${esc(q.extraInstructions || '')}</textarea></div>
        <button class="btn btn--block btn--lg" data-gen ${ready() && !loading ? '' : 'disabled'}>${loading ? 'Création en cours…' : current ? '↻ Relancer le rendu ✨' : 'Lancer le rendu ✨'}</button>
        ${!ready() ? `<p class="muted small" style="margin:10px 0 0">Il manque : ${[!p && 'la photo de la pièce', p && !q.zone && 'la zone', !fp.length && 'la photo du meuble'].filter(Boolean).join(', ')}.</p>` : ''}
      </div>`;

    const addRoom = async (camera) => {
      const files = await pickImages({ camera, title: 'Photographier la pièce' });
      if (!files?.length) return;
      try {
        const [ph] = await storeImages([files[0]]);
        if (photo() && q.zone && !(await confirmDialog('Remplacer la photo de la pièce ? La zone tracée sera effacée.', 'Remplacer', false))) return;
        room.photos = [ph];
        delete q.zone;
        delete q.keep;
        showResult = false;
        save(); drawAll();
      } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-room-cam]', steps).onclick = () => addRoom(true);
    $('[data-room-imp]', steps).onclick = () => addRoom(false);

    $$('[data-action]', steps).forEach((b) => (b.onclick = () => { q.action = b.dataset.action; save(); drawSteps(); }));

    const addFurn = async (camera) => {
      const files = await pickImages({ camera, multiple: true, title: 'Photographier le meuble' });
      if (!files?.length) return;
      try { q.furniture.photos.push(...(await storeImages(files.slice(0, 3)))); q.furniture.photos = q.furniture.photos.slice(-3); save(); drawSteps(); } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-f-cam]', steps).onclick = () => addFurn(true);
    $('[data-f-imp]', steps).onclick = () => addFurn(false);
    $$('[data-frm]', steps).forEach((b) => (b.onclick = () => { q.furniture.photos.splice(Number(b.dataset.frm), 1); save(); drawSteps(); }));
    $$('[data-f]', steps).forEach((inp) => inp.addEventListener('input', () => {
      const k = inp.dataset.f;
      q.furniture[k] = inp.type === 'number' ? num(inp.value) : inp.value;
      save();
    }));

    const addTex = async (camera) => {
      const files = await pickImages({ camera, title: 'Photographier la matière' });
      if (!files?.length) return;
      try { [q.texture] = await storeImages([files[0]]); save(); drawSteps(); } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-t-cam]', steps).onclick = () => addTex(true);
    $('[data-t-imp]', steps).onclick = () => addTex(false);
    $('[data-trm]', steps)?.addEventListener('click', () => { delete q.texture; save(); drawSteps(); });
    $('#tnotes', steps).addEventListener('input', (e) => { q.textureNotes = e.target.value; save(); });
    $('#qextra', steps).addEventListener('input', (e) => { q.extraInstructions = e.target.value; save(); });

    $('[data-gen]', steps).onclick = async () => {
      if (!ready() || !(await ensureAIReady())) return;
      await flush();
      const p = api.generateQuick(room.id)
        .then((r) => ({ ok: true, render: r }))
        .catch((e) => ({ ok: false, error: e.message }))
        .finally(() => setTimeout(() => pending.delete(room.id), 0));
      pending.set(room.id, p);
      run(p);
    };
  }

  // =================================================================
  // Colonne de gauche : photo + zone, ou résultat
  // =================================================================
  function drawStage() {
    const p = photo();
    if (loading) {
      stage.innerHTML = `
        <div class="loader" style="aspect-ratio:${p ? `${p.w}/${p.h}` : '4/3'};max-height:70vh;margin:0 auto">
          ${p ? `<img ${src(p.media)} alt="">` : ''}
          <div><div class="spinner"></div><h2>Création de votre rendu…</h2>
          <p class="muted">Cela prend généralement 20 à 60 secondes.<br><strong>Gardez l'application ouverte</strong> pendant la création.</p></div>
        </div>`;
      return;
    }
    if (showResult && current) return drawResult();
    if (!p) {
      stage.innerHTML = `<div class="dropzone qempty" data-drop><strong>Commencez par la photo de la pièce</strong><span class="muted small">Touchez « Prendre » ou « Importer » à droite, ou déposez une image ici.</span></div>`;
      const z = $('[data-drop]', stage);
      z.onclick = () => $('[data-room-imp]', steps).click();
      ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('drag'); }));
      z.addEventListener('drop', async (e) => {
        const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
        if (f) { room.photos = await storeImages([f]); delete q.zone; save(); drawAll(); }
      });
      return;
    }
    const keep = q.keep || [];
    stage.innerHTML = `
      ${error ? `<div class="alert"><strong>Le rendu a échoué.</strong><br>${esc(error)}${/Réglages|Clé API/i.test(error) ? ' <a href="#/reglages">Ouvrir les réglages</a>' : ''}</div>` : ''}
      <div class="seg tools" style="margin-bottom:10px">
        <button data-tool="zone" class="${tool === 'zone' ? 'sel' : ''}">▭ Zone du nouveau meuble</button>
        <button data-tool="keep" class="${tool === 'keep' ? 'sel keep' : ''}">▭ Objet devant, à garder</button>
      </div>
      <div class="zone-editor ${tool === 'keep' ? 'tool-keep' : ''}" id="zed">
        <img ${src(p.media)} alt="Photo de la pièce" draggable="false">
        <div class="zone ${q.zone ? '' : 'hidden'}"><span>${q.action === 'add' ? 'Ajouter ici' : 'Remplacer ici'}</span></div>
        ${keep.map((k, i) => `<div class="keepbox" style="left:${k.x * 100}%;top:${k.y * 100}%;width:${k.w * 100}%;height:${k.h * 100}%"><span>Devant</span><button data-krm="${i}" aria-label="Retirer">×</button></div>`).join('')}
      </div>
      <div class="btn-row" style="margin-top:10px;justify-content:space-between">
        <span class="muted small">${tool === 'keep'
          ? 'Entourez chaque objet qui doit rester <strong>devant</strong> le nouveau meuble (table basse, fauteuil, plante…). Il ne sera ni retiré ni modifié.'
          : 'Tracez la zone avec le doigt ou la souris, y compris la partie du meuble cachée derrière un autre objet.'}</span>
        <span class="btn-row">
          ${q.zone ? '<button class="btn btn--light btn--sm" data-zclear>Effacer la zone</button>' : ''}
          ${current ? '<button class="btn btn--ghost btn--sm" data-showres>Voir le rendu</button>' : ''}
        </span>
      </div>`;
    bindZone($('#zed', stage));
    $$('[data-tool]', stage).forEach((b) => (b.onclick = () => { tool = b.dataset.tool; drawStage(); }));
    $('[data-zclear]', stage)?.addEventListener('click', () => { delete q.zone; save(); drawAll(); });
    $('[data-showres]', stage)?.addEventListener('click', () => { showResult = true; drawStage(); });
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
      if (rm) { q.keep.splice(Number(rm.dataset.krm), 1); save(); drawAll(); return; }
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
      if (wasDraw) drawAll();
    };
    ed.addEventListener('pointerup', end);
    ed.addEventListener('pointercancel', end);
  }

  function drawResult() {
    const p = photo();
    stage.innerHTML = `
      ${error ? `<div class="alert"><strong>Le rendu a échoué.</strong><br>${esc(error)}</div>` : ''}
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
        <button class="btn btn--light btn--sm" data-edit>Modifier la zone</button>
        <button class="btn btn--danger btn--sm" data-delr>Supprimer ce rendu</button>
      </div>
      ${room.renders.length > 1 ? `<h3 style="margin-top:24px">Historique</h3>
        <div class="history">${room.renders.map((r) => `<button data-r="${r.id}" class="${r.id === current.id ? 'sel' : ''}"><img ${src(r.media)} alt="">${r.saved ? '<span class="star">★</span>' : ''}</button>`).join('')}</div>` : ''}
      <details class="prompt panel" style="margin-top:20px"><summary>Instructions envoyées à l'IA</summary><pre>${esc(current.prompt || '')}</pre></details>`;

    const cmp = $('#cmp', stage);
    const after = $('.after', cmp), bar = $('.bar', cmp);
    const set = (x) => { const r = cmp.getBoundingClientRect(); const v = Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100)); after.style.clipPath = `inset(0 0 0 ${v}%)`; bar.style.left = v + '%'; };
    let dragging = false;
    cmp.addEventListener('pointerdown', (e) => { dragging = true; cmp.setPointerCapture(e.pointerId); set(e.clientX); });
    cmp.addEventListener('pointermove', (e) => dragging && set(e.clientX));
    cmp.addEventListener('pointerup', () => (dragging = false));

    $$('[data-r]', stage).forEach((b) => (b.onclick = () => { current = room.renders.find((r) => r.id === b.dataset.r); error = null; drawStage(); }));
    $('[data-edit]', stage).onclick = () => { showResult = false; error = null; drawStage(); };
    $('[data-save]', stage).onclick = async () => {
      Object.assign(current, await api.updateRender(room.id, current.id, { saved: !current.saved }));
      toast(current.saved ? 'Rendu sauvegardé' : 'Rendu retiré des sauvegardes', 'ok');
      drawStage();
    };
    $('[data-dl]', stage).onclick = async () => {
      const blob = await getMediaBlob(current.media);
      if (!blob) return toast('Image introuvable sur cet appareil', 'err');
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg';
      await shareOrDownload(blob, `rendu-${room.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'rapide'}.${ext}`, room.name);
    };
    $('[data-delr]', stage).onclick = async () => {
      if (!(await confirmDialog('Supprimer ce rendu ?', 'Supprimer'))) return;
      await api.deleteRender(room.id, current.id);
      room.renders = room.renders.filter((r) => r.id !== current.id);
      current = room.renders[0] || null;
      showResult = Boolean(current);
      drawAll();
    };
  }

  async function run(promise) {
    loading = true; error = null; showResult = true;
    drawAll();
    const res = await promise;
    loading = false;
    if (!view.isConnected) return; // l'utilisateur a quitté la page
    if (res.ok) {
      if (!room.renders.some((r) => r.id === res.render.id)) room.renders.unshift(res.render);
      current = room.renders.find((r) => r.id === res.render.id);
      toast('Rendu prêt !', 'ok');
    } else {
      error = res.error;
      showResult = false; // retour à la zone, avec le message d'erreur
    }
    drawAll();
  }

  function drawAll() { drawStage(); drawSteps(); }

  if (pending.has(room.id)) run(pending.get(room.id));
  else drawAll();
}
