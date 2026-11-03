import type { ClubKind } from './types'

/**
 * SOURCE DE VÉRITÉ UNIQUE des constantes de calibration.
 * Aucun seuil ne doit être écrit en dur ailleurs dans le moteur.
 *
 * Unité de longueur : « U » = longueur de torse à l'adresse
 * (distance milieu-épaules → milieu-hanches). Choisie plutôt que la largeur
 * d'épaules car elle reste stable dans les deux vues (de face comme
 * down-the-line, où les épaules sont écrasées par la perspective).
 * Ordre de grandeur : 1 U ≈ 50 cm chez un adulte.
 *
 * ⚠️ CALIBRATION : ces seuils proviennent de la littérature biomécanique et
 * d'ordres de grandeur admis en enseignement du golf. Ils n'ont PAS été calés
 * sur un jeu de données annoté (il n'en existe pas de public pour les défauts).
 * Ils sont volontairement conservateurs : mieux vaut taire un défaut que
 * d'affirmer un faux positif à un débutant.
 */

export const SMOOTHING = {
  /** Visibilité en dessous de laquelle un point clé est considéré absent. */
  minVisibility: 0.45,
  /** Taille max (en frames) d'un trou comblé par interpolation linéaire. */
  maxGapFill: 4,
  /** Fenêtre du filtre Savitzky-Golay (impair). Préserve les pics, contrairement à une moyenne glissante. */
  savgolWindow: 7,
  /** Ordre du polynôme du filtre Savitzky-Golay. */
  savgolOrder: 2,
  /** Fenêtre réduite utilisée quand la séquence est courte. */
  savgolWindowShort: 5,
} as const

export const VIEW = {
  /**
   * Classification de la vue à partir de l'adresse.
   * De face : les chevilles sont nettement écartées horizontalement.
   * Down-the-line (derrière, dans l'axe) : un pied masque l'autre.
   */
  stanceRatioFaceOnMin: 0.55,
  stanceRatioDtlMax: 0.3,
  /** Largeur d'épaules / longueur de torse. Écrasée par la perspective en DTL. */
  shoulderRatioFaceOnMin: 0.75,
  shoulderRatioDtlMax: 0.5,
  /** En dessous de cette confiance, la vue est déclarée `unknown` et les règles dépendantes se taisent. */
  minConfidence: 0.55,
} as const

export const EVENTS = {
  /** Vitesse des mains (U/s) en dessous de laquelle le corps est considéré immobile. */
  stillSpeed: 0.35,
  /** Durée minimale (s) d'une fenêtre d'immobilité pour valider l'adresse ou le finish. */
  minStillDuration: 0.12,
  /** Part initiale de la vidéo dans laquelle chercher l'adresse. */
  addressSearchFraction: 0.6,
  /** Part finale de la vidéo dans laquelle chercher le finish. */
  finishSearchFraction: 0.5,
  /** Hauteur de main (en U au-dessus du bassin d'adresse) servant de repère « hanches ». */
  hipLevelHeight: 0.15,
  /** Hauteur de main servant de repère « épaules ». */
  shoulderLevelHeight: 0.75,
  /** Fenêtre (frames) de raffinement de l'impact autour du candidat géométrique. */
  impactRefineWindow: 3,

  // --- Recherche globale du swing ---
  //
  // Une vidéo réelle ne contient pas forcément « un swing entouré
  // d'immobilité » : swing d'essai, replacement, seconde balle, joueur qui
  // entre dans le champ. Une recherche séquentielle verrouille alors sur le
  // mauvais mouvement. On énumère donc les candidats d'impact dans TOUTE la
  // vidéo, on reconstruit un swing autour de chacun, et on retient le plus
  // plausible physiquement.
  /** Hauteur minimale d'un pic de vitesse candidat, en fraction du pic global. */
  peakProminenceRatio: 0.4,
  /** Écart minimal (s) entre deux candidats d'impact. */
  peakMinSeparationSec: 0.5,
  /** Fenêtre de recherche du sommet en amont d'un candidat (s). */
  maxBackswingSec: 2.5,
  /** Durées plausibles d'un backswing (s). */
  minBackswingSec: 0.25,
  /** Durées plausibles d'une descente (s). */
  minDownswingSec: 0.07,
  maxDownswingSec: 0.9,
  /** Chute de hauteur de mains entre sommet et impact, en U : en deçà, ce n'est pas un swing. */
  minHandDropU: 0.55,
  /** Chute de hauteur au-delà de laquelle le candidat est pleinement crédité. */
  idealHandDropU: 0.9,
  /** Bornes de tempo acceptables pour un candidat (ratio montée/descente). */
  candidateTempoMin: 1.2,
  candidateTempoMax: 9,
  /** Tolérance (s) entre le point bas des mains et le pic de vitesse. */
  peakAlignSec: 0.3,
  /** Délai minimal (s) après l'impact avant de chercher le finish. */
  finishDelaySec: 0.25,
  /**
   * Zone morte sur la vitesse verticale des mains (U/s) pour détecter les
   * changements de sens (montée → descente → finish) sans réagir au bruit.
   */
  heightVelocityDeadband: 0.3,
  /**
   * Amplitude minimale (en U) du mouvement vertical des mains pour qu'un
   * changement de sens compte comme un vrai sommet de backswing.
   */
  minTopProminence: 0.35,
} as const

export const QUALITY = {
  /** En dessous, l'analyse est refusée : la pose n'a pas été trouvée assez souvent. */
  minPoseCoverage: 0.7,
  /** En dessous, un avertissement est affiché. */
  warnPoseCoverage: 0.85,
  /** Visibilité moyenne minimale des points clés du diagnostic. */
  warnMeanVisibility: 0.6,
  /** En dessous de ce nombre de frames entre le top et l'impact, l'impact est imprécis. */
  minDownswingFrames: 5,
  /** FPS en dessous duquel on avertit l'utilisateur. */
  warnFps: 50,
  /** Durée minimale (s) d'une vidéo exploitable. */
  minDurationSec: 1.0,
  /** Durée maximale analysée (s) — au-delà, on recadre sur la fenêtre de mouvement. */
  maxDurationSec: 20,
  /**
   * Déplacement des chevilles entre l'adresse et l'impact, en U, au-delà
   * duquel on avertit.
   *
   * Les pieds d'un joueur ne se déplacent pas avant l'impact. Tout
   * déplacement apparent vient donc de la CAMÉRA (téléphone tenu à la main,
   * panoramique, zoom) — et ce déplacement contamine toutes les mesures de
   * translation : tête, bassin, équilibre. Les chevilles sont le seul repère
   * du corps qu'on puisse supposer fixe, donc le seul détecteur de dérive
   * disponible sans mire ni capteur.
   */
  warnFootDrift: 0.1,
  /** Dérive au-delà de laquelle les mesures de translation sont déclarées non fiables. */
  maxFootDrift: 0.25,
} as const

export const EXTRACTION = {
  /**
   * Nombre maximum de frames analysées. Au-delà, on sous-échantillonne :
   * une vidéo iPhone en ralenti à 240 i/s produirait sinon des milliers de
   * seeks pour une précision temporelle dont on n'a pas besoin.
   */
  maxAnalysisFrames: 600,
  /**
   * Plafond d'images sur un appareil peu doté (mémoire ou cœurs limités).
   * Safari mobile tue l'onglet bien avant d'afficher une erreur : mieux vaut
   * une analyse un peu moins fine qu'une page qui plante.
   */
  maxAnalysisFramesLowEnd: 240,
  /**
   * Hauteur maximale de l'image envoyée à l'inférence, en pixels.
   *
   * Transmettre une image 1080×1920 ne gagne aucune précision et fait
   * transiter plus de quatre fois plus de pixels par image. Sur iPhone,
   * c'est la première cause de saturation mémoire.
   *
   * Valeur vérifiée sur un swing réel, même vidéo réduite à différentes
   * hauteurs : à 512 px les mesures sont celles du 1080×1920 (inclinaison du
   * buste 37,8° contre 37,5°, early extension 13,3 % contre 13,5 %), alors
   * qu'à 256 px elles décrochent (early extension 10,6 %). D'où une valeur
   * unique, sans mode dégradé : la précision de mesure ne doit pas dépendre
   * de l'appareil, sans quoi la comparaison au corpus de référence perd son
   * sens.
   */
  inferenceMaxHeight: 512,
  /** FPS supposés quand la mesure échoue. */
  fallbackFps: 30,
  /** Bornes de plausibilité de la mesure de FPS. */
  minFps: 10,
  maxFps: 300,
  /** Valeurs usuelles sur lesquelles la mesure est recalée si elle en est proche (±4 %). */
  commonFps: [24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 120, 240],
  /** Nombre de frames observées pour mesurer les FPS. */
  fpsProbeFrames: 14,
  /** Délai max (ms) d'attente d'un seek avant abandon de la frame. */
  seekTimeoutMs: 2500,
  // --- Recadrage automatique sur le swing ---
  //
  // Une vidéo de téléphone dure volontiers 9 secondes pour un swing qui en
  // occupe 3 : le joueur se place, joue, puis range. Analyser l'intégralité
  // triple le temps de traitement pour rien. Un pré-passage très bon marché
  // (différence d'images sur une vignette) localise le mouvement, et
  // l'inférence de pose ne tourne que sur cette fenêtre.
  /** Pas d'échantillonnage du pré-passage de mouvement, en secondes. */
  motionSampleStepSec: 0.12,
  /** Hauteur de la vignette utilisée pour mesurer le mouvement, en pixels. */
  motionThumbHeight: 64,
  /**
   * Seuil de mouvement, exprimé en fraction de l'écart entre la ligne de base
   * et le pic — et non du pic lui-même.
   *
   * Mesuré sur une vidéo de practice : le bruit de fond (éclairages, autres
   * joueurs, bruit du capteur) atteint 25 % du pic du swing. Un seuil en
   * fraction du pic n'isole donc rien. En retranchant la ligne de base, le
   * swing ressort nettement, et le réglage est stable de 0,20 à 0,40.
   */
  motionThreshold: 0.25,
  /**
   * Nombre d'échantillons sous le seuil tolérés pendant l'expansion autour du
   * pic. Un swing comporte un temps d'arrêt au sommet, qui ne doit pas couper
   * la fenêtre en deux.
   */
  motionGapSamples: 2,
  /** Marge conservée avant le mouvement détecté (adresse), en secondes. */
  motionPadBeforeSec: 1.2,
  /** Marge conservée après (finish tenu), en secondes. */
  motionPadAfterSec: 1.4,
  /** En deçà de cette durée, on n'ose pas recadrer. */
  minWindowSec: 1.5,
  /** Si la fenêtre couvre déjà cette part de la vidéo, le recadrage n'apporte rien. */
  maxWindowFraction: 0.85,
  /**
   * Nombre d'images entre deux respirations longues du thread principal.
   *
   * Un `setTimeout(0)` rend la main mais ne laisse pas le temps au navigateur
   * de récupérer de la mémoire. Sur Safari mobile, qui tue l'onglet sous
   * pression plutôt que de ralentir, une pause franche à intervalle régulier
   * change la donne.
   */
  breatherEveryFrames: 24,
  /** Durée de cette pause, en millisecondes. */
  breatherMs: 40,
  // --- Détection de la balle ---
  /** Images moyennées avant l'impact présumé pour obtenir « la balle en place ». */
  ballBeforeFrames: 20,
  /** Images moyennées après, pour obtenir « la balle partie ». */
  ballAfterFrames: 20,
  /** Décalage, en images, avant de commencer à moyenner l'après-impact (flou du club). */
  ballAfterSkip: 5,
  /** Bornes du rayon de la balle, en fraction de la longueur du torse. */
  ballMinRadiusU: 0.012,
  ballMaxRadiusU: 0.09,
  /** Compacité minimale du blob : une balle est ronde et pleine. */
  ballMinFill: 0.45,
  /** Corrélation en deçà de laquelle la balle est considérée partie. */
  ballDepartureCorrelation: 0.55,
  /** Confiance minimale pour que la balle serve à fixer l'impact. */
  ballMinConfidence: 0.5,
  /**
   * Écart maximal, en images, entre le départ de la balle et l'impact déduit
   * de la cinématique, pour que la balle fasse foi.
   *
   * Mesuré : sur des vignettes 160×160 de retransmission, la détection ramène
   * surtout des faux positifs (motte de terre, ombre, débris), et laisser la
   * balle fixer l'impact fait TOMBER la justesse de 79,5 % à 66,7 % à ±3
   * images. La balle ne doit donc AFFINER l'impact que lorsqu'elle corrobore
   * la cinématique ; en cas de désaccord franc, c'est la détection de balle
   * qui est suspecte, pas le corps.
   */
  ballImpactMaxDisagreement: 4,
  /** Seuils de confiance passés à MediaPipe. */
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
} as const

/**
 * Seuils par défaut. Chaque entrée définit la zone saine et les paliers de gravité.
 * `minor` / `major` sont des écarts au-delà de la zone saine.
 */
export interface BandThreshold {
  /** Borne basse de la zone saine. */
  idealMin: number
  /** Borne haute de la zone saine. */
  idealMax: number
  /** Écart au-delà de la zone saine à partir duquel le défaut est « léger ». */
  minor: number
  /** Écart à partir duquel il est « important ». */
  major: number
}

export interface UpThreshold {
  /** Valeur typique d'un bon joueur, affichée à titre indicatif. */
  ideal: number
  minor: number
  major: number
}

export interface ChickenWingThreshold {
  idealMin: number
  minor: number
  major: number
  windowStartSec: number
  windowEndSec: number
}

export interface FinishBalanceThreshold {
  ideal: number
  minor: number
  major: number
  windowStartSec: number
  windowLengthSec: number
}

export interface FaultThresholds {
  setupSpineTilt: BandThreshold
  setupKneeFlex: BandThreshold
  setupStanceWidth: BandThreshold
  sway: UpThreshold
  slide: UpThreshold
  reversePivot: UpThreshold
  headMovement: UpThreshold
  lossOfPosture: UpThreshold
  earlyExtension: UpThreshold
  chickenWing: ChickenWingThreshold
  tempo: BandThreshold
  finishBalance: FinishBalanceThreshold
}

export const FAULTS: FaultThresholds = {
  /**
   * Inclinaison du buste vers l'avant à l'adresse (degrés depuis la verticale).
   * Dépend du club : médiane 28,0° au driver contre 34,2° au fer. L'app ne
   * connaissant pas le club, la bande couvre l'ensemble — elle ne détecte donc
   * que les écarts francs.
   */
  setupSpineTilt: { idealMin: 21.3, idealMax: 39.8, minor: 1.5, major: 5 },
  /** Angle des genoux à l'adresse (180° = jambe tendue). */
  setupKneeFlex: { idealMin: 147.8, idealMax: 167.4, minor: 1.7, major: 5.7 },
  /**
   * Écartement des chevilles / largeur d'épaules, à l'adresse (vue de face).
   * Très dépendant du club : médiane 1,54 au driver contre 1,27 au fer, et
   * 10e centile à 0,97 au fer contre 1,33 au driver. Sans connaître le club,
   * seule une bande large est honnête.
   */
  setupStanceWidth: { idealMin: 0.97, idealMax: 2.07, minor: 0.08, major: 0.25 },
  /** Glissement latéral du bassin à l'écart de la cible, au top (en U). */
  sway: { ideal: 0.01, minor: 0.144, major: 0.211 },
  /** Glissement du bassin vers la cible pendant la descente (en U). */
  slide: { ideal: 0.082, minor: 0.274, major: 0.373 },
  /** Bascule du buste vers la cible au top — reverse pivot (degrés). */
  reversePivot: { ideal: 4.3, minor: 12.1, major: 15.4 },
  /**
   * Déplacement de la tête entre l'adresse et l'impact (en U).
   * Le seuil retenu au départ (15 % du torse) venait de l'enseignement ; il
   * déclenchait sur 84 % des professionnels mesurés, dont 40 % en « important ».
   * La médiane réelle est de 23 % et le 90e centile de 40 % : la tête d'un bon
   * joueur se déplace, et nettement.
   */
  headMovement: { ideal: 0.233, minor: 0.395, major: 0.534 },
  /** Variation de l'inclinaison du buste entre l'adresse et le top/impact (degrés). */
  lossOfPosture: { ideal: 5.9, minor: 11.3, major: 15.6 },
  /** Avancée du bassin vers la balle entre l'adresse et l'impact (en U, vue DTL). */
  earlyExtension: { ideal: 0.084, minor: 0.165, major: 0.214 },
  /**
   * Angle du coude avant juste APRÈS l'impact (180° = bras tendu).
   * `minor`/`major` sont des écarts sous `idealMin`.
   *
   * La fenêtre est fixée en secondes après l'impact, et non sur la phase
   * « mi-finish ». Mesurée au mi-finish sur des professionnels, la
   * distribution descendait à 76° au 2e centile : à ce stade les bras se
   * replient chez tout le monde, et la règle n'observait donc pas ce qu'elle
   * prétend. Recentrée sur l'extension qui suit l'impact, elle retrouve une
   * distribution saine (2e centile à 115°).
   */
  chickenWing: { idealMin: 134.4, minor: 0.5, major: 18.9, windowStartSec: 0.07, windowEndSec: 0.2 },
  /**
   * Ratio durée du backswing / durée de la descente.
   *
   * Mesuré par le MOTEUR sur le corpus, et non repris des annotations
   * humaines : l'adresse n'y est pas définie de la même façon, et confronter
   * la mesure d'un utilisateur à une référence calculée autrement produit un
   * biais systématique. Référence et mesure doivent passer par le même code.
   *
   * Seul indicateur indépendant du club : médiane 2,94 au driver, 3,00 au fer,
   * 2,67 au bois de parcours.
   */
  tempo: { idealMin: 1.6, idealMax: 4.5, minor: 0.48, major: 1.61 },
  /**
   * Instabilité du bassin et de la tête pendant le finish (écart-type en U).
   * La fenêtre est ancrée sur l'IMPACT, pas sur la phase « finish » détectée :
   * un joueur qui ne tient pas son finish ne produit aucune fenêtre
   * d'immobilité, et la règle se serait tue sur le cas même qu'elle doit
   * signaler.
   */
  finishBalance: {
    ideal: 0.05,
    minor: 0.11,
    major: 0.152,
    /** Début de la fenêtre, en secondes après l'impact. */
    windowStartSec: 0.45,
    /** Longueur de la fenêtre, en secondes. */
    windowLengthSec: 0.5,
  },
}

/**
 * Groupe de calage utilisé pour chaque type de club.
 *
 * Mesuré sur le corpus : l'écartement des pieds va de 1,27× la largeur
 * d'épaules au fer à 1,54× au driver, l'inclinaison du buste de 34° à 28°.
 * Appliquer une bande unique revenait à ne détecter que les écarts francs.
 *
 * Le wedge emprunte la distribution des fers : le corpus n'en contient que
 * quelques-uns, et inventer une bande sur si peu de swings serait pire que
 * d'utiliser la famille la plus proche.
 */
export const CLUB_CALIBRATION_GROUP: Record<ClubKind, 'driver' | 'wood' | 'iron' | 'pooled'> = {
  driver: 'driver',
  wood: 'wood',
  iron: 'iron',
  wedge: 'iron',
  unknown: 'pooled',
}

type ClubOverrides = { [K in keyof FaultThresholds]?: FaultThresholds[K] }

/**
 * Surcharges de seuils par groupe de clubs, mesurées sur le corpus.
 *
 * Émises uniquement là où l'effet du club est net — écart des médianes
 * supérieur à 30 % de la dispersion interne des groupes. Pour le sway, le
 * slide, le tempo, l'équilibre au finish et le chicken wing, la mesure ne
 * montre pas d'effet : la bande commune s'applique.
 *
 * Le club déplace la BANDE ; la largeur des queues de gravité est estimée sur
 * le corpus entier. Sur un groupe de 24 swings, l'écart entre 90e et 98e
 * centile n'est connu qu'à quelques unités près, et s'en servir ferait sauter
 * le diagnostic de « rien » à « important » en 1,6°.
 */
export const FAULTS_BY_CLUB: Record<'driver' | 'wood' | 'iron', ClubOverrides> = {
  driver: {
    earlyExtension: { ideal: 0.089, minor: 0.172, major: 0.221 },
    headMovement: { ideal: 0.23, minor: 0.395, major: 0.534 },
    lossOfPosture: { ideal: 6.3, minor: 12.0, major: 16.3 },
    reversePivot: { ideal: 3.5, minor: 10.7, major: 14.0 },
    setupKneeFlex: { idealMin: 150.1, idealMax: 168.0, minor: 1.7, major: 5.7 },
    setupSpineTilt: { idealMin: 21.3, idealMax: 33.9, minor: 1.0, major: 3.5 },
    setupStanceWidth: { idealMin: 1.33, idealMax: 1.84, minor: 0.06, major: 0.21 },
  },
  wood: {
    earlyExtension: { ideal: 0.062, minor: 0.152, major: 0.201 },
    headMovement: { ideal: 0.206, minor: 0.328, major: 0.467 },
    lossOfPosture: { ideal: 5.0, minor: 9.6, major: 13.9 },
    setupKneeFlex: { idealMin: 145.4, idealMax: 163.8, minor: 1.7, major: 5.7 },
    setupSpineTilt: { idealMin: 24.4, idealMax: 38.7, minor: 1.0, major: 3.5 },
  },
  iron: {
    earlyExtension: { ideal: 0.061, minor: 0.109, major: 0.158 },
    headMovement: { ideal: 0.261, minor: 0.413, major: 0.552 },
    lossOfPosture: { ideal: 4.1, minor: 8.3, major: 12.6 },
    reversePivot: { ideal: 7.2, minor: 13.2, major: 16.5 },
    setupKneeFlex: { idealMin: 145.2, idealMax: 164.5, minor: 1.7, major: 5.7 },
    setupSpineTilt: { idealMin: 28.7, idealMax: 39.6, minor: 1.0, major: 3.5 },
    setupStanceWidth: { idealMin: 0.97, idealMax: 1.45, minor: 0.06, major: 0.21 },
  },
}

/** Seuils applicables au club choisi. */
export function faultsFor(club: ClubKind): FaultThresholds {
  const group = CLUB_CALIBRATION_GROUP[club]
  if (group === 'pooled') return FAULTS
  return { ...FAULTS, ...FAULTS_BY_CLUB[group] }
}

/** Poids de chaque gravité dans le score global sur 100. */
export const SCORE_PENALTY: Record<'none' | 'minor' | 'moderate' | 'major', number> = {
  none: 0,
  minor: 4,
  moderate: 9,
  major: 16,
}

/** Score plancher : on n'affiche jamais 0 à un débutant. */
export const SCORE_FLOOR = 25
