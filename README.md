# SwingLab

Analyse de swing de golf à partir d'une simple vidéo de téléphone.
Détection des points du corps, des 8 phases du swing, et diagnostic des
défauts avec exercices correctifs.

**Tout le calcul se fait dans le navigateur.** Aucun serveur d'inférence, donc
aucun coût d'hébergement — et la vidéo ne quitte jamais l'appareil.

## Utiliser l'app sans terminal

L'app est un site statique : elle se déploie toute seule à chaque push, via
GitHub Actions, et s'utilise depuis le navigateur du téléphone.

**Activation, une seule fois** (dans le navigateur, aucun terminal) :
`Settings` → `Pages` → *Build and deployment* → **Source : GitHub Actions**.

L'adresse devient ensuite `https://<compte>.github.io/swinglab/`. Ouvre-la sur
ton téléphone et ajoute-la à l'écran d'accueil : elle s'installe comme une
application.

Le modèle de pose est embarqué dans le site par le workflow, donc l'app ne
dépend d'aucun CDN tiers.

## Développement local

Node 20.19 ou plus récent (Node 20.18 ne suffit pas pour la chaîne de build).

```bash
cd web
npm install
npm run setup:assets
npm run dev
```

Pour le mode hors-ligne complet (modèles servis en local plutôt que depuis le
CDN Google) :

```bash
npm run setup:assets -- --models full
```

## Ce que ça fait

- **Pose** — MediaPipe Pose Landmarker (33 points, dont talons et orteils) en
  WASM, exécuté image par image sur la vidéo importée.
- **Phases** — les 8 événements du swing (adresse, club à l'horizontale,
  mi-montée, sommet, mi-descente, impact, mi-finish, finish).
- **Diagnostic** — 12 règles biomécaniques : posture et flexion à l'adresse,
  écartement des pieds, sway, reverse pivot, stabilité de tête, early
  extension, glissement du bassin, loss of posture, chicken wing, tempo,
  équilibre au finish.
- **Lecteur** — vidéo d'origine + overlay squelette, ralenti jusqu'à 0,15×,
  avance image par image, saut direct sur chaque phase, et une annotation
  dédiée par défaut (lignes de référence, flèches de déplacement).

Deux partis pris qui structurent tout le reste :

**Chaque règle déclare la vue dans laquelle le défaut est réellement visible,
et se tait sinon.** L'inclinaison du buste vers l'avant est invisible sur une
vidéo de face ; le chicken wing est masqué par le corps en vue de derrière.
Plutôt que de deviner, l'app affiche ce qu'elle n'a pas pu évaluer et quel
angle filmer pour le débloquer.

**Toutes les mesures sont exprimées en longueurs de torse, jamais en pixels.**
L'analyse devient indépendante de la distance au téléphone, de la résolution
et de la morphologie du joueur.

## Tests

```bash
cd web
npm test                  # 33 vérifications sur 12 swings synthétiques
node scripts/e2e.mjs video.mp4   # chaîne complète dans un vrai navigateur
```

Les swings synthétiques portent des défauts injectés de façon contrôlée :
chaque règle doit déclencher sur ce qu'elle prétend mesurer, rester muette sur
un swing propre, et rester muette dans la vue où le défaut est invisible.

Le test navigateur nécessite Playwright, volontairement hors dépendances du
projet (~300 Mo) : `npm i -D playwright && npx playwright install chromium`.

### Profil de référence

L'app peut situer chaque mesure dans un corpus de référence (« ton sway est à
26 %, la référence est à 3,5 % en médiane ») plutôt que de se contenter d'un
seuil. Le corpus se construit avec
[`research/build_reference.py`](research/README.md) et se dépose dans
`web/public/reference/profile.json` ; l'app le charge alors automatiquement.

**Aucun profil n'est livré** tant qu'aucun corpus réel n'a été mesuré : un
profil synthétique serait trompeur.

Validation de la détection de phases : voir [`research/`](research/README.md).
Référence actuelle sur jeu synthétique — **97,5 % des phases à ±3 images**,
erreur moyenne 0,85 image, sur des cadences de 30 à 240 i/s.

## Déploiement

Le build est un site statique : n'importe quel hébergeur gratuit convient
(Cloudflare Pages, GitHub Pages, Netlify).

```bash
cd web && npm run build   # → web/dist
```

Avec `npm run setup:assets -- --models full`, les modèles sont inclus dans
`dist` (~10 Mo) et l'app ne dépend plus d'aucun CDN tiers.

## Ce que ça ne fait pas

À lire avant de prendre un diagnostic au pied de la lettre.

- **Le club n'est pas détecté.** Aucun modèle public ne le fait de façon
  fiable, et à 30 i/s une tête de club est un trait flou. Les 4 phases que
  GolfDB définit par la position du club sont donc des approximations basées
  sur la hauteur des mains, avec une fiabilité plafonnée à 60 % dans l'app.
- **Les seuils ne sont pas calés sur des données annotées.** Il n'existe aucun
  jeu de données public étiqueté en défauts de swing. Ils viennent de la
  littérature biomécanique et de l'enseignement du golf, et sont volontairement
  conservateurs. Ils sont tous regroupés dans
  [`web/src/core/config.ts`](web/src/core/config.ts).
- **La qualité de pose sur vraies vidéos n'a pas été mesurée ici.** Le moteur
  est validé sur séquences synthétiques et la chaîne navigateur sur une vidéo
  de test, mais aucune vidéo de swing réelle n'était disponible dans
  l'environnement de développement. C'est la première chose à vérifier.
- **Mesures 2D monoculaires.** Ordres de grandeur fiables, pas des valeurs de
  laboratoire. La profondeur estimée par MediaPipe n'est volontairement pas
  utilisée pour le diagnostic.

## Licences

- **MediaPipe** — Apache-2.0, utilisable sans contrainte.
- **GolfDB** — le dépôt place son **code** sous CC BY-NC 4.0 et n'énonce
  **aucune licence** pour les annotations ni pour les vidéos, qui sont des
  extraits YouTube appartenant à des diffuseurs. C'est donc plus contraignant
  qu'un simple « non commercial ». Utilisé uniquement pour *mesurer* la
  détection de phases (cf. `research/`) ; rien n'en est embarqué dans
  l'application.
- **Ultralytics / YOLO-pose** — écarté volontairement : AGPL-3.0, incompatible
  avec une éventuelle version commerciale fermée.

## Suite

1. Valider sur de vraies vidéos de swing, tous angles et cadences.
2. Caler les seuils avec un enseignant sur un échantillon relu à la main.
3. Service worker pour un vrai mode hors-ligne.
4. Historique des swings et suivi de progression (stockage local).
5. Détection de la tête de club (YOLO entraîné sur frames annotées), puis
   plan de swing et chemin de club.
6. Comparer la détection de phases à SwingNet sur GolfDB.

Détail des choix techniques : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
