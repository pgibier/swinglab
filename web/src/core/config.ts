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
  /** Inclinaison du buste vers l'avant à l'adresse (degrés depuis la verticale). */
  setupSpineTilt: { idealMin: 20, idealMax: 45, minor: 6, major: 15 },
  /** Angle des genoux à l'adresse (180° = jambe tendue). */
  setupKneeFlex: { idealMin: 150, idealMax: 172, minor: 6, major: 15 },
  /** Écartement des chevilles / largeur d'épaules, à l'adresse (vue de face). */
  setupStanceWidth: { idealMin: 0.85, idealMax: 1.35, minor: 0.15, major: 0.35 },
  /** Glissement latéral du bassin à l'écart de la cible, au top (en U). */
  sway: { ideal: 0.06, minor: 0.12, major: 0.22 },
  /** Glissement du bassin vers la cible pendant la descente (en U). */
  slide: { ideal: 0.12, minor: 0.22, major: 0.34 },
  /** Bascule du buste vers la cible au top — reverse pivot (degrés). */
  reversePivot: { ideal: 2, minor: 8, major: 16 },
  /** Déplacement de la tête entre l'adresse et l'impact (en U). */
  headMovement: { ideal: 0.08, minor: 0.15, major: 0.26 },
  /** Variation de l'inclinaison du buste entre l'adresse et le top/impact (degrés). */
  lossOfPosture: { ideal: 4, minor: 9, major: 17 },
  /** Avancée du bassin vers la balle entre l'adresse et l'impact (en U, vue DTL). */
  earlyExtension: { ideal: 0.05, minor: 0.1, major: 0.18 },
  /** Angle du coude avant juste après l'impact (180° = bras tendu). `minor`/`major` sont des écarts sous `idealMin`. */
  chickenWing: { idealMin: 160, minor: 8, major: 26 },
  /** Ratio durée du backswing / durée de la descente. */
  tempo: { idealMin: 2.3, idealMax: 3.8, minor: 0.5, major: 1.2 },
  /**
   * Instabilité du bassin et de la tête pendant le finish (écart-type en U).
   * La fenêtre est ancrée sur l'IMPACT, pas sur la phase « finish » détectée :
   * un joueur qui ne tient pas son finish ne produit aucune fenêtre
   * d'immobilité, et la règle se serait tue sur le cas même qu'elle doit
   * signaler.
   */
  finishBalance: {
    ideal: 0.03,
    minor: 0.06,
    major: 0.11,
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
