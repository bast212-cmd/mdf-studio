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
    if (env.ACCESS_CODE) {
      // espaces parasites et majuscules ignorés (saisie sur iPad, copier-coller dans Cloudflare)
      const sent = (request.headers.get('x-access-code') || '').trim().toLowerCase();
      if (!sent) return error(401, "Code d'accès manquant : saisissez-le dans les Réglages, puis Enregistrer.", cors);
      if (!sameText(sent, String(env.ACCESS_CODE).trim().toLowerCase())) return error(401, "Code d'accès du relais incorrect.", cors);
    }
    if (!env.GEMINI_API_KEY) return error(500, 'Clé GEMINI_API_KEY absente du relais (Cloudflare › Variables and secrets).', cors);

    const url = new URL(request.url);
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
