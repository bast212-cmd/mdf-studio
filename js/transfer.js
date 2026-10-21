// Fenêtres d'export / import (bibliothèque, sauvegarde complète, ancienne version)
import { api } from './api.js';
import { store } from './store.js';
import { esc, modal, toast, busy } from './ui.js';
import { shareOrDownload, canShareFiles } from './data/media.js';

const bundleMod = () => import('./data/bundle.js');
const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`);

/** Fenêtre d'export de la bibliothèque (toute ou une pièce) */
export async function exportLibraryDialog(defaultCategory = '') {
  await store.loadCategories();
  const all = await api.furniture();
  const count = (id) => all.filter((f) => !id || f.category === id).length;
  const m = modal({
    title: 'Partager la bibliothèque',
    content: `
      <p class="small">Crée un fichier contenant les meubles, leurs photos et leurs cotes. Envoyez-le par mail, AirDrop, ou enregistrez-le dans iCloud Drive / Google Drive (app Fichiers). Sur l'autre appareil : <strong>Bibliothèque › Importer</strong>.</p>
      <div class="field"><label>Contenu</label>
        <select id="xcat">
          <option value="">Toute la bibliothèque (${count('')} meubles)</option>
          ${store.categories.map((c) => `<option value="${c.id}" ${c.id === defaultCategory ? 'selected' : ''}>${esc(c.name)} uniquement (${count(c.id)} meubles)</option>`).join('')}
        </select></div>
      <div class="progress hidden" id="xprog"><div></div></div>`,
    footer: `<button class="btn btn--light" data-close>Annuler</button><button class="btn" data-go>Créer le fichier</button>`,
  });
  m.el.querySelector('[data-go]').onclick = async (e) => {
    const btn = e.currentTarget;
    const cat = m.el.querySelector('#xcat').value;
    if (!count(cat)) return toast('Aucun meuble à exporter', 'err');
    busy(btn, true, 'Préparation…');
    const prog = m.el.querySelector('#xprog');
    prog.classList.remove('hidden');
    try {
      const { exportLibrary } = await bundleMod();
      const out = await exportLibrary({ categoryId: cat, onProgress: (d, t) => (prog.firstElementChild.style.width = `${(d / t) * 100}%`) });
      m.close();
      fileReadyDialog(out.blob, out.filename, `${out.count} meuble(s) avec leurs photos et leurs cotes.`);
    } catch (err) { console.error(err); toast("Échec de l'export : " + err.message, 'err'); busy(btn, false); }
  };
}

/** Fichier prêt : boutons Partager / Télécharger (un nouveau clic est nécessaire pour partager sur iPad) */
export function fileReadyDialog(blob, filename, description = '') {
  const share = canShareFiles();
  const m = modal({
    title: 'Fichier prêt',
    content: `<p><strong>${esc(filename)}</strong> <span class="muted small">· ${fmtSize(blob.size)}</span></p>
      ${description ? `<p class="small">${esc(description)}</p>` : ''}
      ${share ? '<p class="muted small">« Partager » ouvre AirDrop, Mail, Enregistrer dans Fichiers (iCloud Drive, Google Drive)…</p>' : ''}`,
    footer: `<button class="btn btn--light" data-close>Fermer</button>
      <button class="btn ${share ? 'btn--ghost' : ''}" data-dl>Télécharger</button>
      ${share ? '<button class="btn" data-share>Partager…</button>' : ''}`,
  });
  m.el.querySelector('[data-dl]').onclick = async () => { await shareOrDownload(blob, filename, '', 'download'); m.close(); };
  m.el.querySelector('[data-share]')?.addEventListener('click', async () => {
    const r = await shareOrDownload(blob, filename, filename, 'share');
    if (r !== 'cancelled') m.close();
  });
}

/** Sauvegarde complète (projets + bibliothèque) */
export async function exportBackupDialog(btn) {
  busy(btn, true, 'Préparation…');
  try {
    const { exportBackup } = await bundleMod();
    const out = await exportBackup({});
    fileReadyDialog(out.blob, out.filename, 'Projets, rendus et bibliothèque de cet appareil (la clé API n\'est pas incluse).');
  } catch (err) { console.error(err); toast('Échec de la sauvegarde : ' + err.message, 'err'); }
  busy(btn, false);
}

/** Choisir un fichier .zip puis l'importer. Résout true si des données ont été importées. */
export function pickAndImport() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip,application/x-zip-compressed';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(false);
      try {
        const { readBundle } = await bundleMod();
        resolve(await importDialog(await readBundle(file)));
      } catch (err) { console.error(err); toast(err.message, 'err'); resolve(false); }
    };
    input.click();
  });
}

/** Reprise de l'ancienne version : sélection du dossier « data » */
export function pickLegacyFolder() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files.length) return resolve(false);
      try {
        const { readLegacyFolder } = await import('./data/legacy.js');
        resolve(await importDialog(await readLegacyFolder(input.files)));
      } catch (err) { console.error(err); toast(err.message, 'err'); resolve(false); }
    };
    input.click();
  });
}

/** Aperçu puis import d'un paquet lu */
async function importDialog(bundle) {
  const { planImport, applyImport } = await bundleMod();
  const plan = await planImport(bundle);
  const line = (label, s) => {
    const parts = [];
    if (s.add.length) parts.push(`<strong>${s.add.length}</strong> nouveau(x)`);
    if (s.update.length) parts.push(`<strong>${s.update.length}</strong> mis à jour`);
    if (s.same) parts.push(`${s.same} déjà identique(s)`);
    if (s.keepLocal) parts.push(`${s.keepLocal} plus récent(s) sur cet appareil, conservé(s)`);
    return parts.length ? `<li>${label} : ${parts.join(', ')}</li>` : '';
  };
  const total = plan.furniture.add.length + plan.furniture.update.length + plan.rooms.add.length + plan.rooms.update.length;

  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title: 'Importer',
      onClose: () => resolve(done),
      content: `
        <p><strong>${esc(plan.title || 'Fichier')}</strong>${plan.exportedAt ? ` <span class="muted small">· exporté le ${new Date(plan.exportedAt).toLocaleString('fr-FR')}</span>` : ''}</p>
        <ul class="small">
          ${line('Meubles', plan.furniture)}
          ${line('Projets', plan.rooms)}
          ${plan.newCats || plan.newTypes ? `<li>Catégories : ${plan.newCats} pièce(s) et ${plan.newTypes} type(s) ajoutés</li>` : ''}
        </ul>
        ${total ? '<p class="muted small">Rien n\'est supprimé sur cet appareil. Pour un même meuble, la version la plus récente est gardée.</p>' : '<div class="alert alert--info">Tout est déjà à jour sur cet appareil.</div>'}
        <div class="progress hidden" id="iprog"><div></div></div>`,
      footer: `<button class="btn btn--light" data-close>${total ? 'Annuler' : 'Fermer'}</button>${total ? '<button class="btn" data-go>Importer</button>' : ''}`,
    });
    m.el.querySelector('[data-go]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      busy(btn, true, 'Import…');
      const prog = m.el.querySelector('#iprog');
      prog.classList.remove('hidden');
      try {
        const r = await applyImport(bundle, plan, (d, t) => (prog.firstElementChild.style.width = `${(d / t) * 100}%`));
        await store.loadCategories();
        done = true;
        toast(`Import terminé : ${r.furniture} meuble(s), ${r.rooms} projet(s)${r.missing ? ` (${r.missing} image(s) manquante(s))` : ''}`, 'ok');
        m.close();
      } catch (err) { console.error(err); toast("Échec de l'import : " + err.message, 'err'); busy(btn, false); }
    });
  });
}
