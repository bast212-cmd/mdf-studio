# Studio d'aménagement IA (style Mobilier de France) — version autonome

Application web installable (PWA) pour visualiser un nouveau meuble dans une pièce réelle :

1. **La pièce** : photos (import ou prise directe) + longueur, largeur, hauteur sous plafond.
2. **Le plan** : plan 2D à l'échelle ; meubles présents placés à la main ou détectés par l'IA ; point de vue de la photo.
3. **Aménagement** : ajout d'un meuble (photo en direct ou bibliothèque), en remplacement ou en placement libre, avec rotation, couleur et matière.
4. **Rendu IA** : retouche de la photo par Gemini, comparaison avant/après, sauvegarde, partage, régénération.

**Rendu rapide** (bouton sur l'accueil) : photo de la pièce › zone tracée au doigt sur la photo (remplacer ce qui s'y trouve, ou ajouter) › photo du meuble › photo de texture facultative › rendu. Sans plan ni bibliothèque. Les rendus rapides apparaissent dans « Mes projets » et dans les sauvegardes comme les autres.

**Aucun serveur.** Tout tourne dans le navigateur de chaque appareil :

| | |
|---|---|
| Stockage | Sur l'appareil (IndexedDB) : projets, photos, rendus, bibliothèque, réglages |
| Hors ligne | Tout fonctionne sans internet, sauf la génération d'images et la détection des meubles |
| IA | Appelée directement depuis l'appareil avec votre clé Google AI Studio (Réglages) |
| Partage | Bibliothèque exportée en fichier `.zip` (photos et cotes incluses) |

---

## 1. Mise en ligne (une seule fois)

Safari n'installe une application web que si elle est servie en **HTTPS**. Il faut donc déposer ce dossier sur un hébergement **statique et gratuit** : il ne fait que distribuer les fichiers de l'application, aucun calcul ni aucune donnée n'y transite. Aucun ordinateur à laisser allumé.

Au choix :

- **Netlify Drop** (le plus simple) : ouvrez https://app.netlify.com/drop, glissez-déposez le dossier `mdf-studio`. Créez un compte gratuit pour garder l'adresse.
- **GitHub Pages** : créez un dépôt, déposez-y le contenu du dossier, puis *Settings › Pages › Deploy from branch*. Adresse du type `https://votre-nom.github.io/mdf-studio/`.
- **Cloudflare Pages** : même principe.

⚠ **Gardez toujours la même adresse.** Les données de chaque appareil sont rattachées à l'adresse du site : en changer revient à repartir d'une application vide (utilisez alors *Réglages › Sauvegarde complète* pour transférer).

### Mettre à jour l'application
1. Modifiez les fichiers, puis régénérez `js/app.bundle.js` (commande ci-dessus).
2. Incrémentez `VERSION` dans `sw.js` **et** `APP_VERSION` dans `js/store.js` (ex. `2.0.1`).
3. Si vous avez ajouté un fichier JS/CSS/image, ajoutez-le à la liste `FILES` de `sw.js`.
4. Redéposez le dossier. Sur chaque appareil, l'application affiche « Nouvelle version disponible › Mettre à jour ». Les données sont conservées.

### Utiliser sur l'ordinateur sans le mettre en ligne
Double-cliquez sur `index.html` : l'application s'ouvre dans le navigateur et fonctionne (Chrome ou Edge recommandés).
Limites de ce mode : pas d'installation ni de mode hors ligne garanti, et les données sont liées à l'emplacement du dossier (si vous le déplacez, vous repartez d'une application vide : faites d'abord une sauvegarde depuis Réglages).

### Modifier le code
Les sources sont dans `js/`. La page charge un fichier regroupé, `js/app.bundle.js`, qu'il faut régénérer après chaque modification :
```bash
npx esbuild js/app.js --bundle --format=iife --target=safari15,chrome100 --charset=utf8 --legal-comments=none --outfile=js/app.bundle.js
```
Le fichier regroupé est fourni : Netlify n'a rien à compiler (voir `netlify.toml`).

## 2. Installation sur l'iPad

1. Ouvrez l'adresse dans **Safari**.
2. Bouton **Partager** › **Sur l'écran d'accueil**.
3. Ouvrez l'application **depuis l'icône** et travaillez toujours depuis l'icône.

Pourquoi c'est indispensable : dans un onglet Safari, les données d'un site non visité pendant 7 jours peuvent être effacées. Les applications installées sur l'écran d'accueil en sont protégées. Attention, l'app installée a **son propre stockage**, distinct de l'onglet Safari : installez-la avant de saisir vos données.

Sur ordinateur : Chrome ou Edge proposent « Installer » dans la barre d'adresse ; Safari sur Mac : *Fichier › Ajouter au Dock*.

## 3. Clé API (sur chaque appareil)

1. Créez une clé sur https://aistudio.google.com/apikey.
2. Activez la facturation sur le projet Google Cloud de la clé (paiement à l'usage, environ 0,02 à 0,04 $ par image 1K). L'abonnement Gemini grand public ne donne pas accès à l'API.
3. Dans Google Cloud : *Facturation › Budgets et alertes* pour fixer un plafond, et *API et services › Identifiants* pour limiter la clé à l'API « Generative Language ».
4. Dans l'application : **Réglages**, collez la clé, **Tester la clé**.

La clé reste sur l'appareil et n'est jamais incluse dans les exports.

## 4. Partager une bibliothèque

**Bibliothèque › Partager** : toute la bibliothèque ou une seule pièce. Sur iPad, « Partager… » ouvre AirDrop, Mail, *Enregistrer dans Fichiers* (iCloud Drive, Google Drive). Sur ordinateur, le fichier est téléchargé.

**Bibliothèque › Importer** sur l'autre appareil : un aperçu indique ce qui sera ajouté ou mis à jour. Rien n'est supprimé ; pour un même meuble, la version la plus récente est gardée. Réimporter le même fichier ne crée pas de doublon.

## 5. Sauvegarde et reprise de l'ancienne version

- **Réglages › Créer une sauvegarde complète** : projets, rendus et bibliothèque dans un `.zip`. À faire de temps en temps, puisque les données ne vivent que sur l'appareil.
- **Réglages › Restaurer / importer un fichier** : accepte une sauvegarde ou une bibliothèque.
- **Réglages › Reprendre l'ancienne version** (ordinateur) : choisissez le dossier `data` de l'ancienne version serveur (`db.json`, `uploads/`, `renders/`). Tout est copié ; ensuite, exportez la bibliothèque vers l'iPad.

---

## Structure

```
index.html, manifest.webmanifest, sw.js     page, manifeste d'installation, service worker (hors ligne)
css/styles.css
img/                                        icônes de l'application (+ logo.png facultatif)
js/app.bundle.js   code regroupé chargé par la page (régénéré avec esbuild, voir plus haut)
js/app.js          routeur, démarrage, installation, mises à jour
js/project.js      parcours en 4 étapes
js/plan.js         éditeur de plan SVG
js/library.js      bibliothèque, fiche meuble, catégories
js/settings.js     écran Réglages
js/transfer.js     fenêtres d'export / import
js/camera.js       prise de photo
js/api.js          couche de données (remplace l'ancienne API REST)
js/data/db.js      IndexedDB
js/data/media.js   images locales (stockage, affichage, partage)
js/data/zip.js     lecture / écriture ZIP sans dépendance
js/data/bundle.js  format d'export et règles de fusion
js/data/legacy.js  reprise des données de l'ancienne version
js/ai/ai.js        génération et détection (ancien server.js)
js/ai/prompt.js    construction du prompt à partir du plan (inchangé)
js/ai/providers/   fournisseurs d'images interchangeables
```

### Ajouter un fournisseur d'images (Ideogram, …)
L'interface est décrite en tête de `js/ai/providers/index.js`. Créez `js/ai/providers/ideogram.js` qui exporte un objet `{ id, label, fields, isConfigured, modelLabel, generateImage }`, ajoutez-le au tableau `PROVIDERS` et à la liste `FILES` de `sw.js`. L'écran Réglages affiche alors un choix de fournisseur et ses champs. Vérifiez que le service accepte les appels directs depuis un navigateur (CORS) : sinon il faudrait un relais serveur.

### Préparation de la synchronisation Google Drive (étape 2)
Le code est organisé pour l'ajouter sans tout refaire :
- chaque meuble et projet a un identifiant stable et une date `updatedAt` ;
- les suppressions sont tracées (`meta.tombstones`) ;
- `api.onChange()` signale chaque modification ;
- `js/data/bundle.js` sait déjà produire un paquet et le fusionner (la version la plus récente gagne).

Un module `js/sync/drive.js` pourra : se connecter (Google Identity Services, client OAuth à créer dans Google Cloud), écouter `onChange`, envoyer le paquet de la bibliothèque dans un dossier Drive, et à l'ouverture récupérer celui des autres appareils pour le fusionner avec `planImport` / `applyImport`, en appliquant les `tombstones`.

### Logo
Le logo s'anime selon la taille de l'écran : carré et nom côte à côte sur ordinateur, « Studio IA » sous le nom sur tablette, version resserrée sur téléphone, carré seul sur très petit écran. Quand on fait défiler la page, le nom se replie derrière le carré et réapparaît au survol (ordinateur).

Pour l'activer, déposez dans `img/` les deux parties du logo officiel, au format SVG (idéal), PNG ou WebP, sur fond transparent et rognées au plus juste :
- `img/logo-carre.svg` (ou .png) : le logo carré seul ;
- `img/logo-nom.svg` (ou .png) : le nom « Mobilier de France » seul, dans sa typographie.

Sans ces fichiers, l'en-tête affiche `img/logo.png` s'il existe, sinon le logo du site Mobilier de France, sinon le texte. Assurez-vous d'avoir le droit d'utiliser la marque.
