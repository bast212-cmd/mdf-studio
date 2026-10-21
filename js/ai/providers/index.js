// Registre des fournisseurs d'images.
//
// Un fournisseur est un objet qui respecte cette petite interface :
//
//   {
//     id: 'monfournisseur',              // identifiant stable (stocké dans les réglages)
//     label: 'Mon fournisseur',          // nom affiché
//     help: 'texte HTML d’aide',         // affiché dans Réglages (optionnel)
//     fields: [                          // champs de configuration affichés dans Réglages
//       { key: 'apiKey', label: 'Clé API', type: 'secret' },
//       { key: 'model', label: 'Modèle', type: 'text', default: '…', suggestions: [] },
//       { key: 'x', label: '…', type: 'select', options: [['valeur', 'libellé']] },
//     ],
//     isConfigured(cfg) → boolean,
//     modelLabel(cfg) → string,           // affiché en pied de page
//     test(cfg) → Promise<{ok, imageModels?, textModels?}>,          // optionnel
//     generateImage({ prompt, images, aspectRatio }, cfg)
//        → Promise<{ images: [{ mimeType, data(base64) }], text }>,
//     analyzeJSON(prompt, images, cfg) → Promise<object>,            // optionnel (détection des meubles)
//   }
//
// images = [{ mimeType, data }] en base64 sans préfixe ; la 1re est la photo de la pièce.
// Pour ajouter Ideogram ou un autre service : créer providers/ideogram.js sur ce modèle,
// puis l'ajouter à la liste ci-dessous. L'écran Réglages s'adapte tout seul.
//
// La détection des meubles (étape 2) utilise le fournisseur actif s'il sait le faire,
// sinon Gemini s'il est configuré.
import { gemini } from './gemini.js';

export const PROVIDERS = [gemini];

export const getProvider = (id) => PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];

/** Configuration d'un fournisseur, valeurs par défaut comprises */
export function providerConfig(settings, id) {
  const p = getProvider(id);
  const saved = settings?.providers?.[p.id] || {};
  const cfg = {};
  for (const f of p.fields) {
    let v = saved[f.key];
    if (v && f.replaces?.includes(v)) v = f.default; // ancienne valeur par défaut → nouvelle
    cfg[f.key] = v ?? f.default ?? '';
  }
  return { ...saved, ...cfg };
}
