/** Socle commun aux règles de diagnostic. */

import { SCORE_PENALTY, type FaultThresholds } from '../config'
import { CORE_LANDMARKS } from '../landmarks'
import { clamp, meanFinite } from '../geometry'
import type { CleanedPose } from '../smoothing'
import type { BodyRef } from '../normalize'
import type {
  BallObservation,
  ClubKind,
  FaultResult,
  MetricSeries,
  Severity,
  SwingEventConfidence,
  SwingEventName,
  SwingEvents,
  SwingQuality,
  ViewType,
} from '../types'

export interface FaultContext {
  c: CleanedPose
  ref: BodyRef
  events: SwingEvents
  /** Plage d'immobilité à l'adresse, sur laquelle les mesures de setup sont moyennées. */
  addressWindow: { start: number; end: number }
  /** Balle repérée dans la vidéo, si elle l'a été. */
  ball: BallObservation | null
  /** Club déclaré par l'utilisateur ; 'unknown' s'il ne l'a pas précisé. */
  club: ClubKind
  /**
   * Seuils applicables à ce club. Les règles lisent ICI et jamais la constante
   * globale : plusieurs d'entre elles ont une zone saine qui dépend du club.
   */
  faults: FaultThresholds
  eventConfidence: SwingEventConfidence
  metrics: MetricSeries
  quality: SwingQuality
}

/** Une règle retourne `null` quand elle n'est pas évaluable sur cette vidéo. */
export type Rule = (ctx: FaultContext) => FaultResult | NotEvaluated | null

export interface NotEvaluated {
  kind: 'not_evaluated'
  id: string
  label: string
  reason: string
}

export const notEvaluated = (id: string, label: string, reason: string): NotEvaluated => ({
  kind: 'not_evaluated',
  id,
  label,
  reason,
})

export const isNotEvaluated = (r: FaultResult | NotEvaluated): r is NotEvaluated =>
  (r as NotEvaluated).kind === 'not_evaluated'

/** Libellé lisible d'une vue, pour les messages utilisateur. */
export const viewLabel = (v: ViewType): string =>
  v === 'face_on' ? 'de face' : v === 'down_the_line' ? 'de derrière (dans l’axe)' : 'indéterminée'

/**
 * Gravité à partir de l'écart à la zone saine.
 * `moderate` est le palier intermédiaire entre `minor` et `major`.
 */
export function severityFrom(deviation: number, minor: number, major: number): Severity {
  if (!Number.isFinite(deviation) || deviation < minor) return 'none'
  if (deviation >= major) return 'major'
  if (deviation >= (minor + major) / 2) return 'moderate'
  return 'minor'
}

export const penaltyOf = (s: Severity): number => SCORE_PENALTY[s]

/** Visibilité moyenne des points clés du diagnostic sur les frames données. */
export function visibilityAt(c: CleanedPose, frames: readonly number[]): number {
  const vals: number[] = []
  for (const f of frames) {
    if (f < 0 || f >= c.n) continue
    for (const lm of CORE_LANDMARKS) vals.push(c.vis[lm][f])
  }
  const m = meanFinite(vals)
  return Number.isFinite(m) ? m : 0
}

/**
 * Confiance d'une règle = adéquation de la vue × fiabilité des événements
 * utilisés × visibilité de la pose sur les frames observées.
 * Jamais 1 : aucune mesure monoculaire ne mérite une certitude totale.
 */
export function ruleConfidence(
  ctx: FaultContext,
  frames: readonly number[],
  eventsUsed: readonly SwingEventName[],
): number {
  const viewPart = ctx.ref.viewConfidence
  const eventPart = eventsUsed.length
    ? eventsUsed.reduce((s, e) => s + ctx.eventConfidence[e], 0) / eventsUsed.length
    : 1
  const visPart = clamp(visibilityAt(ctx.c, frames) / 0.85, 0, 1)
  return clamp(viewPart * eventPart * visPart * 0.95, 0, 0.95)
}

/**
 * Vérifie que la règle s'applique à la vue détectée.
 * Retourne un `NotEvaluated` explicite sinon : l'utilisateur doit savoir quel
 * angle filmer pour débloquer le diagnostic.
 */
export function requireView(
  ctx: FaultContext,
  id: string,
  label: string,
  validViews: readonly ViewType[],
): NotEvaluated | null {
  if (ctx.ref.view === 'unknown') {
    return notEvaluated(id, label, 'Angle de prise de vue indéterminé — cadre le joueur en entier, de face ou de derrière dans l’axe.')
  }
  if (!validViews.includes(ctx.ref.view)) {
    const needed = validViews.map(viewLabel).join(' ou ')
    return notEvaluated(id, label, `Visible uniquement sur une vidéo ${needed} — cette vidéo est ${viewLabel(ctx.ref.view)}.`)
  }
  return null
}

/** Construit un résultat de règle, en centralisant les champs répétitifs. */
export function makeFault(
  base: Omit<FaultResult, 'detected' | 'severity'> & { severity: Severity },
): FaultResult {
  return { ...base, detected: base.severity !== 'none' }
}
