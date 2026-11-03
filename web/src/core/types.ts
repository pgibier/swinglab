/**
 * Types partagés du moteur d'analyse.
 * Ce module ne dépend NI de React NI de MediaPipe : il est exécutable en Node
 * (scripts de validation) comme dans le navigateur.
 */

/** Un point clé tel que produit par MediaPipe Pose Landmarker. */
export interface Landmark {
  /** Coordonnée horizontale normalisée [0..1] dans l'image. */
  x: number
  /** Coordonnée verticale normalisée [0..1], 0 = haut de l'image. */
  y: number
  /** Profondeur relative estimée (monoculaire, peu fiable — non utilisée pour le diagnostic). */
  z: number
  /** Confiance de visibilité [0..1]. */
  visibility: number
}

/** Les 33 points clés d'une frame, ou `null` si aucune personne détectée. */
export type PoseFrame = Landmark[] | null

/** Séquence de pose brute extraite d'une vidéo. */
/**
 * Observation de la balle, lorsqu'elle a pu être repérée.
 *
 * La balle est détectée par ce qui la distingue de toutes les autres balles
 * d'un practice : elle est immobile avant l'impact et absente juste après.
 * La différence entre la moyenne des images d'avant et celle d'après la fait
 * ressortir seule.
 *
 * Ce que cela permet : mesurer l'impact au lieu de le déduire de la
 * cinématique du corps, et situer la balle par rapport aux appuis.
 *
 * Ce que cela ne permet pas : suivre la trajectoire. À 60 i/s une balle
 * parcourt plus d'un demi-mètre entre deux images et se fond dans le flou ;
 * vérifié sur vidéo réelle, aucun blob exploitable ne subsiste après
 * l'impact.
 */
export interface BallObservation {
  /** Position normalisée de la balle à l'adresse, comme les points clés. */
  x: number
  y: number
  /** Rayon, normalisé sur la hauteur d'image. */
  radius: number
  /** Première image où la balle a quitté sa place : l'impact est juste avant. */
  departureFrame: number
  /** Confiance [0..1]. */
  confidence: number
}

export interface PoseSequence {
  frames: PoseFrame[]
  /**
   * Images par seconde EFFECTIVES de l'analyse (après sous-échantillonnage
   * éventuel d'une vidéo en ralenti).
   */
  fps: number
  /**
   * Instant (en secondes dans la vidéo source) de chaque frame analysée.
   * Permet au lecteur de retrouver la frame exacte sans refaire le calcul
   * de pas de temps.
   */
  timestamps: number[]
  videoWidth: number
  videoHeight: number
  /**
   * Fenêtre de la vidéo réellement analysée. `trimmed` indique qu'un
   * recadrage automatique a eu lieu : utile pour détecter qu'un swing touche
   * le bord de la fenêtre, et donc qu'elle était trop serrée.
   */
  window?: { startSec: number; endSec: number; trimmed: boolean }
  /** Balle repérée dans la vidéo, si elle l'a été. */
  ball?: BallObservation | null
}

export type ViewType = 'face_on' | 'down_the_line' | 'unknown'

/**
 * Famille de club utilisée pour le swing analysé.
 *
 * Elle change réellement ce qui est « normal » : mesuré sur un corpus de
 * professionnels, l'écartement des pieds passe de 1,27× la largeur d'épaules
 * au fer à 1,54× au driver, et l'inclinaison du buste de 34° à 28°.
 */
export type ClubKind = 'driver' | 'wood' | 'iron' | 'wedge' | 'unknown'
export type Handedness = 'right' | 'left'

/** Les 8 événements du swing (nomenclature GolfDB). */
export const SWING_EVENTS = [
  'address',
  'toeUp',
  'midBackswing',
  'top',
  'midDownswing',
  'impact',
  'midFollowThrough',
  'finish',
] as const

export type SwingEventName = (typeof SWING_EVENTS)[number]

/** Index de frame pour chaque événement. */
export type SwingEvents = Record<SwingEventName, number>

/** Fiabilité de chaque événement détecté [0..1]. */
export type SwingEventConfidence = Record<SwingEventName, number>

export type Severity = 'none' | 'minor' | 'moderate' | 'major'

/** Résultat d'une règle de diagnostic. */
export interface FaultResult {
  /** Identifiant stable (snake_case), utilisé comme clé de traduction et de télémétrie. */
  id: string
  /** Libellé court affiché à l'utilisateur. */
  label: string
  /** Catégorie d'affichage. */
  category: 'setup' | 'backswing' | 'downswing' | 'impact' | 'finish' | 'tempo'
  detected: boolean
  severity: Severity
  /** Confiance du diagnostic [0..1] : qualité de pose × adéquation de la vue. */
  confidence: number
  /** Valeur mesurée. */
  value: number
  /** Unité lisible de `value` (ex. '°', '% largeur d'épaules'). */
  unit: string
  /** Seuil de déclenchement appliqué. */
  threshold: number
  /** Frame qui illustre le défaut (à afficher dans le lecteur). */
  evidenceFrame: number
  /** Frame de référence pour comparaison (souvent l'adresse). */
  referenceFrame?: number
  /** Explication en français, orientée débutant. */
  explanation: string
  /** Exercice correctif concret. */
  drill: string
  /** Vues dans lesquelles la règle est valide. */
  validViews: ViewType[]
}

/** Séries temporelles calculées, une valeur par frame (NaN si indisponible). */
export interface MetricSeries {
  /** Inclinaison du rachis par rapport à la verticale, en degrés (magnitude). */
  spineTilt: number[]
  /** Bascule signée du buste : + = incliné vers la cible, - = vers l'arrière (degrés). */
  spineLean: number[]
  /** Déplacement latéral du bassin vs adresse, en U (+ = vers la cible). */
  hipLateral: number[]
  /** Déplacement du bassin vers la balle vs adresse, en unités de torse (+ = vers la balle). */
  hipTowardBall: number[]
  /** Déplacement de la tête vs adresse (norme), en unités de torse. */
  headShift: number[]
  /** Déplacement latéral signé de la tête vs adresse. */
  headLateral: number[]
  /** Angle du coude avant (épaule-coude-poignet), en degrés. */
  leadElbow: number[]
  /** Angle du coude arrière, en degrés. */
  trailElbow: number[]
  /** Flexion moyenne des genoux, en degrés (180 = jambe tendue). */
  kneeFlex: number[]
  /** Largeur d'épaules apparente / largeur à l'adresse (proxy de rotation). */
  shoulderTurnProxy: number[]
  /** Largeur de hanches apparente / largeur à l'adresse (proxy de rotation). */
  hipTurnProxy: number[]
  /** Hauteur des mains, en unités de torse au-dessus du bassin d'adresse. */
  handHeight: number[]
  /** Vitesse des mains, en unités de torse par seconde. */
  handSpeed: number[]
}

/**
 * Mesure rapportée sans verdict.
 *
 * Certaines grandeurs sont mesurables mais pas jugeables : il n'existe aucun
 * corpus permettant d'en fixer une zone saine. Les afficher sans seuil est
 * honnête ; leur inventer un seuil ne le serait pas.
 */
export interface Measurement {
  id: string
  label: string
  value: number
  unit: string
  confidence: number
  /** Image à montrer dans le lecteur. */
  frame: number
  /** Ce que la mesure signifie, et pourquoi elle n'est pas jugée. */
  note: string
}

export interface SwingQuality {
  /** Part de frames où une pose exploitable a été trouvée [0..1]. */
  poseCoverage: number
  /** Visibilité moyenne des points clés utilisés [0..1]. */
  meanVisibility: number
  /** Images par seconde de la source. */
  fps: number
  /** Nombre de frames entre le top et l'impact (sous 5, l'impact est imprécis). */
  downswingFrames: number
  /**
   * Déplacement apparent des chevilles entre l'adresse et l'impact, en U.
   * Les pieds ne bougeant pas avant l'impact, c'est une mesure de la dérive
   * de la caméra. NaN si les chevilles ne sont pas visibles.
   */
  footDrift: number
}

export interface SwingReport {
  meta: {
    /** Club déclaré par l'utilisateur, qui détermine les zones saines appliquées. */
    club: ClubKind
    /**
     * Vrai quand le départ de la balle confirme l'image d'impact trouvée par
     * la cinématique. La balle ne DÉPLACE pas l'impact : mesuré sur un corpus
     * annoté, s'en servir comme source dégrade la justesse de 79,5 % à 66,7 %,
     * les détections sur images de retransmission étant trop souvent fausses.
     */
    impactCorroboratedByBall: boolean
    /** Balle repérée, si elle l'a été. */
    ball: BallObservation | null
    view: ViewType
    viewConfidence: number
    handedness: Handedness
    handednessConfidence: number
    fps: number
    frameCount: number
    quality: SwingQuality
    /** Avertissements destinés à l'utilisateur (vidéo trop lente, vue incertaine…). */
    warnings: string[]
  }
  events: SwingEvents
  eventConfidence: SwingEventConfidence
  metrics: MetricSeries
  faults: FaultResult[]
  /** Grandeurs mesurées mais non jugées, faute de référence. */
  measurements: Measurement[]
  /**
   * Règles qu'on ne peut PAS évaluer sur cette vidéo (mauvaise vue, pose
   * insuffisante, événement non fiable). On les affiche pour que l'utilisateur
   * sache quoi filmer pour les débloquer — plutôt que de deviner.
   */
  notEvaluated: Array<{ id: string; label: string; reason: string }>
  /** Score global de synthèse [0..100]. */
  score: number
}
