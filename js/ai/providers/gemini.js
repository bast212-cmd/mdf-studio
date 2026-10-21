// Fournisseur d'images : Google Gemini (clé Google AI Studio), appelé directement depuis l'appareil.
// Portage de l'ancien server/gemini.js. Gère les deux formats d'API :
// "interactions" (récent) et "generateContent" (historique).
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  help: `Clé à créer sur <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.
    La facturation doit être activée sur le projet Google Cloud de la clé (paiement à l'usage, environ 0,02 à 0,04 $ par image 1K).
    Pensez à fixer un plafond de dépense dans Google Cloud.`,
  /** Champs affichés dans l'écran Réglages */
  fields: [
    { key: 'apiKey', label: 'Clé API Google AI Studio', type: 'secret', placeholder: 'AIza…' },
    { key: 'imageModel', label: "Modèle d'image", type: 'text', default: 'gemini-3.1-flash-image',
      suggestions: ['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'],
      hint: 'gemini-3.1-flash-image : rapide, bon rapport qualité/prix. gemini-3-pro-image : qualité maximale, plus cher.' },
    { key: 'imageSize', label: "Taille de l'image", type: 'select', default: '',
      options: [['', 'Par défaut du modèle (1K)'], ['1K', '1K'], ['2K', '2K (plus cher)'], ['4K', '4K (beaucoup plus cher)']],
      hint: "Les modèles 2.5 n'acceptent pas ce réglage : laissez « Par défaut »." },
    { key: 'textModel', label: 'Modèle de création du plan (détection des meubles)', type: 'text', default: 'gemini-3.8-flash',
      // anciennes valeurs par défaut remplacées automatiquement par la nouvelle
      replaces: ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-3.7-flash'],
      suggestions: ['gemini-3.8-flash', 'gemini-3.6-flash'],
      hint: 'gemini-3.8-flash : le plus précis pour situer les meubles et le point de vue.' },
    { key: 'apiMode', label: "Format d'appel", type: 'select', default: 'auto',
      options: [['auto', 'Automatique (recommandé)'], ['interactions', 'interactions uniquement'], ['generateContent', 'generateContent uniquement']] },
  ],

  isConfigured: (cfg) => Boolean(cfg?.apiKey?.trim()),
  modelLabel: (cfg) => cfg?.imageModel || 'gemini-3.1-flash-image',

  /** Vérifie la clé ; renvoie la liste des modèles d'image disponibles */
  async test(cfg) {
    const res = await call('GET', `${BASE}/models?pageSize=1000`, null, cfg);
    const models = (res.models || []).map((m) => String(m.name || '').replace(/^models\//, ''));
    return { ok: true, imageModels: models.filter((m) => /image/i.test(m)), textModels: models.filter((m) => /^gemini/.test(m) && !/image|tts|embedding|audio|live/i.test(m)) };
  },

  /**
   * @param {{prompt:string, images:{mimeType:string,data:string}[], aspectRatio?:string}} req
   * @returns {Promise<{images:{mimeType:string,data:string}[], text:string}>}
   */
  async generateImage({ prompt, images, aspectRatio }, cfg) {
    const model = cfg.imageModel || 'gemini-3.1-flash-image';
    const mode = String(cfg.apiMode || 'auto').toLowerCase();
    const errors = [];

    if (mode === 'auto' || mode === 'interactions') {
      try {
        const body = {
          model,
          input: [
            { type: 'text', text: prompt },
            ...images.map((im) => ({ type: 'image', mime_type: im.mimeType, data: im.data })),
          ],
        };
        const out = extract(await call('POST', `${BASE}/interactions`, body, cfg));
        if (out.images.length) return out;
        errors.push('interactions : aucune image renvoyée' + (out.text ? ` (« ${out.text.slice(0, 200)} »)` : ''));
      } catch (e) {
        if (e.fatal) throw e; // clé invalide, quota… inutile d'essayer l'autre format
        errors.push(e.message);
      }
    }

    if (mode === 'auto' || mode === 'generatecontent') {
      try {
        const imageConfig = {};
        if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
        if (cfg.imageSize) imageConfig.imageSize = cfg.imageSize;
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], ...(Object.keys(imageConfig).length ? { imageConfig } : {}) },
        };
        const out = extract(await call('POST', `${BASE}/models/${encodeURIComponent(model)}:generateContent`, body, cfg));
        if (out.images.length) return out;
        errors.push('generateContent : aucune image renvoyée' + (out.text ? ` (« ${out.text.slice(0, 200)} »)` : ''));
      } catch (e) {
        if (e.fatal) throw e;
        errors.push(e.message);
      }
    }
    throw new Error(errors.join(' | ') || 'Échec de la génération');
  },

  /** Demande au modèle texte une réponse JSON (analyse des photos de la pièce) */
  async analyzeJSON(prompt, images, cfg) {
    const model = cfg.textModel || 'gemini-3.8-flash';
    // Les modèles Gemini 3 sont réglés pour fonctionner à la température par défaut :
    // on ne la force basse que pour les anciens modèles 2.x.
    const generationConfig = { responseMimeType: 'application/json' };
    if (/^gemini-2\./.test(model)) generationConfig.temperature = 0.2;
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((im) => ({ inlineData: { mimeType: im.mimeType, data: im.data } }))] }],
      generationConfig,
    };
    const out = extract(await call('POST', `${BASE}/models/${encodeURIComponent(model)}:generateContent`, body, cfg));
    const m = out.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!m) throw new Error('Réponse non exploitable du modèle');
    return JSON.parse(m[0]);
  },
};

async function call(method, url, body, cfg) {
  if (!navigator.onLine) throw Object.assign(new Error("Pas de connexion internet : la génération d'images nécessite internet."), { fatal: true });
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), 'x-goog-api-key': cfg.apiKey.trim() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('Impossible de joindre Google (connexion internet coupée ou bloquée).'), { fatal: true });
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 400);
    const status = json?.error?.status || '';
    let nice = `Gemini ${res.status} : ${msg}`;
    let fatal = false;
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) { nice = 'Clé API invalide. Vérifiez-la dans les Réglages.'; fatal = true; }
    else if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') { nice = `Quota ou plafond de dépense atteint (${msg})`; fatal = true; }
    else if (res.status === 403) nice = `Accès refusé par Google : ${msg} (API « Generative Language » activée ? Facturation active ? Restrictions de la clé ?)`;
    else if (/billing/i.test(msg)) nice = `Facturation requise : ${msg}`;
    throw Object.assign(new Error(nice), { status: res.status, fatal });
  }
  return json;
}

// Parcourt n'importe quelle réponse pour trouver images et textes, quel que soit le format.
function extract(resp) {
  const images = [];
  const texts = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    const inline = n.inlineData || n.inline_data;
    if (inline?.data) images.push({ mimeType: inline.mimeType || inline.mime_type || 'image/png', data: inline.data });
    else if (n.type === 'image' && typeof n.data === 'string') images.push({ mimeType: n.mime_type || n.mimeType || 'image/png', data: n.data });
    if (typeof n.text === 'string' && !n.thought) texts.push(n.text);
    for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
  })(resp);
  return { images, text: texts.join('\n').trim() };
}
