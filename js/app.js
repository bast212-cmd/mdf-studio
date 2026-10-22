// Point d'entrée : routeur + page d'accueil
import { api } from './api.js';
import { store } from './store.js';
import { esc, $, toast } from './ui.js';
import { src } from './data/media.js';
import { renderProject } from './project.js';
import { renderLibrary } from './library.js';
import { renderQuick } from './quick.js';
import { renderSettings, refreshStatusLine, isStandalone, isIOS } from './settings.js';
import { startMediaObserver, collectGarbage } from './data/media.js';
import { openDB } from './data/db.js';

const app = document.getElementById('app');

const HERO_SVG = `
<svg viewBox="0 0 400 260" fill="none" stroke="#0a3d7c" stroke-width="2" stroke-linejoin="round">
  <rect x="30" y="30" width="340" height="200" fill="#fff" stroke-width="5"/>
  <g stroke="#e3ded5" stroke-width="1">${Array.from({ length: 6 }, (_, i) => `<line x1="${30 + (i + 1) * 48.5}" y1="30" x2="${30 + (i + 1) * 48.5}" y2="230"/>`).join('')}${Array.from({ length: 3 }, (_, i) => `<line x1="30" y1="${30 + (i + 1) * 50}" x2="370" y2="${30 + (i + 1) * 50}"/>`).join('')}</g>
  <rect x="60" y="50" width="140" height="50" rx="4" fill="rgba(10,61,124,.15)"/><line x1="64" y1="100" x2="196" y2="100" stroke-width="5"/>
  <rect x="95" y="125" width="70" height="40" rx="3" fill="#e4ddd1" stroke="#8a8172"/>
  <rect x="270" y="60" width="70" height="110" rx="3" fill="#e4ddd1" stroke="#8a8172"/>
  <path d="M200 225 L150 150 A90 90 0 0 1 250 150 Z" fill="rgba(224,138,0,.12)" stroke="#e08a00" stroke-dasharray="5 4"/>
  <rect x="190" y="212" width="20" height="16" rx="3" fill="#e08a00" stroke="#fff"/>
</svg>`;

async function renderHome(view) {
  const rooms = await api.rooms();
  const saved = rooms.flatMap((r) => (r.renders || []).filter((x) => x.saved).map((x) => ({ ...x, room: r })));
  const cover = (r) => (r.renders || []).find((x) => x.saved)?.media || r.renders?.[0]?.media || r.photos?.[r.refPhoto || 0]?.media;
  const lastStep = (r) => (!r.plan ? 1 : r.renders?.length ? 4 : r.plan.items?.some((i) => i.kind === 'new') ? 3 : 2);

  view.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow">Studio d'aménagement IA</span>
        <h1>Imaginez votre nouveau meuble, <em>chez vous</em>.</h1>
        <p>Photographiez votre pièce, renseignez ses dimensions, placez vos meubles sur le plan, choisissez coloris et matières : l'IA crée une image réaliste de votre intérieur réaménagé.</p>
        <div class="btn-row" style="margin-top:28px">
          <a class="btn btn--lg" href="#/rapide/nouveau">Rendu rapide</a>
          <a class="btn btn--ghost btn--lg" href="#/projet/nouveau">Projet complet</a>
        </div>
        <p class="muted small" style="margin-top:14px"><strong>Rendu rapide</strong> : photo de la pièce, zone à remplacer, photo du meuble, c'est parti.
          <strong>Projet complet</strong> : dimensions, plan à l'échelle, plusieurs meubles et bibliothèque.</p>
      </div>
      <div class="hero__visual">${HERO_SVG}</div>
    </section>

    <div class="steps-intro">
      <div><h3>Votre pièce</h3><p class="muted small">Importez ou prenez des photos, indiquez longueur, largeur et hauteur.</p></div>
      <div><h3>Le plan</h3><p class="muted small">Un plan à l'échelle est généré : positionnez les meubles existants et le point de vue.</p></div>
      <div><h3>Vos meubles</h3><p class="muted small">Photographiez un meuble ou choisissez-le dans la bibliothèque, remplacez ou placez-le.</p></div>
      <div><h3>Le rendu</h3><p class="muted small">Générez l'image, comparez avant/après, sauvegardez ou modifiez.</p></div>
    </div>

    <div class="section-head"><h2>Mes projets</h2><a class="btn btn--ghost btn--sm" href="#/projet/nouveau">+ Nouveau projet</a></div>
    <div class="cards">
      <a class="card card--add" href="#/rapide/nouveau"><div><span>⚡</span>Rendu rapide</div></a>
      <a class="card card--add" href="#/projet/nouveau"><div><span>+</span>Projet complet</div></a>
      ${rooms.map((r) => `
        <a class="card" href="${r.mode === 'quick' ? `#/rapide/${r.id}` : `#/projet/${r.id}/${lastStep(r)}`}">
          <div class="card__img">${cover(r) ? `<img ${src(cover(r))} alt="">` : '<span class="small">Pas encore de photo</span>'}</div>
          ${store.catName(r.category) ? `<span class="card__badge">${esc(store.catName(r.category))}</span>` : ''}
          <div class="card__body">
            <div class="card__title">${esc(r.name)}</div>
            <div class="card__meta">${r.mode === 'quick' ? 'Rendu rapide' : `${r.dims?.length || '–'} × ${r.dims?.width || '–'} cm`} · ${(r.renders || []).length} rendu(s)</div>
            <div class="card__meta">Modifié le ${new Date(r.updatedAt).toLocaleDateString('fr-FR')}</div>
          </div>
        </a>`).join('')}
    </div>

    ${saved.length ? `
      <div class="section-head" style="margin-top:56px"><h2>Rendus sauvegardés</h2></div>
      <div class="cards">${saved.map((s) => `
        <a class="card" href="${s.room.mode === 'quick' ? `#/rapide/${s.room.id}` : `#/projet/${s.room.id}/4`}">
          <div class="card__img"><img ${src(s.media)} alt=""></div>
          <div class="card__body"><div class="card__title">${esc(s.room.name)}</div><div class="card__meta">${new Date(s.createdAt).toLocaleString('fr-FR')}</div></div>
        </a>`).join('')}</div>` : ''}`;
}

// ---------- Routeur (hash) ----------
async function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  const view = document.createElement('div'); // nouvel élément = pas d'écouteurs résiduels
  app.replaceChildren(view);
  window.scrollTo(0, 0);
  $('#nav').classList.remove('open');

  let nav = 'home';
  try {
    if (parts[0] === 'projet') {
      nav = parts[1] === 'nouveau' ? 'project' : '';
      await renderProject(view, { id: parts[1], step: parts[2] });
    } else if (parts[0] === 'rapide') {
      nav = parts[1] === 'nouveau' || !parts[1] ? 'quick' : '';
      await renderQuick(view, { id: parts[1] });
    } else if (parts[0] === 'bibliotheque') {
      nav = 'library';
      await renderLibrary(view);
    } else if (parts[0] === 'reglages') {
      nav = 'settings';
      await renderSettings(view);
    } else {
      await renderHome(view);
    }
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="alert">Une erreur est survenue : ${esc(e.message)}</div>`;
  }
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
}

$('#burger').onclick = () => $('#nav').classList.toggle('open');
window.addEventListener('hashchange', route);
window.addEventListener('online', refreshStatusLine);
window.addEventListener('offline', refreshStatusLine);

// ---------- Bandeau d'installation (iPad dans Safari) ----------
function installBanner() {
  if (isStandalone() || !isIOS()) return;
  try { if (sessionStorage.getItem('hideInstall')) return; } catch { /* stockage indisponible */ }
  const el = document.createElement('div');
  el.className = 'install-banner';
  el.innerHTML = `<span><strong>Installez l'application</strong> pour garder vos données : bouton Partager <span aria-hidden="true">⎋</span> › « Sur l'écran d'accueil ». Puis ouvrez-la depuis l'icône.</span>
    <button class="icon-btn" aria-label="Masquer">×</button>`;
  el.querySelector('button').onclick = () => { el.remove(); try { sessionStorage.setItem('hideInstall', '1'); } catch { /* */ } };
  document.body.prepend(el);
}

// ---------- Logo dynamique ----------
// Cherche le logo en deux parties (carré + nom) dans img/ ; sinon garde le logo complet.
function loadImage(base) {
  const exts = ['svg', 'png', 'webp'];
  return new Promise((resolve) => {
    const tryNext = (i) => {
      if (i >= exts.length) return resolve(null);
      const im = new Image();
      im.onload = () => resolve(im.src);
      im.onerror = () => tryNext(i + 1);
      im.src = `img/${base}.${exts[i]}`;
    };
    tryNext(0);
  });
}
// Logo officiel du site, utilisé tant que les fichiers découpés ne sont pas dans img/
const SITE_LOGO = 'https://www.mobilierdefrance.com/themes/mobilierdefrance/assets/img/logo_blue.png';
const loadURL = (src) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(src); im.onerror = () => ok(null); im.src = src; });

async function setupLogo() {
  const brand = $('#brand');
  // 1. Carré + nom mot par mot : le nom peut passer à la ligne sans rien déformer
  const parts = [...brand.querySelectorAll('img[data-logo]')];
  const srcs = await Promise.all(parts.map((im) => loadImage(im.dataset.logo)));
  if (srcs.every(Boolean)) {
    parts.forEach((im, i) => { im.src = srcs[i]; });
    brand.classList.add('brand--words');
    return;
  }
  // 2. Logo complet en une image : on n'en garde que le carré (à gauche, à la même échelle),
  //    le nom est écrit à côté en Montserrat, plus petit, pour laisser la place au menu
  brand.querySelector('.brand__text').hidden = false;
  const full = (await loadImage('logo')) || (await loadURL(SITE_LOGO));
  if (full) {
    const sq = brand.querySelector('.brand__sq');
    sq.querySelector('img').src = full;
    sq.hidden = false;
    brand.classList.add('brand--site');
    return;
  }
  // 3. Dernier recours : le nom seul en texte
  brand.classList.add('brand--text');
}

// ---------- Service worker (hors ligne + installation) ----------
let updating = false;
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const offerUpdate = (w) => {
      const t = document.createElement('div');
      t.className = 'toast update';
      t.innerHTML = 'Nouvelle version disponible. <button class="btn btn--sm">Mettre à jour</button>';
      t.querySelector('button').onclick = () => { updating = true; w.postMessage('skipWaiting'); };
      document.getElementById('toast-root').appendChild(t);
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
    });
    // vérifie les mises à jour au retour sur l'application
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker non enregistré', e));
  // Rechargement uniquement après « Mettre à jour » (pas lors de la toute première installation)
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) { updating = false; location.reload(); } });
}

(async () => {
  try {
    await openDB();
  } catch (e) {
    app.innerHTML = `<div class="alert">Stockage local indisponible : ${esc(e.message)}<br>En navigation privée, le stockage est désactivé.</div>`;
    return;
  }
  startMediaObserver();
  setupLogo();
  registerSW();
  installBanner();
  // Demande au navigateur de ne pas effacer les données (accordé d'office aux apps installées)
  if (isStandalone()) navigator.storage?.persist?.().catch(() => {});
  await store.loadCategories();
  await refreshStatusLine();
  route();
  // Ménage des images orphelines, en tâche de fond
  setTimeout(async () => {
    try { await collectGarbage(await api.rooms(), await api.furniture()); } catch (e) { console.warn(e); }
  }, 4000);
})();
