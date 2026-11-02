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
  /** Seuils de confiance passés à MediaPipe. */
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
} as const

/**
 * Seuils par défaut. Chaque entrée définit la zone saine et les paliers de gravité.
 * `minor` / `major` sont des écarts au-delà de la zone saine.
 */
export const FAULTS = {
  // =========================================================================
  // SEUILS CALÉS SUR DONNÉES — 409 swings de professionnels (GolfDB)
  //
  // Retenus après filtrage : pose détectée sur plus de 90 % des images, vue
  // identifiée avec confiance, phases détectées avec confiance, et caméra
  // stable (déplacement apparent des chevilles sous 10 % du torse entre
  // l'adresse et l'impact). 1 045 clips analysés, 409 retenus : un corpus
  // bruité fausse les centiles, donc les seuils.
  //
  // Règle de calage : « léger » au 90e centile du corpus, « important » au
  // 98e. Un bon joueur traverse donc l'analyse sans être couvert d'alertes,
  // tandis qu'un débutant sort franchement de ces bornes.
  //
  // Réserve honnête : ce corpus est fait d'images de retransmission, dont les
  // conditions de prise de vue diffèrent d'un téléphone posé au sol. Les
  // valeurs restent des ordres de grandeur mesurés, pas une norme.
  // =========================================================================

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
} as const

/** Poids de chaque gravité dans le score global sur 100. */
export const SCORE_PENALTY: Record<'none' | 'minor' | 'moderate' | 'major', number> = {
  none: 0,
  minor: 4,
  moderate: 9,
  major: 16,
}

/** Score plancher : on n'affiche jamais 0 à un débutant. */
export const SCORE_FLOOR = 25
