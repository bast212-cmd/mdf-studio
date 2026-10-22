// Import d'une sélection du catalogue Mobilier de France dans la bibliothèque
import { api, now } from './api.js';
import { idb } from './data/db.js';
import { storeImages } from './data/media.js';
import { store } from './store.js';
import { esc, modal, toast, busy, furnitureDims } from './ui.js';
import { CATALOGUE_MDF, CATALOGUE_DATE } from './data/catalogue-mdf.js';
import { providerConfig } from './ai/providers/index.js';
import { fetchCatalogueImage } from './ai/providers/gemini.js';

/** Télécharge la première photo disponible d'un modèle ; renvoie [{media,w,h}] ou [] */
async function downloadPhoto(item, cfg) {
  for (const url of item.photoUrls || []) {
    try { return await storeImages([await fetchCatalogueImage(url, cfg)]); } catch { /* taille suivante */ }
  }
  return [];
}

/** Ajoute les pièces et types du catalogue absents des catégories */
async function ensureCategories(items) {
  const cats = structuredClone(await api.categories());
  let changed = false;
  for (const it of items) {
    let c = cats.find((x) => x.id === it.category);
    if (!c) { c = { id: it.category, name: it.category, types: [] }; cats.push(c); changed = true; }
    if (it.type && !c.types.includes(it.type)) { c.types.push(it.type); changed = true; }
  }
  if (changed) await api.saveCategories(cats);
  await store.loadCategories();
}

export async function catalogueDialog() {
  await store.loadCategories();
  const existing = new Map((await api.furniture()).map((f) => [f.id, f]));
  const status = (it) => {
    const f = existing.get(it.id);
    if (!f) return 'new';
    return f.photos?.length ? 'have' : 'nophoto';
  };
  const groups = store.categories
    .map((c) => ({ c, items: CATALOGUE_MDF.filter((x) => x.category === c.id) }))
    .filter((g) => g.items.length);

  return new Promise((resolve) => {
    let imported = false;
    const m = modal({
      title: 'Catalogue Mobilier de France',
      wide: true,
      onClose: () => resolve(imported),
      content: `
        <p class="small">Sélection de ${CATALOGUE_MDF.length} modèles relevés sur mobilierdefrance.com (${new Date(CATALOGUE_DATE).toLocaleDateString('fr-FR')}), avec leurs cotes et une photo.
          Les photos sont récupérées par le relais : il faut une connexion internet et le code d'accès renseigné dans les Réglages.
          Les modèles déjà présents ne sont pas dupliqués ; vos modifications sont conservées.</p>
        <div class="btn-row" style="margin:12px 0">
          <button class="btn btn--light btn--sm" data-all>Tout cocher</button>
          <button class="btn btn--light btn--sm" data-none>Tout décocher</button>
          <span class="muted small" id="ccount"></span>
        </div>
        <div class="catalog">${groups.map((g) => `
          <section>
            <h3><label class="check"><input type="checkbox" data-group="${g.c.id}"> ${esc(g.c.name)} <span class="muted small">(${g.items.length})</span></label></h3>
            <ul>${g.items.map((it) => {
              const st = status(it);
              return `<li><label class="check">
                <input type="checkbox" data-id="${esc(it.id)}" ${st === 'have' ? '' : 'checked'}>
                <span><strong>${esc(it.name)}</strong> <span class="muted small">· ${esc(it.type)} · ${furnitureDims(it)}</span>
                ${st === 'have' ? '<span class="tag-ok">déjà dans la bibliothèque</span>' : st === 'nophoto' ? '<span class="tag-warn">présent, sans photo</span>' : ''}
                <a href="${esc(it.sourceUrl)}" target="_blank" rel="noopener" class="small">voir</a></span>
              </label></li>`;
            }).join('')}</ul>
          </section>`).join('')}
        </div>
        <div class="progress hidden" id="cprog"><div></div></div>
        <p class="small muted hidden" id="cstate"></p>`,
      footer: `<button class="btn btn--light" data-close>Fermer</button><button class="btn" data-go>Importer la sélection</button>`,
    });
    const el = m.el;
    const boxes = () => [...el.querySelectorAll('input[data-id]')];
    const count = () => {
      const n = boxes().filter((b) => b.checked).length;
      el.querySelector('#ccount').textContent = `${n} modèle(s) sélectionné(s)`;
      el.querySelectorAll('input[data-group]').forEach((g) => {
        const own = boxes().filter((b) => CATALOGUE_MDF.find((x) => x.id === b.dataset.id)?.category === g.dataset.group);
        g.checked = own.every((b) => b.checked);
        g.indeterminate = !g.checked && own.some((b) => b.checked);
      });
    };
    count();
    el.addEventListener('change', (e) => {
      const g = e.target.closest('input[data-group]');
      if (g) boxes().forEach((b) => { if (CATALOGUE_MDF.find((x) => x.id === b.dataset.id)?.category === g.dataset.group) b.checked = g.checked; });
      count();
    });
    el.querySelector('[data-all]').onclick = () => { boxes().forEach((b) => (b.checked = true)); count(); };
    el.querySelector('[data-none]').onclick = () => { boxes().forEach((b) => (b.checked = false)); count(); };

    el.querySelector('[data-go]').onclick = async (e) => {
      const btn = e.currentTarget;
      const ids = new Set(boxes().filter((b) => b.checked).map((b) => b.dataset.id));
      const items = CATALOGUE_MDF.filter((x) => ids.has(x.id));
      if (!items.length) return toast('Cochez au moins un modèle', 'err');
      if (!navigator.onLine) return toast('Connexion internet nécessaire pour récupérer les photos', 'err');
      busy(btn, true, 'Import…');
      const prog = el.querySelector('#cprog'); const state = el.querySelector('#cstate');
      prog.classList.remove('hidden'); state.classList.remove('hidden');
      const cfg = providerConfig(await api.settings(), 'gemini');
      await ensureCategories(items);
      let added = 0, photosOk = 0, noPhoto = 0, skipped = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        state.textContent = `${i + 1} / ${items.length} · ${it.name}`;
        const old = existing.get(it.id);
        if (old?.photos?.length) { skipped++; }
        else {
          const photos = await downloadPhoto(it, cfg);
          photos.length ? photosOk++ : noPhoto++;
          const { photoUrls, ...data } = it;
          const rec = old
            ? { ...old, photos, cover: 0, updatedAt: now() } // modèle déjà présent sans photo : on complète
            : { ...data, reference: '', photos, cover: 0, createdAt: now(), updatedAt: now() };
          await idb.put('furniture', rec);
          existing.set(it.id, rec);
          if (!old) added++;
          imported = true;
        }
        prog.firstElementChild.style.width = `${((i + 1) / items.length) * 100}%`;
      }
      api.notifyImport();
      busy(btn, false);
      const msg = `${added} modèle(s) ajouté(s), ${photosOk} photo(s) récupérée(s)${skipped ? `, ${skipped} déjà présent(s)` : ''}.`;
      if (noPhoto) {
        state.innerHTML = `${esc(msg)}<br><span class="err-text">${noPhoto} photo(s) non récupérée(s)</span> : vérifiez la connexion et le code d'accès du relais (Réglages), puis relancez l'import pour les compléter.`;
        toast(`${msg} ${noPhoto} sans photo.`, 'err');
      } else {
        toast(msg, 'ok');
        m.close();
      }
    };
  });
}
