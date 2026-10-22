// Relais entre l'application et l'API Gemini : la clé reste chez Cloudflare, jamais sur les appareils.
// Les requêtes de l'app sont transmises telles quelles à Google (sans être lues : peu de calcul,
// pas de limite de taille gênante), la réponse est renvoyée en flux.
const GOOGLE = 'https://generativelanguage.googleapis.com';
// Seuls les appels utilisés par l'app passent : liste des modèles, generateContent, interactions
const ALLOWED_PATHS = /^\/v1beta\/(models|models\/[^/]+:generateContent|interactions)$/;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = originAllowed(origin, env.ALLOWED_ORIGINS);
    const cors = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};

    if (request.method === 'OPTIONS') {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'Content-Type, x-access-code',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (!allowed) return error(403, `Origine non autorisée (${origin || 'aucune'}) : ajoutez-la à ALLOWED_ORIGINS dans worker/wrangler.toml.`, cors);
    // Sans code configuré, le relais refuse tout : sinon n'importe qui pourrait utiliser la clé
    const expected = String(env.ACCESS_CODE || '').trim().toLowerCase();
    if (!expected) return error(500, 'Secret ACCESS_CODE absent du relais (Cloudflare › Variables and secrets, type Secret).', cors);
    // espaces parasites et majuscules ignorés (saisie sur iPad, copier-coller dans Cloudflare)
    const sent = (request.headers.get('x-access-code') || '').trim().toLowerCase();
    if (!sent) return error(401, "Code d'accès manquant : saisissez-le dans les Réglages, puis Enregistrer.", cors);
    if (!sameText(sent, expected)) return error(401, "Code d'accès du relais incorrect.", cors);
    const url = new URL(request.url);

    // Photos du catalogue Mobilier de France : récupérées par le relais car le site ne les
    // autorise pas en accès direct depuis l'application (CORS). Seul ce site est accepté.
    if (request.method === 'GET' && url.pathname === '/img') return catalogueImage(url.searchParams.get('u'), cors);

    if (!env.GEMINI_API_KEY) return error(500, 'Clé GEMINI_API_KEY absente du relais (Cloudflare › Variables and secrets).', cors);

    if (!['GET', 'POST'].includes(request.method) || !ALLOWED_PATHS.test(url.pathname)) {
      return error(404, `Appel non autorisé par le relais : ${request.method} ${url.pathname}`, cors);
    }

    let upstream;
    try {
      upstream = await fetch(GOOGLE + url.pathname + url.search, {
        method: request.method,
        headers: {
          'Content-Type': request.headers.get('Content-Type') || 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: request.method === 'POST' ? request.body : undefined,
      });
    } catch {
      return error(502, 'Le relais ne parvient pas à joindre Google.', cors);
    }
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

const IMAGE_HOSTS = ['www.mobilierdefrance.com', 'mobilierdefrance.com'];
async function catalogueImage(u, cors) {
  let target;
  try { target = new URL(u || ''); } catch { return error(400, 'Adresse de photo invalide.', cors); }
  if (target.protocol !== 'https:' || !IMAGE_HOSTS.includes(target.hostname) || !/\.(jpe?g|png|webp)$/i.test(target.pathname)) {
    return error(403, 'Photo refusée : seules les photos du site Mobilier de France sont acceptées.', cors);
  }
  let r;
  try { r = await fetch(target.toString(), { headers: { Accept: 'image/*' }, cf: { cacheTtl: 86400, cacheEverything: true } }); }
  catch { return error(502, 'Le relais ne parvient pas à joindre mobilierdefrance.com.', cors); }
  const type = r.headers.get('Content-Type') || '';
  if (!r.ok || !type.startsWith('image/')) return error(404, `Photo introuvable (${r.status}).`, cors);
  const headers = new Headers(cors);
  headers.set('Content-Type', type);
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(r.body, { status: 200, headers });
}

// Réponse d'erreur au même format que Google, pour que l'app l'affiche telle quelle
function error(status, message, cors) {
  return new Response(JSON.stringify({ error: { code: status, message, status: 'RELAY_ERROR' } }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function originAllowed(origin, list) {
  if (!origin) return false;
  return String(list || '').split(',').map((s) => s.trim()).filter(Boolean).some((pattern) => {
    const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\/]/g, '\$&')).join('[a-z0-9-]+') + '$', 'i');
    return re.test(origin);
  });
}

// Comparaison en temps constant (ne révèle pas le code caractère par caractère)
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
