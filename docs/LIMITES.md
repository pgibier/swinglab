# Ce que la pose seule ne peut pas dire

Document de résultats négatifs. Chaque section rapporte une mesure, pas une
intuition, parce que chacune a invalidé une intention de départ.

## 1. Un indice de qualité de swing n'est pas dérivable de la géométrie du corps

Le constat de départ : un utilisateur débutant obtenait 96/100 sur des swings
qu'il jugeait ratés.

**Première vérification — où se situe ce swing dans le corpus professionnel ?**

| métrique | sa valeur | p10 pro | médiane | p90 | son centile |
|---|---|---|---|---|---|
| stabilité de la tête | 9,9 | 11,4 | 19,3 | 28,7 | **5ᵉ** |
| perte de posture | 6,5 | 1,8 | 5,9 | 11,3 | 58ᵉ |
| tempo | 2,8 | 0,1 | 2,5 | 3,8 | 61ᵉ |
| flexion des genoux | 161,6 | 147,8 | 159,1 | 167,4 | 65ᵉ |
| early extension | 12,7 | 1,3 | 8,4 | 16,5 | 74ᵉ |
| équilibre au finish | 6,5 | 2,1 | 4,6 | 9,7 | 74ᵉ |
| inclinaison du buste | 37,4 | 21,7 | 29,3 | 36,3 | 92ᵉ |

**Cinq métriques sur sept sont dans la plage p10–p90 des professionnels**, et
la stabilité de tête est meilleure que celle de 95 % d'entre eux. Le 96
n'était donc pas un bug : il décrivait fidèlement ce qui était mesuré.

**Deuxième vérification — un score par centiles ferait-il mieux ?**

Formule testée : pénaliser l'écart au centre de la distribution sur chaque
métrique, en pondérant l'écart moyen et le pire écart. Sur le swing de
l'utilisateur, elle donne 64 au lieu de 100 — prometteur. Appliquée au corpus
professionnel lui-même :

| population | p10 | médiane | p90 |
|---|---|---|---|
| 409 swings de pros, clips propres | 56 | **64** | 77 |

**Les professionnels obtiennent exactement la même note que l'utilisateur.**
La formule n'est pas plus juste, seulement plus sévère : elle punit la
variation normale, puisque la moitié d'une population se situe par
construction au-dessus de sa médiane.

**Conclusion.** Les deux formulations concordent : sur les grandeurs
mesurables par la pose, ce swing est indiscernable de la population
professionnelle. Aucune fonction de score sur ces grandeurs ne pourra donc
le distinguer, sauf à être arbitrairement sévère — ce qui serait faux dans
l'autre sens.

Ce qui sépare réellement les niveaux — qualité de contact, orientation de la
face, chemin de club, point bas — n'est pas dans le corps. L'indice est donc
présenté pour ce qu'il est : une conformité posturale, accompagnée de la
liste explicite de ce qu'il ne couvre pas.

## 2. Le séquençage proximal-distal n'est pas mesurable en 2D

L'ordre bassin → torse → bras est l'un des rares marqueurs biomécaniques qui
sépare vraiment les niveaux. Tentative de mesure sans 3D : la largeur
apparente des hanches et des épaules varie avec leur rotation, donc sa
dérivée donne une vitesse de rotation à un facteur près — suffisant pour
comparer des instants de pic.

Mesuré sur 370 swings de professionnels, vue de face :

| segment | pic médian (0 = sommet, 1 = impact) | p25 | p75 |
|---|---|---|---|
| bassin | 0,97 | 0,17 | 1,00 |
| torse | 1,00 | 0,83 | 1,00 |
| mains | 1,00 | 0,96 | 1,00 |

L'ordre attendu n'est respecté que dans **72 %** des cas chez des
professionnels, et les pics s'agglutinent sur l'impact. Le signal est
dominé par une montée monotone jusqu'au contact, pas par la rotation. Non
livré.

## 3. Le manche est mesurable sur bonne vidéo, pas calibrable sur le corpus

Le manche est une structure fine, rectiligne et contrastée partant des mains
— un segment de droite ancré sur un point que la pose donne déjà.

Sur la vidéo d'un utilisateur (1080×1920, 60 i/s) : détection sur **84 %** des
images après filtrage de continuité, exacte à l'adresse et au sommet, perdue
dans les phases rapides par flou de mouvement.

Sur les vignettes 160×160 du corpus : le détecteur trouve une ligne dans
100 % des cas, mais l'étendue p10–p90 des angles atteint **233°** — il attrape
les bords de tapis, le filet, n'importe quoi. Aucune calibration possible.

Même situation que pour la position de la balle : mesurable chez
l'utilisateur, pas comparable à une référence. Ces grandeurs sont donc
affichées sans verdict.

## 4. L'adresse est la phase la moins fiable, et le moteur le sait

Mesuré sur les 1045 swings annotés du corpus, à ±3 images :

| phase | correct | erreur médiane | biais médian signé |
|---|---|---|---|
| midDownswing | 88,3 % | 1 img | −1 |
| impact | 79,5 % | 1 img | 0 |
| midBackswing | 69,4 % | 1 img | +1 |
| top | 68,3 % | 2 img | 0 |
| **address** | **20,5 %** | **11 img** | **+10** |
| **finish** | **9,9 %** | **30 img** | **+12** |

Les deux mauvais scores s'expliquent en partie par une divergence de
convention plutôt que par une erreur : le biais est systématique et positif.
L'annotation marque l'adresse au moment où le joueur est en place ; le moteur
retient la dernière image immobile avant le départ, donc plus tard. Même
logique pour le finish. Un biais systématique ne se corrige pas en changeant
le détecteur, mais en choisissant une convention — et celle du moteur est la
bonne pour la mesure, puisque la géométrie de setup doit être lue quand le
joueur est posé, pas quand il s'installe encore.

Ce qui compte davantage : **la confiance annoncée par le moteur est honnête.**

| confiance annoncée | part des clips | erreur médiane | erreurs > 40 images |
|---|---|---|---|
| ≥ 0,90 | 26 % | 5 img | 3 % |
| < 0,90 | 74 % | 20 img | 33 % |

Quand le moteur annonce une adresse fiable, elle l'est. Quand il annonce un
doute, le doute est justifié une fois sur trois de façon grossière. Les règles
de setup propagent déjà cette confiance (`ruleConfidence`) et mesurent la
médiane sur toute la fenêtre d'immobilité plutôt qu'une image isolée, ce qui
amortit l'erreur — mais un défaut de setup affiché avec une confiance basse
reste affiché avec sa sévérité. C'est le prochain arbitrage à trancher :
taire la règle, ou continuer à l'afficher avec sa réserve.

Un filet a été ajouté là où le repli était une devinette. Quand aucune plage
ne passe sous le seuil d'immobilité, l'adresse est désormais la fenêtre la
plus calme avant le sommet, au lieu d'une position fixe avant le sommet. Sur
le corpus le gain est marginal (20,3 % → 20,5 %) parce que le cas est rare
avec des points clés propres ; dans le navigateur il corrigeait une adresse
placée à l'image 20 au lieu de 3, ce qui faisait tomber la confiance sur
l'angle de prise de vue de 0,97 à 0,04 et taisait huit règles.

## 5. Ce qui débloquerait la qualité de frappe

Le flou de mouvement décroît avec la cadence. À 60 i/s la tête de club
parcourt plusieurs dizaines de centimètres entre deux images ; à 240 i/s,
quatre fois moins. Les iPhone récents filment en 240 i/s.

C'est la seule voie réaliste, depuis un téléphone, vers les mesures qui
comptent : suivi de la tête de club dans la descente, point bas par rapport
à la balle, et premières images du départ de balle.
