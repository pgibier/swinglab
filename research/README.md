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

## Valider sur GolfDB

⚠️ **GolfDB est sous licence CC BY-NC 4.0 — usage non commercial.** Il sert ici
uniquement à *mesurer*. Aucun poids entraîné sur GolfDB ni aucune de ses vidéos
ne doit être embarqué dans l'application.

1. Récupère `golfDB.mat` et les clips depuis
   [github.com/wmcnally/golfdb](https://github.com/wmcnally/golfdb)
   (McNally et al., *GolfDB: A Video Database for Golf Swing Sequencing*,
   CVPRW 2019) — le téléchargement est manuel.
2. Télécharge un modèle de pose :
   ```bash
   curl -LO https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
   ```
3. Convertis les annotations, puis évalue :
   ```bash
   python golfdb_labels.py data/golfDB.mat -o data/labels.json --view face-on
   python validate_events.py --labels data/labels.json \
       --videos-dir data/videos_160 --model pose_landmarker_full.task
   ```

**Non testé en l'état** : la lecture de `golfDB.mat` suit la structure
documentée par le dépôt, mais le fichier n'a pas pu être récupéré pour le
vérifier. En cas de champ manquant, le script s'arrête avec un message
explicite plutôt que de produire des chiffres faux.

Sur la comparaison avec les chiffres publiés : GolfDB annonce une PCE de
76,1 % pour SwingNet, avec **sa propre définition de tolérance**. Les valeurs
ci-dessus sont données à tolérance fixe en images et ne sont donc pas
directement comparables — il faut aligner la définition avant de conclure.

## Pourquoi pas SwingNet directement

| | Règles cinématiques (retenu) | SwingNet / GolfDB |
|---|---|---|
| Licence | aucune contrainte | CC BY-NC 4.0 — non commercial |
| Explicabilité | dit pourquoi elle déclenche | boîte noire |
| Poids à embarquer | 0 | ~20 Mo |
| Phases « club » | approximations assumées | apprises depuis l'image |

SwingNet reste pertinent comme **référence de comparaison** : si la détection
par règles s'avérait nettement moins bonne sur GolfDB, l'arbitrage changerait.
C'est précisément ce que ce dossier permet de mesurer.
