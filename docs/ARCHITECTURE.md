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

**Le recadrage automatique sur le swing.** Une vidéo de téléphone dure
volontiers neuf secondes pour un swing qui en occupe trois : le joueur se
place, joue, puis range. Un pré-passage très bon marché — différence d'images
sur une vignette de 64 pixels de haut — localise le mouvement, et l'inférence
de pose ne tourne que sur cette fenêtre. Mesuré sur une vidéo réelle : 197
images analysées au lieu de 535, pour un résultat identique à l'image près.

Le seuil ne porte pas sur une fraction du pic mais sur l'écart à la ligne de
base, et l'expansion part du pic au lieu de balayer la vidéo. Les deux
corrections viennent de la même mesure : dans un practice, le bruit de fond
atteint 25 % du pic du swing, et le joueur bouge aussi en entrant dans le
champ. Un filet de sécurité complète le dispositif — si le swing détecté
touche un bord de la fenêtre, l'extraction est refaite sur la vidéo entière
plutôt que de rendre une analyse amputée.

**Un détecteur de pose neuf à chaque analyse.** En mode VIDEO, MediaPipe
refuse tout horodatage inférieur au précédent sur toute la durée de vie du
détecteur. Le réutiliser d'une vidéo à l'autre, dont les horodatages repartent
de zéro, cassait la seconde analyse — bug invisible pour un test qui ne charge
qu'une vidéo. Et au-delà de l'horodatage, ce mode entretient un suivi temporel
dont la conservation ferait fuiter la pose du joueur précédent dans les
premières images de la suivante. Seul le runtime WASM, coûteux et indépendant
de la vidéo, est conservé.

**La dérive de caméra.** Les pieds d'un joueur ne bougent pas avant l'impact.
Tout déplacement apparent des chevilles vient donc de la caméra — téléphone
tenu à la main, panoramique, zoom — et contamine toutes les mesures de
translation : tête, bassin, équilibre. Les chevilles sont le seul repère du
corps qu'on puisse supposer fixe, donc le seul détecteur de dérive disponible
sans mire ni capteur. Sur le corpus de professionnels, la dérive médiane est
de 8 % du torse et 32 % des clips dépassent 10 % : ignorer ce phénomène
faussait les seuils. L'app avertit désormais l'utilisateur.

**Le gating par vue.** Une règle qui mesure un défaut invisible sous l'angle
filmé produit un chiffre, et ce chiffre est du bruit. Chaque règle déclare ses
vues valides ; hors de celles-ci, elle renvoie un « non évaluable » avec la
raison, affiché à l'utilisateur.

**Overlay en canvas, pas gravé dans la vidéo.** Pas de ré-encodage (analyse
bien plus rapide), overlays activables, scrub image par image fluide, et
annotations différentes selon le défaut sélectionné — sans retraitement.

## Calibration

Tous les seuils sont dans `web/src/core/config.ts`, en unités de torse (U) ou
en degrés, et **tous sont calés sur 409 swings de professionnels** — filtrés
sur la qualité de pose, la fiabilité des phases détectées et la stabilité de
la caméra. Règle de calage : « léger » au 90ᵉ centile du corpus, « important »
au 98ᵉ. Un bon joueur traverse donc l'analyse sans être couvert d'alertes.

Ce que la mesure a corrigé, et qui justifie toute la démarche : avec les
seuils issus de la littérature et de l'enseignement, **six règles sur douze se
déclenchaient sur plus d'un quart des professionnels**.

| règle | avant | après |
|---|---|---|
| stabilité de la tête | 84 % | 12 % |
| chicken wing | 63 % | 13 % |
| écartement des pieds | 50 % | 2 % |
| tempo | 45 % | 22 % |
| early extension | 40 % | 12 % |
| équilibre au finish | 35 % | 10 % |

La stabilité de la tête est le cas le plus net : le seuil enseigné de 15 % du
torse déclenchait sur 84 % des professionnels, dont 40 % en « important ».
La médiane réelle est de 23 % et le 90ᵉ centile de 40 % — la tête d'un bon
joueur se déplace, et nettement. Un seuil plausible n'est pas un seuil juste.

**Le profil de référence est construit par le moteur lui-même.** Une première
version dérivait le tempo des annotations humaines de GolfDB ; confrontée à la
mesure du moteur sur les mêmes clips, elle donnait 3,39 contre 2,5, parce que
l'adresse n'y est pas définie de la même façon. Référence et mesure doivent
passer par le même code, sans quoi on compare l'utilisateur à autre chose que
ce qu'on lui mesure.

**Calage par famille de club.** Le club change ce qui est normal : écartement
des pieds de 1,27× la largeur d'épaules au fer contre 1,54× au driver,
inclinaison du buste de 34° contre 28°. Une surcharge de seuils n'est émise que
là où la mesure la justifie — écart des médianes supérieur à 30 % de la
dispersion interne des groupes :

| dépend du club | effet modéré | indépendant |
|---|---|---|
| écartement des pieds (1,26) | early extension (0,38) | tempo (0,22) |
| inclinaison du buste (1,02) | genoux à l'adresse (0,42) | slide (0,21) |
| perte de posture (0,55) | stabilité de la tête (0,41) | équilibre au finish (0,20) |
| | reverse pivot (0,34) | chicken wing (0,14), sway (0,02) |

Le club déplace la **bande** ; la largeur des queues de gravité est estimée sur
le corpus entier. Sur un groupe de 24 swings, l'écart entre 90ᵉ et 98ᵉ centile
n'est connu qu'à quelques unités près, et s'en servir ferait sauter le
diagnostic de « rien » à « important » en 1,6°.

Le wedge emprunte la distribution des fers : le corpus n'en contient que
quelques-uns, et inventer une bande sur si peu de swings serait pire que
d'utiliser la famille la plus proche. Sans club précisé, la bande commune
s'applique.

Vérification : analysé avec le club réel de chaque clip, le corpus déclenche
10 à 14 % de défauts « légers » et 0 à 5 % d'« importants » par règle — la
cible visée.

**Réserve** : ce corpus est fait d'images de retransmission. Les conditions de
prise de vue diffèrent d'un téléphone posé au sol, et les valeurs restent des
ordres de grandeur mesurés, pas une norme.

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
  que le code de GolfDB est sous CC BY-NC et que ses vidéos sont des extraits
  YouTube de tiers sans licence énoncée — donc utilisables pour mesurer, pas
  pour livrer.
