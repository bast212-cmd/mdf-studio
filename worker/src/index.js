// Relais entre l'application et l'API Gemini : la clé reste chez Cloudflare, jamais sur les appareils.
// Les requêtes de l'app sont transmises telles quelles à Google (sans être lues : peu de calcul,
// pas de limite de taille gênante), la réponse est renvoyée en flux.
// Suivi : chaque appel à Gemini est noté dans la base D1 (binding DB, facultatif) et consultable sur /suivi.
import { SUIVI_HTML } from './suivi.js';

const GOOGLE = 'https://generativelanguage.googleapis.com';
// Seuls les appels utilisés par l'app passent : liste des modèles, generateContent, interactions
const ALLOWED_PATHS = /^\/v1beta\/(models|models\/[^/]+:generateContent|interactions)$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Page de suivi des rendus : ouverte dans un navigateur, ses données demandent le code d'accès
    if (request.method === 'GET' && url.pathname === '/suivi') {
      return new Response(SUIVI_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'GET' && url.pathname === '/suivi/data') {
      const denied = checkCode(request, env);
      if (denied) return error(denied.status, denied.message, {});
      try { return Response.json(await stats(env), { headers: { 'Cache-Control': 'no-store' } }); }
      catch (e) { return error(500, `Suivi indisponible : ${e.message}`, {}); }
    }

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
          'Access-Control-Allow-Headers': 'Content-Type, x-access-code, x-mdf-kind, x-mdf-model, x-mdf-device',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (!allowed) return error(403, `Origine non autorisée (${origin || 'aucune'}) : ajoutez-la à ALLOWED_ORIGINS dans worker/wrangler.toml.`, cors);
    const denied = checkCode(request, env);
    if (denied) return error(denied.status, denied.message, cors);

    // Photos du catalogue Mobilier de France : récupérées par le relais car le site ne les
    // autorise pas en accès direct depuis l'application (CORS). Seul ce site est accepté.
    if (request.method === 'GET' && url.pathname === '/img') return catalogueImage(url.searchParams.get('u'), cors);

    if (!env.GEMINI_API_KEY) return error(500, 'Clé GEMINI_API_KEY absente du relais (Cloudflare › Variables and secrets).', cors);

    if (!['GET', 'POST'].includes(request.method) || !ALLOWED_PATHS.test(url.pathname)) {
      return error(404, `Appel non autorisé par le relais : ${request.method} ${url.pathname}`, cors);
    }

    const started = Date.now();
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
      track(env, ctx, request, url, 502, Date.now() - started, 'Google injoignable');
      return error(502, 'Le relais ne parvient pas à joindre Google.', cors);
    }
    // en cas d'erreur, le message de Google (court) est gardé pour le suivi
    let message = '';
    if (!upstream.ok) {
      try { const t = await upstream.clone().text(); message = JSON.parse(t)?.error?.message || t; } catch { /* corps illisible */ }
    }
    track(env, ctx, request, url, upstream.status, Date.now() - started, message);
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

// Code d'accès : sans code configuré, le relais refuse tout (sinon n'importe qui pourrait utiliser la clé).
// Espaces parasites et majuscules ignorés (saisie sur iPad, copier-coller dans Cloudflare).
function checkCode(request, env) {
  const expected = String(env.ACCESS_CODE || '').trim().toLowerCase();
  if (!expected) return { status: 500, message: 'Secret ACCESS_CODE absent du relais (Cloudflare › Variables and secrets, type Secret).' };
  const sent = (request.headers.get('x-access-code') || '').trim().toLowerCase();
  if (!sent) return { status: 401, message: "Code d'accès manquant : saisissez-le dans les Réglages, puis Enregistrer." };
  if (!sameText(sent, expected)) return { status: 401, message: "Code d'accès du relais incorrect." };
  return null;
}

// ---------- Suivi des appels (base D1, binding DB) ----------
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare('CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, device TEXT, kind TEXT, model TEXT, status INTEGER, ms INTEGER, error TEXT)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS calls_ts ON calls (ts)').run();
  schemaReady = true;
}

/** Note l'appel en tâche de fond (la réponse part sans attendre l'écriture) ; sans base, ne fait rien */
function track(env, ctx, request, url, status, ms, message) {
  if (!env.DB || request.method !== 'POST') return; // les GET sont les tests de connexion
  const h = (k) => (request.headers.get(k) || '').slice(0, 80);
  let device = h('x-mdf-device');
  try { device = decodeURIComponent(device); } catch { /* nom brut */ }
  const model = h('x-mdf-model') || (url.pathname.match(/^\/v1beta\/models\/([^/:]+)/)?.[1] ?? '');
  const row = [new Date().toISOString(), device || null, h('x-mdf-kind') || 'autre', model, status, ms, message ? String(message).slice(0, 300) : null];
  const write = ensureSchema(env.DB)
    .then(() => env.DB.prepare('INSERT INTO calls (ts, device, kind, model, status, ms, error) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(...row).run())
    .catch((e) => console.error('suivi', e));
  ctx?.waitUntil?.(write);
}

/** Chiffres des 30 derniers jours pour la page de suivi (les tests de connexion sont exclus) */
async function stats(env) {
  if (!env.DB) return { configured: false };
  await ensureSchema(env.DB);
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const all = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then((r) => r.results || []);
  const [days, devices, models, errors, totals] = await Promise.all([
    all("SELECT substr(ts, 1, 10) AS day, COUNT(*) AS n, SUM(status <> 200) AS ko FROM calls WHERE ts >= ? GROUP BY day ORDER BY day", since),
    all("SELECT COALESCE(device, '(sans nom)') AS device, COUNT(*) AS n, SUM(status <> 200) AS ko, MAX(ts) AS last FROM calls WHERE ts >= ? GROUP BY device ORDER BY n DESC", since),
    all('SELECT kind, model, COUNT(*) AS n, SUM(status = 200) AS ok FROM calls WHERE ts >= ? GROUP BY kind, model ORDER BY n DESC', since),
    all('SELECT ts, device, kind, model, status, error FROM calls WHERE status <> 200 ORDER BY ts DESC LIMIT 20'),
    all('SELECT COUNT(*) AS n, SUM(status <> 200) AS ko, AVG(CASE WHEN status = 200 THEN ms END) AS avg_ms FROM calls WHERE ts >= ?', since),
  ]);
  return { configured: true, since, days, devices, models, errors, totals: totals[0] || { n: 0, ko: 0, avg_ms: null } };
}

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
    // « * » remplace un morceau d'adresse ; le reste (points compris) doit correspondre exactement
    const re = new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[a-z0-9-]+') + '$', 'i');
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
