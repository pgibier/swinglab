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
export interface PoseSequence {
  frames: PoseFrame[]
  /** Images par seconde réelles de la vidéo source. */
  fps: number
  videoWidth: number
  videoHeight: number
}

export type ViewType = 'face_on' | 'down_the_line' | 'unknown'
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

export interface SwingQuality {
  /** Part de frames où une pose exploitable a été trouvée [0..1]. */
  poseCoverage: number
  /** Visibilité moyenne des points clés utilisés [0..1]. */
  meanVisibility: number
  /** Images par seconde de la source. */
  fps: number
  /** Nombre de frames entre le top et l'impact (sous 5, l'impact est imprécis). */
  downswingFrames: number
}

export interface SwingReport {
  meta: {
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
  /**
   * Règles qu'on ne peut PAS évaluer sur cette vidéo (mauvaise vue, pose
   * insuffisante, événement non fiable). On les affiche pour que l'utilisateur
   * sache quoi filmer pour les débloquer — plutôt que de deviner.
   */
  notEvaluated: Array<{ id: string; label: string; reason: string }>
  /** Score global de synthèse [0..100]. */
  score: number
}
