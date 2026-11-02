# Architecture

## Pourquoi le calcul dans le navigateur

Faire tourner MediaPipe côté serveur demande environ 1 Go de RAM par instance.
Aucune offre gratuite ne tient ça durablement. En déplaçant l'inférence dans
le navigateur :

- coût d'infrastructure nul, quel que soit le nombre d'utilisateurs ;
- aucune vidéo transmise, donc aucune donnée personnelle à héberger ni à
  purger — un argument de conformité autant que de confiance ;
- hébergement statique gratuit (Cloudflare Pages, GitHub Pages).

Contrepartie : la puissance dépend du téléphone, et le modèle doit rester
léger. Le projet garde la porte ouverte à une inférence serveur via l'interface
d'extraction (`web/src/pose/`), isolée du moteur d'analyse.

## Choix du modèle de pose

| Modèle | Points | Précision | Licence | Décision |
|---|---|---|---|---|
| **MediaPipe Pose Landmarker** (BlazePose GHUM) | **33** | bonne, suivi temporel intégré | **Apache-2.0** | **retenu** |
| MoveNet | 17 | très rapide, pas de 3D | Apache-2.0 | pas d'avantage décisif |
| YOLO-pose (Ultralytics) | 17 | robuste en scène chargée | **AGPL-3.0** | écarté (licence) |
| RTMPose / ViTPose | 17–26 | meilleure précision publiée | Apache-2.0 | piste serveur (v2) |

Le facteur décisif n'est pas la précision brute mais les **33 points** :
BlazePose fournit talons et orteils, là où les 17 points COCO s'arrêtent aux
chevilles. Sans les appuis, pas de transfert de poids, pas d'early extension,
pas d'équilibre au finish — la moitié du diagnostic disparaît.

## Flux de données

```
vidéo ─► mesure des FPS ─► parcours par seek ─► MediaPipe ─► PoseSequence
                                                                  │
   nettoyage temporel ◄───────────────────────────────────────────┘
   (anisotropie, visibilité, interpolation, Savitzky-Golay)
         │
         ├─► signaux (trajectoire et vitesse des mains)
         ├─► phases (8 événements)
         ├─► repère corporel (échelle, latéralité, vue, orientations)
         ├─► métriques (angles, translations, proxies de rotation)
         └─► règles ─► rapport (défauts, non évaluables, score)
```

## Modules

| Chemin | Rôle |
|---|---|
| `web/src/core/config.ts` | **source de vérité unique** de tous les seuils |
| `web/src/core/smoothing.ts` | nettoyage temporel, Savitzky-Golay |
| `web/src/core/normalize.ts` | échelle, latéralité, classification de vue |
| `web/src/core/events.ts` | détection des 8 phases |
| `web/src/core/metrics.ts` | séries temporelles biomécaniques |
| `web/src/core/faults/` | une règle par défaut, groupées par phase |
| `web/src/core/report.ts` | orchestration, qualité, score |
| `web/src/pose/` | MediaPipe et extraction vidéo (seule partie liée au navigateur) |
| `web/src/components/` | interface React |
| `research/` | validation hors-ligne, GolfDB |

Le dossier `core/` ne dépend ni de React ni de MediaPipe : il tourne dans le
navigateur, dans Node, et pourrait tourner dans un Web Worker sans
modification.

## Décisions non évidentes

**Correction de l'anisotropie.** MediaPipe normalise `x` sur la largeur et `y`
sur la hauteur, indépendamment. Sur une vidéo 16:9, tout angle calculé
directement sur ces coordonnées est faux d'une dizaine de degrés. Le moteur
remet `x` à l'échelle de `y` avant toute mesure. L'affichage, lui, utilise les
coordonnées brutes, qui correspondent au cadre rendu.

**Savitzky-Golay plutôt qu'une moyenne glissante.** Une moyenne glissante
écrase les pics — or c'est exactement un pic qu'on cherche pour localiser
l'impact. Savitzky-Golay lisse en préservant la forme locale.

**Détection d'impact géométrique, pas par pic de vitesse.** Ancrer l'impact sur
le maximum global de vitesse des mains fonctionne sur un swing de joueur
confirmé, où la descente est trois fois plus rapide que la montée. Chez un
débutant qui précipite sa montée, les deux pics deviennent comparables et
l'« impact » se retrouve en pleine montée — c'est un cas réel, reproduit en
test. Le moteur utilise donc la signature verticale invariante du swing : les
mains montent, redescendent, remontent. Le sommet est le changement de sens,
l'impact le point bas qui suit.

**Vérification du type de fichier servi.** Les hébergeurs statiques avec repli
SPA renvoient `index.html` en HTTP 200 pour un chemin inconnu. Un contrôle
naïf `response.ok` conclut donc que le modèle est présent, et MediaPipe reçoit
du HTML — avec pour seul symptôme un « Unable to open zip archive » illisible.
Le chargeur vérifie le `content-type` et la taille.

**Le gating par vue.** Une règle qui mesure un défaut invisible sous l'angle
filmé produit un chiffre, et ce chiffre est du bruit. Chaque règle déclare ses
vues valides ; hors de celles-ci, elle renvoie un « non évaluable » avec la
raison, affiché à l'utilisateur.

**Overlay en canvas, pas gravé dans la vidéo.** Pas de ré-encodage (analyse
bien plus rapide), overlays activables, scrub image par image fluide, et
annotations différentes selon le défaut sélectionné — sans retraitement.

## Calibration

Tous les seuils sont dans `web/src/core/config.ts`, en unités de torse (U) ou
en degrés. Ils proviennent de la littérature biomécanique et de l'enseignement
du golf, **pas** d'un ajustement sur données annotées : aucun jeu public
n'étiquette les défauts de swing. Ils sont volontairement conservateurs —
taire un défaut coûte moins cher que d'affirmer un faux positif à un débutant.

Chaque diagnostic sort avec une confiance = adéquation de la vue × fiabilité
des phases utilisées × visibilité des points clés, plafonnée à 0,95 : aucune
mesure monoculaire ne mérite une certitude totale. Le score global pondère
chaque pénalité par cette confiance.

## Pistes

- **Tête de club** : aucun modèle public exploitable. Piste réaliste, YOLO
  entraîné sur frames annotées, uniquement au-delà de 60 i/s.
- **RTMPose côté serveur** : l'interface d'extraction est isolée, le moteur
  n'aurait pas à changer.
- **SwingNet** : à comparer sur GolfDB (cf. `research/`), en gardant à l'esprit
  que sa licence CC BY-NC interdit de l'embarquer dans un produit commercial.
