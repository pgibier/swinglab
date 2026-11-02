# Atelier de recherche

Code **hors-ligne** : validation du moteur et préparation de la piste ML.
L'application web ne dépend d'aucun de ces scripts — elle tourne entièrement
dans le navigateur.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Principe : une seule implémentation du moteur

`validate_events.py` n'évalue pas une copie Python des règles : il appelle
`../web/scripts/analyze.ts`, c'est-à-dire **le moteur réellement livré**.
Dupliquer les règles en Python serait le meilleur moyen de valider une version
et d'en expédier une autre.

```
vidéo ──► extract_landmarks.py ──► points.json ──► web/scripts/analyze.ts ──► phases
                (MediaPipe)                              (moteur livré)            │
                                                                                   ▼
labels.json ───────────────────────────────────────────────────► validate_events.py
```

## Valider sans rien télécharger

Le jeu synthétique sert de garde-fou permanent : sa vérité terrain est exacte
par construction, donc tout décalage vient du moteur.

```bash
cd ../web && npx tsx scripts/synth-set.ts /tmp/synthset
cd ../research && python validate_events.py --labels /tmp/synthset/labels.json \
    --landmarks-dir /tmp/synthset --tolerance 3
```

Résultat de référence (10 clips, cadences 30 à 240 i/s) :

| phase   | n  | correct à ±3 img | erreur moyenne |
|---------|----|------------------|----------------|
| address | 10 | 90 %             | 1,20 img       |
| top     | 10 | 100 %            | 1,00 img       |
| impact  | 10 | 100 %            | 0,80 img       |
| finish  | 10 | 100 %            | 0,40 img       |
| **tout**| 40 | **97,5 %**       | **0,85 img**   |

Seules les 4 phases structurantes sont notées : les 4 autres (toe-up,
mi-montée, mi-descente, mi-finish) sont définies par la position du **club**,
que ni le générateur ni le moteur ne connaissent.

## Profil de référence : qualifier un « bon swing »

Plutôt que d'asséner « ton sway dépasse le seuil », l'app peut dire « ton sway
est à 26 %, ce corpus est à 3,5 % en médiane et 5,5 % au 90e centile ». Un
centile se comprend sans connaître la biomécanique, et il est vérifiable.

Le vecteur agrégé est celui que produisent les règles elles-mêmes
(`analyze.ts --metrics`) : une valeur scalaire par règle, dans l'unité déjà
documentée. Aucun second jeu de métriques à maintenir.

```bash
# 1. extraire les points clés de chaque vidéo du corpus
for v in corpus/*.mp4; do
  python extract_landmarks.py "$v" --model pose_landmarker_full.task \
      -o "points/$(basename "${v%.*}").json"
done

# 2. agréger en centiles, par vue
python build_reference.py --landmarks-dir points \
    -o ../web/public/reference/profile.json --label "pros — 180 swings"
```

Déposé dans `web/public/reference/profile.json`, le profil est chargé
automatiquement par l'app et la comparaison apparaît sous chaque défaut. En
son absence, l'app n'affiche simplement aucune comparaison — elle n'en invente
pas.

**Aucun profil n'est livré pour l'instant**, parce qu'aucun corpus réel n'a
encore été mesuré. Un profil synthétique serait trompeur : un débutant lirait
« corpus » et comprendrait « vrais joueurs ».

### Filtrage par qualité, et pourquoi il compte

Un clip dont la pose est mal détectée produit des valeurs aberrantes qui
décalent les centiles. `build_reference.py` écarte donc les clips sur des
critères explicites (couverture de pose, confiance de vue, images de descente)
et **affiche le taux de rejet**. C'est ce taux qui dira si un corpus en basse
résolution est exploitable — plutôt qu'une intuition.

### Le garde-fou qui va avec

Un corpus de référence sert aussi à détecter les règles trop sensibles. La
suite de tests (`npm test`, cas 14) vérifie qu'aucun défaut « important » ne se
déclenche sur 24 swings de bon niveau. C'est ce contrôle qui a révélé que la
règle de stabilité de tête produisait un faux positif systématique.

## Valider sur GolfDB

GolfDB (McNally et al., CVPRW 2019) reste le corpus de swings de
professionnels le plus accessible : 1 400 clips annotés en 8 événements, avec
vue, club et joueur.

⚠️ **Licence — plus restrictive qu'il n'y paraît.** Le dépôt annonce « The code
in this repository is licensed under a Creative Commons
Attribution-NonCommercial 4.0 International License » : cette licence couvre le
**code**. Le dépôt n'énonce **aucune licence** pour les annotations ni pour les
vidéos, qui sont des extraits **YouTube appartenant à des diffuseurs tiers**.
Conclusion pratique : utilisable pour *mesurer* en recherche, pas pour livrer.
Pour un produit commercial, il faut re-dériver le profil de référence sur un
corpus qu'on possède ou qu'on licencie.

Ce qui est réellement disponible :

| Élément | Où | Remarque |
|---|---|---|
| Annotations | `data/golfDB.mat` et `data/golfDB.pkl`, **committés dans le dépôt** | un `git clone` suffit |
| Clips 160×160 | lien Google Drive donné dans le README du dépôt | prêts à l'emploi, mais très basse résolution |
| Vidéos d'origine | à récupérer soi-même sur YouTube via les `youtube_id` | aucun script fourni |

Le format des annotations : colonnes
`id, youtube_id, player, sex, club, view, slow, events, bbox, split`.
`events` contient 10 valeurs — début, 8 phases, fin — en numéros d'images
**absolus** de la vidéo d'origine ; les clips étant rognés, les phases relatives
valent `events[1:9] - events[0]`. `bbox` est `[x, y, largeur, hauteur]`
normalisé. `split` vaut 1 à 4.

```bash
git clone https://github.com/wmcnally/golfdb /tmp/golfdb
python golfdb_labels.py /tmp/golfdb/data/golfDB.mat -o data/labels.json --view face-on
curl -LO https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
python validate_events.py --labels data/labels.json \
    --videos-dir data/videos_160 --model pose_landmarker_full.task
```

**Non testé en l'état** : la lecture de `golfDB.mat` suit la structure
documentée par le dépôt, mais le fichier n'a pas pu être récupéré pour le
vérifier. En cas de champ manquant, le script s'arrête avec un message
explicite plutôt que de produire des chiffres faux.

**Réserve sur la résolution** : les clips fournis font 160×160, le joueur y
occupant environ 160 px de haut. C'est marginal pour une estimation de pose et
cela bruitera les mesures. Le taux de rejet affiché par `build_reference.py`
tranchera — si l'essentiel du corpus est écarté, il faudra passer par les
vidéos d'origine.

Sur la comparaison avec les chiffres publiés : GolfDB annonce une PCE de
71,5 % avec les poids fournis, selon **sa propre définition de tolérance**. Les
valeurs mesurées ici sont données à tolérance fixe en images et ne sont donc
pas directement comparables — il faut aligner la définition avant de conclure.

## Pourquoi pas SwingNet directement

| | Règles cinématiques (retenu) | SwingNet / GolfDB |
|---|---|---|
| Licence | aucune contrainte | code CC BY-NC, vidéos sans licence énoncée |
| Explicabilité | dit pourquoi elle déclenche | boîte noire |
| Poids à embarquer | 0 | ~20 Mo |
| Phases « club » | approximations assumées | apprises depuis l'image |

SwingNet reste pertinent comme **référence de comparaison** : si la détection
par règles s'avérait nettement moins bonne sur GolfDB, l'arbitrage changerait.
C'est précisément ce que ce dossier permet de mesurer.
