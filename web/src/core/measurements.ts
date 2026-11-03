/**
 * Grandeurs mesurées mais NON jugées.
 *
 * La position de la balle est un fondamental réel — elle dépend du club, et
 * un enseignant la regarde toujours. Mais aucune zone saine n'est publiée ici,
 * et le corpus ne permet pas d'en établir une : sur des vignettes 160×160 de
 * retransmission, la détection de balle ramène trop souvent une motte de
 * terre ou une ombre, et les distributions obtenues sont inexploitables
 * (distance à la balle négative au 10e centile, ce qui est physiquement
 * impossible).
 *
 * Plutôt que d'inventer un seuil, on affiche la mesure et on dit pourquoi
 * elle n'est pas jugée. C'est la seule position tenable : un seuil inventé se
 * serait retrouvé, comme les autres, à signaler des défauts imaginaires.
 */

import { LM } from './landmarks'
import { hasAll, pt, type CleanedPose } from './smoothing'
import type { BodyRef } from './normalize'
import type { BallObservation, Measurement, SwingEvents } from './types'

export interface MeasurementInput {
  c: CleanedPose
  ref: BodyRef
  events: SwingEvents
  ball: BallObservation | null
}

export function computeMeasurements({ c, ref, events, ball }: MeasurementInput): Measurement[] {
  const out: Measurement[] = []
  if (!ball) return out
  const a = events.address
  // La balle est normalisée sur la largeur ; les points clés l'ont été sur la
  // hauteur, l'anisotropie ayant été corrigée. Même correction ici.
  const ballX = ball.x * c.aspect

  if (ref.view === 'face_on' && hasAll(c, a, [ref.lead.ankle, ref.trail.ankle])) {
    const leadX = pt(c, ref.lead.ankle, a).x
    const trailX = pt(c, ref.trail.ankle, a).x
    const span = leadX - trailX
    if (Math.abs(span) > 0.25 * ref.scale) {
      out.push({
        id: 'ball_position',
        label: 'Position de la balle dans le stance',
        value: Math.round(((ballX - trailX) / span) * 100),
        unit: '% (0 = pied arrière, 100 = pied avant)',
        confidence: ball.confidence,
        frame: a,
        note:
          'Repère classique : balle vers le talon du pied avant au driver, plus proche du milieu au fer. ' +
          'Aucune zone saine n’est affichée faute de corpus fiable pour l’établir.',
      })
    }
  }

  if (ref.view === 'down_the_line' && hasAll(c, a, [LM.LEFT_FOOT_INDEX, LM.RIGHT_FOOT_INDEX]) && ref.scale > 1e-9) {
    const toeLine = (pt(c, LM.LEFT_FOOT_INDEX, a).x + pt(c, LM.RIGHT_FOOT_INDEX, a).x) / 2
    out.push({
      id: 'ball_distance',
      label: 'Distance à la balle',
      value: Math.round((((ballX - toeLine) * ref.ballSign) / ref.scale) * 100),
      unit: '% du torse, depuis la ligne des orteils',
      confidence: ball.confidence,
      frame: a,
      note:
        'Trop près, les bras manquent de place pour descendre ; trop loin, le poids part sur les orteils. ' +
        'Aucune zone saine n’est affichée faute de corpus fiable pour l’établir.',
    })
  }

  return out
}
