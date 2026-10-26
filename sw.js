// Service worker : rend l'application disponible hors ligne et installable.
// À CHAQUE MISE EN LIGNE d'une nouvelle version : incrémenter VERSION (et APP_VERSION dans js/store.js).
// L'application propose alors « Nouvelle version disponible › Mettre à jour ».
const VERSION = '2.12.0';
const SHELL = `studio-shell-${VERSION}`;
const RUNTIME = 'studio-runtime';

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'img/icon-192.png',
  'img/icon-512.png',
  'img/icon-maskable-512.png',
  'img/apple-touch-icon.png',
  'js/app.bundle.js',
  'js/app.js',
  'js/api.js',
  'js/store.js',
  'js/ui.js',
  'js/camera.js',
  'js/plan.js',
  'js/project.js',
  'js/library.js',
  'js/catalogue.js',
  'js/sizes.js',
  'js/sizes-ui.js',
  'js/symbols.js',
  'js/data/catalogue-mdf.js',
  'js/quick.js',
  'js/settings.js',
  'js/transfer.js',
  'js/data/db.js',
  'js/data/media.js',
  'js/data/zip.js',
  'js/data/bundle.js',
  'js/data/legacy.js',
  'js/ai/ai.js',
  'js/ai/prompt.js',
  'js/ai/providers/index.js',
  'js/ai/providers/gemini.js',
];

// Ressources externes mises en cache à la première utilisation (polices, logo)
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'www.mobilierdefrance.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    // logos facultatifs déposés à la main dans img/
    const optional = [...['logo', 'logo-carre', 'logo-mobilier', 'logo-de', 'logo-france'].flatMap((n) => ['svg', 'png', 'webp'].map((e) => `img/${n}.${e}`))];
    await Promise.all(optional.map(async (f) => {
      try { const r = await fetch(f, { cache: 'reload' }); if (r.ok) await cache.put(f, r); } catch { /* absent */ }
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('studio-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // appels à l'IA (POST) : jamais interceptés
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Navigation : page de l'application (routage par #)
    if (req.mode === 'navigate') {
      event.respondWith((async () => {
        const cache = await caches.open(SHELL);
        return (await cache.match('index.html')) || fetch(req);
      })());
      return;
    }
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        return await fetch(req);
      } catch {
        return new Response('', { status: 504, statusText: 'Hors ligne' });
      }
    })());
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    // Mise en cache au fil de l'eau, version en cache servie en priorité
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME);
      const hit = await cache.match(req);
      const net = fetch(req).then((r) => { if (r.ok || r.type === 'opaque') cache.put(req, r.clone()); return r; }).catch(() => null);
      event.waitUntil(net);
      return hit || (await net) || new Response('', { status: 504 });
    })());
  }
  // autres domaines (API Google…) : comportement normal du navigateur
});
