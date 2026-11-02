/**
 * Détection des 8 événements du swing (nomenclature GolfDB).
 *
 * Choix d'implémentation : cinématique, pas de réseau de neurones.
 * Raison : le code de GolfDB/SwingNet est publié sous CC BY-NC 4.0 (non
 * commercial) et ses vidéos sont des extraits YouTube de tiers sans licence
 * énoncée ; et surtout, une règle sait EXPLIQUER pourquoi elle a déclenché —
 * ce qui est le produit qu'on veut livrer à un débutant.
 *
 * Honnêteté sur les limites : 4 des 8 événements (toe-up, mi-backswing,
 * mi-descente, mi-finish) sont définis par la POSITION DU CLUB dans GolfDB.
 * Le club n'est pas détecté ici, donc ces 4 événements sont des APPROXIMATIONS
 * basées sur la hauteur des mains, et leur confiance est plafonnée en
 * conséquence. Les 4 événements structurants (adresse, top, impact, finish)
 * sont, eux, déterminés par la cinématique réelle du corps.
 */

import { EVENTS, QUALITY } from './config'
import { argMax, argMin, clamp } from './geometry'
import { derivative } from './smoothing'
import type { CleanedPose } from './smoothing'
import { handsCenter, hipCenter, medianTorso } from './normalize'
import { SWING_EVENTS, type SwingEventConfidence, type SwingEvents } from './types'

export interface EventSignals {
  /** Abscisse du milieu des poignets. */
  handsX: Float64Array
  /** Ordonnée du milieu des poignets. */
  handsY: Float64Array
  /** Hauteur des mains au-dessus du bassin d'adresse, en U. */
  handHeight: Float64Array
  /** Norme de la vitesse des mains, en U/s. */
  handSpeed: Float64Array
  /** Échelle provisoire (torse médian). */
  scale: number
}

/** Plus longue plage d'immobilité dans [lo, hi]. */
function stillRuns(
  speed: Float64Array,
  lo: number,
  hi: number,
  maxSpeed: number,
  minLen: number,
): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = []
  let start = -1
  for (let f = lo; f <= hi; f++) {
    const s = speed[f]
    const still = Number.isFinite(s) && s < maxSpeed
    if (still && start < 0) start = f
    if (!still && start >= 0) {
      if (f - start >= minLen) runs.push({ start, end: f - 1 })
      start = -1
    }
  }
  if (start >= 0 && hi - start + 1 >= minLen) runs.push({ start, end: hi })
  return runs
}

export function computeSignals(c: CleanedPose): EventSignals {
  const n = c.n
  const handsX = new Float64Array(n).fill(NaN)
  const handsY = new Float64Array(n).fill(NaN)
  for (let f = 0; f < n; f++) {
    const h = handsCenter(c, f)
    handsX[f] = h.x
    handsY[f] = h.y
  }
  let scale = medianTorso(c)
  if (!Number.isFinite(scale) || scale < 1e-6) scale = 0.25

  const vx = derivative(handsX, c.fps)
  const vy = derivative(handsY, c.fps)
  const handSpeed = new Float64Array(n).fill(NaN)
  for (let f = 0; f < n; f++) {
    if (Number.isFinite(vx[f]) && Number.isFinite(vy[f])) {
      handSpeed[f] = Math.hypot(vx[f], vy[f]) / scale
    }
  }
  // handHeight est renseigné une fois l'adresse connue (cf. detectEvents).
  return { handsX, handsY, handHeight: new Float64Array(n).fill(NaN), handSpeed, scale }
}

/** Force une suite strictement croissante d'index dans [0, n-1]. */
function enforceOrder(frames: number[], n: number): number[] {
  const out = frames.slice()
  for (let i = 1; i < out.length; i++) {
    if (!(out[i] > out[i - 1])) out[i] = Math.min(n - 1, out[i - 1] + 1)
  }
  for (let i = out.length - 2; i >= 0; i--) {
    if (!(out[i] < out[i + 1])) out[i] = Math.max(0, out[i + 1] - 1)
  }
  return out.map((f) => clamp(Math.round(f), 0, n - 1))
}

export function detectEvents(
  c: CleanedPose,
  sig: EventSignals,
): { events: SwingEvents; confidence: SwingEventConfidence } {
  const n = c.n
  const minLen = Math.max(2, Math.round(EVENTS.minStillDuration * c.fps))

  // ---- 1. Adresse : dernière fenêtre d'immobilité avant le départ du club ----
  const addrHi = Math.max(minLen, Math.floor(n * EVENTS.addressSearchFraction))
  const addrRuns = stillRuns(sig.handSpeed, 0, Math.min(n - 1, addrHi), EVENTS.stillSpeed, minLen)
  let address: number
  let addressConf: number
  if (addrRuns.length > 0) {
    address = addrRuns[addrRuns.length - 1].end
    addressConf = 0.9
  } else {
    const q = argMin(sig.handSpeed, 0, Math.min(n - 1, addrHi))
    address = q >= 0 ? q : 0
    addressConf = 0.45
  }

  // ---- 2. Finish : première fenêtre d'immobilité de la fin ----
  const finLo = Math.min(n - 1, Math.floor(n * (1 - EVENTS.finishSearchFraction)))
  const finRuns = stillRuns(sig.handSpeed, finLo, n - 1, EVENTS.stillSpeed, minLen)
  let finish: number
  let finishConf: number
  if (finRuns.length > 0) {
    finish = finRuns[0].start
    finishConf = 0.9
  } else {
    finish = n - 1
    finishConf = 0.45
  }
  if (finish <= address + 2) {
    finish = n - 1
    finishConf = Math.min(finishConf, 0.4)
  }

  // ---- 3. Hauteur des mains, référencée sur le bassin d'adresse ----
  const hipRef = hipCenter(c, address)
  const hipRefY = Number.isFinite(hipRef.y) ? hipRef.y : NaN
  for (let f = 0; f < n; f++) {
    sig.handHeight[f] = Number.isFinite(hipRefY) && Number.isFinite(sig.handsY[f])
      ? (hipRefY - sig.handsY[f]) / sig.scale
      : NaN
  }

  // ---- 4. Sommet et impact : structure du mouvement vertical des mains ----
  //
  // Un swing a une signature verticale invariante : les mains montent
  // (backswing), redescendent (downswing), puis remontent (finish). Le sommet
  // est le changement de sens montée→descente, l'impact le point le plus bas
  // entre ce sommet et la remontée du finish.
  //
  // On n'utilise PAS le pic global de vitesse comme ancre : il échoue dès que
  // la montée est aussi rapide que la descente (swing précipité de débutant),
  // ce qui place l'« impact » en pleine montée. Le critère géométrique, lui,
  // ne dépend pas du rapport des vitesses.
  const dh = derivative(sig.handHeight, c.fps)
  const dead = EVENTS.heightVelocityDeadband

  /** Première frame de [lo, hi] où la vitesse verticale dépasse `sign * dead`. */
  const firstCrossing = (lo: number, hi: number, sign: 1 | -1): number => {
    for (let f = Math.max(0, lo); f <= Math.min(n - 1, hi); f++) {
      const v = dh[f]
      if (Number.isFinite(v) && sign * v > dead) return f
    }
    return -1
  }

  const takeaway = firstCrossing(address + 1, finish, 1)
  const descentStart = takeaway >= 0 ? firstCrossing(takeaway + 1, finish, -1) : -1

  let top = -1
  if (takeaway >= 0 && descentStart > takeaway) {
    top = argMax(sig.handHeight, takeaway, descentStart)
    // Un simple tressautement ne doit pas passer pour un sommet de backswing.
    const base = sig.handHeight[address]
    const prominence = Number.isFinite(base) ? sig.handHeight[top] - base : NaN
    if (Number.isFinite(prominence) && prominence < EVENTS.minTopProminence) top = -1
  }

  const speedPeak = argMax(sig.handSpeed, address + 1, finish)
  let geometricTop = true
  if (top < 0) {
    // Repli : point le plus haut avant le pic de vitesse.
    geometricTop = false
    const hi = speedPeak > address + 1 ? speedPeak - 1 : finish
    const fallback = argMax(sig.handHeight, address + 1, hi)
    top = fallback >= 0 ? fallback : Math.round((address + finish) / 2)
  }

  const finishRise = firstCrossing(top + 1, finish, 1)
  let impact = -1
  let geometricImpact = true
  if (finishRise > top) {
    impact = argMin(sig.handHeight, top + 1, finishRise)
  }
  if (impact < 0) {
    // Repli : pic de vitesse des mains après le sommet.
    geometricImpact = false
    const peakAfterTop = argMax(sig.handSpeed, top + 1, finish)
    impact = peakAfterTop >= 0 ? peakAfterTop : Math.min(finish - 1, top + 1)
  }

  // Affinage : à l'impact, les mains repassent à la hauteur d'adresse.
  const addressHandsY = sig.handsY[address]
  if (Number.isFinite(addressHandsY)) {
    let best = impact
    let bestDelta = Infinity
    for (let f = impact - EVENTS.impactRefineWindow; f <= impact + EVENTS.impactRefineWindow; f++) {
      if (f <= top || f >= finish || !Number.isFinite(sig.handsY[f])) continue
      const d = Math.abs(sig.handsY[f] - addressHandsY)
      if (d < bestDelta) {
        bestDelta = d
        best = f
      }
    }
    impact = best
  }

  const downswingFrames = impact - top
  const impactConf = clamp(
    0.95 * clamp(downswingFrames / QUALITY.minDownswingFrames, 0, 1) * (geometricImpact ? 1 : 0.6),
    0.2,
    0.95,
  )
  const topConf = clamp(
    0.9 * (geometricTop ? 1 : 0.6) * clamp((top - address) / 3, 0, 1),
    0.2,
    0.9,
  )

  // ---- 6. Les 4 approximations basées sur la hauteur des mains ----
  /** Première frame de [lo, hi] où handHeight franchit `level` vers le haut. */
  const crossUp = (lo: number, hi: number, level: number): number => {
    for (let f = lo; f <= hi; f++) if (sig.handHeight[f] >= level) return f
    return -1
  }
  /** Dernière frame de [lo, hi] où handHeight est encore au-dessus de `level`. */
  const crossDown = (lo: number, hi: number, level: number): number => {
    for (let f = hi; f >= lo; f--) if (sig.handHeight[f] >= level) return f
    return -1
  }

  const toeUpRaw = crossUp(address + 1, top, EVENTS.hipLevelHeight)
  const midBackRaw = crossUp(Math.max(address + 1, toeUpRaw < 0 ? address + 1 : toeUpRaw), top, EVENTS.shoulderLevelHeight)
  const midDownRaw = crossDown(top, Math.max(top, impact - 1), EVENTS.shoulderLevelHeight)
  const midFollowRaw = crossUp(impact + 1, finish, EVENTS.shoulderLevelHeight)

  const toeUp = toeUpRaw >= 0 ? toeUpRaw : Math.round(address + (top - address) * 0.33)
  const midBackswing = midBackRaw >= 0 ? midBackRaw : Math.round(address + (top - address) * 0.66)
  const midDownswing = midDownRaw >= 0 ? midDownRaw : Math.round(top + (impact - top) * 0.5)
  const midFollowThrough = midFollowRaw >= 0 ? midFollowRaw : Math.round(impact + (finish - impact) * 0.4)

  const ordered = enforceOrder(
    [address, toeUp, midBackswing, top, midDownswing, impact, midFollowThrough, finish],
    n,
  )

  const events = {} as SwingEvents
  SWING_EVENTS.forEach((name, i) => {
    events[name] = ordered[i]
  })

  // Les événements « club » sont plafonnés à 0.6 : ce sont des approximations.
  const proxyConf = 0.6
  const confidence: SwingEventConfidence = {
    address: addressConf,
    toeUp: toeUpRaw >= 0 ? proxyConf : 0.3,
    midBackswing: midBackRaw >= 0 ? proxyConf : 0.3,
    top: topConf,
    midDownswing: midDownRaw >= 0 ? proxyConf : 0.3,
    impact: impactConf,
    midFollowThrough: midFollowRaw >= 0 ? proxyConf : 0.3,
    finish: finishConf,
  }

  return { events, confidence }
}
