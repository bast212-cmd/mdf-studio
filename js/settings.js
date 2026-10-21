// Écran Réglages : clé API et fournisseur d'images, stockage, installation, sauvegardes
import { api } from './api.js';
import { store, APP_VERSION } from './store.js';
import { esc, $, $$, toast, busy } from './ui.js';
import { PROVIDERS, getProvider, providerConfig } from './ai/providers/index.js';
import { exportBackupDialog, pickAndImport, pickLegacyFolder } from './transfer.js';

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const fmt = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} Go` : `${Math.round(n / 1e6)} Mo`);

export async function renderSettings(view) {
  const settings = await api.settings();
  let providerId = getProvider(settings.provider).id;
  const [rooms, furniture] = await Promise.all([api.rooms(), api.furniture()]);
  const renders = rooms.reduce((s, r) => s + (r.renders?.length || 0), 0);

  view.innerHTML = `
    <div class="section-head"><div><span class="eyebrow">Réglages</span><h1>Réglages de cet appareil</h1></div></div>
    <div class="settings">
      <section class="panel">
        <h3>Moteur d'images IA</h3>
        <form id="sform" autocomplete="off">
          <div class="field ${PROVIDERS.length < 2 ? 'hidden' : ''}"><label>Fournisseur</label>
            <select id="provider">${PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === providerId ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
          <div id="pfields"></div>
          <div class="btn-row">
            <button class="btn" type="submit">Enregistrer</button>
            <button class="btn btn--ghost" type="button" data-test>Tester la clé</button>
          </div>
          <div id="testout" class="small" style="margin-top:12px"></div>
        </form>
        <div class="alert alert--info small" style="margin-top:20px">
          La clé est enregistrée <strong>uniquement sur cet appareil</strong> et n'est jamais incluse dans les fichiers exportés.
          Les images sont envoyées directement de l'appareil à Google, sans intermédiaire.
          Conseils : dans Google Cloud, limitez la clé à l'API « Generative Language » et fixez un plafond de dépense (Facturation › Budgets et alertes).
        </div>
      </section>

      <section class="panel">
        <h3>Installation et stockage</h3>
        <div id="install"></div>
        <dl class="kv" id="storage"><dt>Stockage utilisé</dt><dd>…</dd></dl>
        <dl class="kv">
          <dt>Projets</dt><dd>${rooms.length} (${renders} rendu${renders > 1 ? 's' : ''})</dd>
          <dt>Meubles</dt><dd>${furniture.length}</dd>
          <dt>Version</dt><dd>${APP_VERSION}</dd>
        </dl>
      </section>

      <section class="panel">
        <h3>Sauvegarde et transfert</h3>
        <p class="small">Les données ne sont stockées que sur cet appareil. Faites une sauvegarde de temps en temps (iCloud Drive, Google Drive…) : elle permet aussi de tout transférer vers un autre appareil.</p>
        <div class="btn-row">
          <button class="btn btn--ghost" data-backup>Créer une sauvegarde complète</button>
          <button class="btn btn--light" data-restore>Restaurer / importer un fichier</button>
        </div>
        <p class="muted small" style="margin-top:10px">Pour ne partager que la bibliothèque de meubles : <a href="#/bibliotheque">Bibliothèque › Partager</a>.</p>
        ${'webkitdirectory' in document.createElement('input') && !matchMedia('(pointer: coarse)').matches ? `
        <hr>
        <h3>Reprendre l'ancienne version</h3>
        <p class="small">Sur l'ordinateur qui faisait tourner l'ancienne version (serveur Node.js), choisissez son dossier <strong>data</strong> (il contient db.json, uploads et renders). Projets, rendus et bibliothèque seront copiés ici.</p>
        <button class="btn btn--light" data-legacy>Choisir le dossier « data »…</button>` : ''}
      </section>
    </div>`;

  // ---------- Fournisseur ----------
  const drawFields = () => {
    const p = getProvider(providerId);
    const cfg = providerConfig(settings, p.id);
    $('#pfields', view).innerHTML = `
      ${p.help ? `<p class="small">${p.help}</p>` : ''}
      ${p.fields.map((f) => {
        const v = cfg[f.key] ?? '';
        if (f.type === 'select') {
          return `<div class="field"><label>${esc(f.label)}</label><select name="${f.key}">${f.options.map(([val, lab]) => `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`).join('')}</select>${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
        }
        const list = f.suggestions ? `list="dl-${f.key}"` : '';
        return `<div class="field"><label>${esc(f.label)}</label>
          <div class="${f.type === 'secret' ? 'secret' : ''}">
            <input name="${f.key}" ${list} type="${f.type === 'secret' ? 'password' : 'text'}" value="${esc(v)}" placeholder="${esc(f.placeholder || f.default || '')}" autocapitalize="off" autocorrect="off" spellcheck="false">
            ${f.type === 'secret' ? '<button type="button" class="btn btn--light btn--sm" data-reveal>Afficher</button>' : ''}
          </div>
          ${f.suggestions ? `<datalist id="dl-${f.key}">${f.suggestions.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}
          ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
      }).join('')}`;
    $$('[data-reveal]', view).forEach((b) => (b.onclick = () => {
      const inp = b.previousElementSibling;
      inp.type = inp.type === 'password' ? 'text' : 'password';
      b.textContent = inp.type === 'password' ? 'Afficher' : 'Masquer';
    }));
  };
  drawFields();

  const readForm = () => {
    const p = getProvider(providerId);
    const form = $('#sform', view);
    const cfg = {};
    p.fields.forEach((f) => { cfg[f.key] = String(form.elements[f.key]?.value ?? '').trim(); });
    return cfg;
  };
  const saveForm = async () => {
    settings.provider = providerId;
    settings.providers = { ...(settings.providers || {}), [providerId]: readForm() };
    await api.saveSettings(settings);
    await refreshStatusLine();
  };

  $('#provider', view).onchange = (e) => { providerId = e.target.value; drawFields(); $('#testout', view).innerHTML = ''; };
  $('#sform', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    await saveForm();
    toast('Réglages enregistrés', 'ok');
  });
  $('[data-test]', view).onclick = async (e) => {
    const p = getProvider(providerId);
    const cfg = { ...providerConfig(settings, p.id), ...readForm() };
    const out = $('#testout', view);
    if (!p.isConfigured(cfg)) { out.innerHTML = '<span class="err-text">Renseignez d\'abord la clé.</span>'; return; }
    if (!p.test) { out.textContent = 'Test non disponible pour ce fournisseur.'; return; }
    busy(e.currentTarget, true, 'Test…');
    try {
      const r = await p.test(cfg);
      await saveForm();
      const model = cfg.imageModel;
      const found = !r.imageModels || !model || r.imageModels.includes(model);
      out.innerHTML = `<span class="ok-text">✓ Clé valide, enregistrée.</span>
        ${r.imageModels ? `<br>Modèles d'image accessibles : ${r.imageModels.map(esc).join(', ') || 'aucun'}.` : ''}
        ${!found ? `<br><span class="err-text">Le modèle « ${esc(model)} » n'apparaît pas dans la liste : vérifiez son nom.</span>` : ''}
        <br><span class="muted">Le test ne vérifie pas la facturation : une première génération le confirmera.</span>`;
      // propose les modèles disponibles dans les listes de suggestions
      const dl = $('#dl-imageModel', view);
      if (dl && r.imageModels?.length) dl.innerHTML = r.imageModels.map((x) => `<option value="${esc(x)}">`).join('');
      const dt = $('#dl-textModel', view);
      if (dt && r.textModels?.length) dt.innerHTML = r.textModels.map((x) => `<option value="${esc(x)}">`).join('');
    } catch (err) {
      out.innerHTML = `<span class="err-text">✕ ${esc(err.message)}</span>`;
    }
    busy(e.currentTarget, false);
  };

  // ---------- Installation / stockage ----------
  const drawInstall = async () => {
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    const el = $('#install', view);
    if (isStandalone()) {
      el.innerHTML = `<p class="small"><span class="ok-text">✓ Application installée.</span> ${persisted ? 'Stockage protégé contre l\'effacement automatique.' : ''}</p>`;
    } else if (isIOS()) {
      el.innerHTML = `<div class="alert small"><strong>À faire sur iPad :</strong> installez l'application, sinon Safari peut effacer les données après quelques semaines sans visite.
        Dans Safari : bouton <strong>Partager</strong> (carré avec une flèche) › <strong>Sur l'écran d'accueil</strong>, puis ouvrez l'app depuis l'icône.
        <br>Attention : l'app installée a son propre stockage, distinct de l'onglet Safari. Installez-la <em>avant</em> de saisir vos données (ou faites une sauvegarde ici, puis restaurez-la dans l'app).</div>`;
    } else {
      el.innerHTML = `<p class="small">Pour installer l'application sur cet ordinateur : icône d'installation dans la barre d'adresse (Chrome, Edge), ou menu Fichier › Ajouter au Dock (Safari sur Mac).</p>`;
    }
    if (!persisted && navigator.storage?.persist) {
      el.insertAdjacentHTML('beforeend', '<button class="btn btn--light btn--sm" data-persist>Protéger le stockage de cet appareil</button>');
      $('[data-persist]', el).onclick = async () => {
        const ok = await navigator.storage.persist().catch(() => false);
        toast(ok ? 'Stockage protégé' : 'Le navigateur a refusé (installez l\'application puis réessayez).', ok ? 'ok' : 'err');
        drawInstall();
      };
    }
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (est) $('#storage', view).innerHTML = `<dt>Stockage utilisé</dt><dd>${fmt(est.usage || 0)}${est.quota ? ` sur ${fmt(est.quota)} disponibles` : ''}</dd>`;
  };
  drawInstall();

  // ---------- Sauvegardes ----------
  $('[data-backup]', view).onclick = (e) => exportBackupDialog(e.currentTarget);
  $('[data-restore]', view).onclick = async () => { if (await pickAndImport()) renderSettings(view); };
  $('[data-legacy]', view)?.addEventListener('click', async () => { if (await pickLegacyFolder()) renderSettings(view); });
}

/** Met à jour la ligne d'état en pied de page */
export async function refreshStatusLine() {
  const st = await store.refreshStatus().catch(() => ({ configured: false }));
  const el = document.getElementById('status-line');
  if (!el) return;
  const offline = !navigator.onLine ? ' · Hors ligne (génération indisponible)' : '';
  el.innerHTML = st.configured
    ? `Moteur IA : ${esc(st.imageModel)}${offline}`
    : `<a href="#/reglages">Clé API à renseigner dans les Réglages</a>${offline}`;
}
