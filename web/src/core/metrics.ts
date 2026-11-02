/**
 * Calcul des séries temporelles biomécaniques.
 *
 * Toutes les longueurs sont divisées par U (longueur de torse à l'adresse) et
 * tous les déplacements latéraux sont orientés par rapport à la cible ou à la
 * balle : une mesure ne dépend donc ni de la distance au téléphone, ni du sens
 * dans lequel le joueur est filmé, ni de sa latéralité.
 */

import { LM } from './landmarks'
import { angleAt, angleFromVertical, dist, signedAngleFromVertical } from './geometry'
import { hasAll, pt, type CleanedPose } from './smoothing'
import { hipCenter, shoulderCenter, type BodyRef } from './normalize'
import type { EventSignals } from './events'
import type { MetricSeries } from './types'

export function computeMetrics(c: CleanedPose, ref: BodyRef, sig: EventSignals): MetricSeries {
  const n = c.n
  const nan = () => new Array<number>(n).fill(NaN)

  const spineTilt = nan()
  const spineLean = nan()
  const hipLateral = nan()
  const hipTowardBall = nan()
  const headShift = nan()
  const headLateral = nan()
  const leadElbow = nan()
  const trailElbow = nan()
  const kneeFlex = nan()
  const shoulderTurnProxy = nan()
  const hipTurnProxy = nan()

  const U = ref.scale
  const a = ref.addressFrame

  const shoulderWidth0 = hasAll(c, a, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER])
    ? Math.abs(pt(c, LM.LEFT_SHOULDER, a).x - pt(c, LM.RIGHT_SHOULDER, a).x)
    : NaN
  const hipWidth0 = hasAll(c, a, [LM.LEFT_HIP, LM.RIGHT_HIP])
    ? Math.abs(pt(c, LM.LEFT_HIP, a).x - pt(c, LM.RIGHT_HIP, a).x)
    : NaN

  for (let f = 0; f < n; f++) {
    const hip = hipCenter(c, f)
    const sh = shoulderCenter(c, f)

    if (Number.isFinite(hip.x) && Number.isFinite(sh.x)) {
      spineTilt[f] = angleFromVertical(hip, sh)
      spineLean[f] = signedAngleFromVertical(hip, sh, ref.targetSign)
    }

    if (Number.isFinite(hip.x) && Number.isFinite(ref.hipOrigin.x) && U > 1e-9) {
      hipLateral[f] = ((hip.x - ref.hipOrigin.x) * ref.targetSign) / U
      hipTowardBall[f] = ((hip.x - ref.hipOrigin.x) * ref.ballSign) / U
    }

    if (hasAll(c, f, [LM.NOSE]) && Number.isFinite(ref.noseOrigin.x) && U > 1e-9) {
      const nose = pt(c, LM.NOSE, f)
      headShift[f] = dist(nose, ref.noseOrigin) / U
      headLateral[f] = ((nose.x - ref.noseOrigin.x) * ref.targetSign) / U
    }

    if (hasAll(c, f, [ref.lead.shoulder, ref.lead.elbow, ref.lead.wrist])) {
      leadElbow[f] = angleAt(
        pt(c, ref.lead.shoulder, f),
        pt(c, ref.lead.elbow, f),
        pt(c, ref.lead.wrist, f),
      )
    }
    if (hasAll(c, f, [ref.trail.shoulder, ref.trail.elbow, ref.trail.wrist])) {
      trailElbow[f] = angleAt(
        pt(c, ref.trail.shoulder, f),
        pt(c, ref.trail.elbow, f),
        pt(c, ref.trail.wrist, f),
      )
    }

    const knees: number[] = []
    for (const side of [ref.lead, ref.trail]) {
      if (hasAll(c, f, [side.hip, side.knee, side.ankle])) {
        const k = angleAt(pt(c, side.hip, f), pt(c, side.knee, f), pt(c, side.ankle, f))
        if (Number.isFinite(k)) knees.push(k)
      }
    }
    if (knees.length > 0) kneeFlex[f] = knees.reduce((s, v) => s + v, 0) / knees.length

    // Proxy de rotation : l'écartement apparent des épaules/hanches diminue
    // quand le buste pivote (écrasement par la perspective).
    if (Number.isFinite(shoulderWidth0) && shoulderWidth0 > 1e-9 &&
        hasAll(c, f, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER])) {
      shoulderTurnProxy[f] =
        Math.abs(pt(c, LM.LEFT_SHOULDER, f).x - pt(c, LM.RIGHT_SHOULDER, f).x) / shoulderWidth0
    }
    if (Number.isFinite(hipWidth0) && hipWidth0 > 1e-9 &&
        hasAll(c, f, [LM.LEFT_HIP, LM.RIGHT_HIP])) {
      hipTurnProxy[f] = Math.abs(pt(c, LM.LEFT_HIP, f).x - pt(c, LM.RIGHT_HIP, f).x) / hipWidth0
    }
  }

  return {
    spineTilt,
    spineLean,
    hipLateral,
    hipTowardBall,
    headShift,
    headLateral,
    leadElbow,
    trailElbow,
    kneeFlex,
    shoulderTurnProxy,
    hipTurnProxy,
    handHeight: Array.from(sig.handHeight),
    handSpeed: Array.from(sig.handSpeed),
  }
}
