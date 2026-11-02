/**
 * Détection des 8 événements du swing (nomenclature GolfDB).
 *
 * Choix d'implémentation : cinématique, pas de réseau de neurones.
 * Raison : le code de GolfDB/SwingNet est publié sous CC BY-NC 4.0 (non
 * commercial) et ses vidéos sont des extraits YouTube de tiers sans licence
 * énoncée ; et surtout, une règle sait EXPLIQUER pourquoi elle a déclenché —
 * ce qui est le produit qu'on veut livrer à un débutant.
 *
 * RECHERCHE GLOBALE, et pourquoi.
 * Une première version cherchait séquentiellement : adresse = dernière fenêtre
 * d'immobilité du début de vidéo, puis sommet, puis impact. Mesurée sur 335
 * swings de professionnels annotés, elle plaçait l'impact franchement à côté
 * dans 40 % des cas — en verrouillant sur un swing d'essai, un replacement ou
 * une seconde balle, c'est-à-dire sur un autre mouvement que celui attendu.
 * Sur les clips propres elle était pourtant juste à 2 images près : c'était la
 * stratégie de recherche qui était fausse, pas la mesure.
 *
 * On énumère donc les candidats d'impact dans TOUTE la vidéo (pics de vitesse
 * des mains), on reconstruit un swing complet autour de chacun, et on retient
 * celui qui est physiquement le plus plausible : amplitude verticale des
 * mains, durées de montée et de descente, tempo, et cohérence entre le point
 * bas des mains et le pic de vitesse.
 *
 * Honnêteté sur les limites : 4 des 8 événements (toe-up, mi-backswing,
 * mi-descente, mi-finish) sont définis par la POSITION DU CLUB dans GolfDB.
 * Le club n'est pas détecté ici, donc ces 4 événements sont des APPROXIMATIONS
 * basées sur la hauteur des mains, et leur confiance est plafonnée en
 * conséquence.
 */

import { EVENTS, QUALITY } from './config'
import { argMax, argMin, clamp } from './geometry'
import { derivative } from './smoothing'
import type { CleanedPose } from './smoothing'
import { handsSeries, hipCenter, medianTorso } from './normalize'
import { SWING_EVENTS, type SwingEventConfidence, type SwingEvents } from './types'

export interface EventSignals {
  /** Abscisse du milieu des poignets. */
  handsX: Float64Array
  /** Ordonnée du milieu des poignets (l'axe y descend : plus petit = plus haut). */
  handsY: Float64Array
  /** Hauteur des mains au-dessus du bassin d'adresse, en U. */
  handHeight: Float64Array
  /** Norme de la vitesse des mains, en U/s. */
  handSpeed: Float64Array
  /** Échelle provisoire (torse médian). */
  scale: number
}

export function computeSignals(c: CleanedPose): EventSignals {
  const n = c.n
  const { x: handsX, y: handsY } = handsSeries(c)
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

/** Plages d'immobilité d'au moins `minLen` frames dans [lo, hi]. */
function stillRuns(
  speed: Float64Array,
  lo: number,
  hi: number,
  maxSpeed: number,
  minLen: number,
): Array<{ start: number; end: number }> {
  const runs: Array<{ start: number; end: number }> = []
  let start = -1
  for (let f = Math.max(0, lo); f <= hi; f++) {
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

/**
 * Maxima locaux dépassant une fraction du pic global, espacés d'au moins
 * `separation` frames (suppression des non-maxima).
 */
function speedPeaks(speed: Float64Array, ratio: number, separation: number): number[] {
  const n = speed.length
  const globalIdx = argMax(speed, 0, n - 1)
  if (globalIdx < 0) return []
  const threshold = speed[globalIdx] * ratio

  const candidates: number[] = []
  for (let f = 1; f < n - 1; f++) {
    const v = speed[f]
    if (!Number.isFinite(v) || v < threshold) continue
    if (v >= speed[f - 1] && v > speed[f + 1]) candidates.push(f)
  }
  if (candidates.length === 0) return [globalIdx]

  // Du plus fort au plus faible, en écartant les voisins déjà retenus.
  candidates.sort((a, b) => speed[b] - speed[a])
  const kept: number[] = []
  for (const f of candidates) {
    if (kept.every((k) => Math.abs(k - f) >= separation)) kept.push(f)
    if (kept.length >= 8) break
  }
  return kept.sort((a, b) => a - b)
}

/** Score de plausibilité d'une durée, 1 dans la plage, décroissant au-delà. */
function plausible(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (value >= min && value <= max) return 1
  const span = max - min || 1
  const excess = value < min ? min - value : value - max
  return clamp(1 - excess / span, 0, 1)
}

interface Candidate {
  /** Début de la fenêtre d'immobilité d'adresse. */
  addressStart: number
  address: number
  top: number
  impact: number
  finish: number
  score: number
  addressFound: boolean
  finishFound: boolean
}

/** Reconstruit un swing autour d'un pic de vitesse et le note. */
function buildCandidate(
  sig: EventSignals,
  peak: number,
  fps: number,
  n: number,
  minLen: number,
  globalPeakSpeed: number,
): Candidate | null {
  const backWindow = Math.round(EVENTS.maxBackswingSec * fps)

  // Sommet : mains les plus hautes (y minimal) juste avant le pic.
  const top = argMin(sig.handsY, Math.max(0, peak - backWindow), Math.max(0, peak - 1))
  if (top < 0) return null

  // Impact : mains les plus basses après le sommet, dans une fenêtre de descente
  // généreuse — au-delà, les mains remontent dans le finish.
  const downWindow = Math.round(EVENTS.maxDownswingSec * fps * 1.5)
  const impact = argMax(sig.handsY, top + 1, Math.min(n - 1, top + downWindow))
  if (impact <= top) return null

  // Adresse : dernière immobilité avant le sommet.
  const preRuns = stillRuns(sig.handSpeed, 0, Math.max(0, top - 1), EVENTS.stillSpeed, minLen)
  const addressFound = preRuns.length > 0
  const addressRun = addressFound ? preRuns[preRuns.length - 1] : null
  const address = addressRun
    ? addressRun.end
    : Math.max(0, top - Math.round(EVENTS.minBackswingSec * fps))
  const addressStart = addressRun ? addressRun.start : address

  // Finish : première immobilité après l'impact, passé un délai minimal.
  const finishFrom = Math.min(n - 1, impact + Math.round(EVENTS.finishDelaySec * fps))
  const postRuns = stillRuns(sig.handSpeed, finishFrom, n - 1, EVENTS.stillSpeed, minLen)
  const finishFound = postRuns.length > 0
  const finish = finishFound ? postRuns[0].start : n - 1

  if (!(address < top && top < impact && impact < finish)) return null

  const backSec = (top - address) / fps
  const downSec = (impact - top) / fps
  const dropU = (sig.handsY[impact] - sig.handsY[top]) / sig.scale
  const tempo = backSec / Math.max(1e-6, downSec)

  // Une amplitude verticale insuffisante n'est pas un swing : c'est un waggle,
  // un replacement ou un pas de côté.
  if (!Number.isFinite(dropU) || dropU < EVENTS.minHandDropU) return null

  const score =
    clamp(sig.handSpeed[peak] / Math.max(1e-6, globalPeakSpeed), 0, 1) *
    clamp(dropU / EVENTS.idealHandDropU, 0, 1) *
    plausible(backSec, EVENTS.minBackswingSec, EVENTS.maxBackswingSec) *
    plausible(downSec, EVENTS.minDownswingSec, EVENTS.maxDownswingSec) *
    plausible(tempo, EVENTS.candidateTempoMin, EVENTS.candidateTempoMax) *
    // Le pic de vitesse des mains PRÉCÈDE normalement l'impact d'une centaine
    // de millisecondes : les mains décélèrent quand le club se libère. On
    // tolère donc pleinement cet écart, et on ne pénalise qu'au-delà — sinon
    // on punit la physique du geste au lieu de détecter une incohérence.
    plausible(Math.abs(impact - peak) / fps, 0, EVENTS.peakAlignSec) *
    (addressFound ? 1 : 0.7) *
    (finishFound ? 1 : 0.85)

  return { addressStart, address, top, impact, finish, score, addressFound, finishFound }
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
): {
  events: SwingEvents
  confidence: SwingEventConfidence
  /**
   * Plage d'images sur laquelle le joueur est immobile à l'adresse.
   *
   * Les mesures de setup y sont moyennées plutôt que lues sur une image
   * isolée : comparé à l'annotation humaine de GolfDB, choisir l'une ou
   * l'autre borne de cette plage déplaçait l'inclinaison du buste de 7,9° au
   * 90e centile — pour un seuil de déclenchement à 6°.
   */
  addressWindow: { start: number; end: number }
} {
  const n = c.n
  const minLen = Math.max(2, Math.round(EVENTS.minStillDuration * c.fps))

  // ---- 1. Candidats d'impact dans toute la vidéo ----
  const separation = Math.max(2, Math.round(EVENTS.peakMinSeparationSec * c.fps))
  const peaks = speedPeaks(sig.handSpeed, EVENTS.peakProminenceRatio, separation)
  const globalPeakIdx = argMax(sig.handSpeed, 0, n - 1)
  const globalPeakSpeed = globalPeakIdx >= 0 ? sig.handSpeed[globalPeakIdx] : 1

  let best: Candidate | null = null
  for (const peak of peaks) {
    const candidate = buildCandidate(sig, peak, c.fps, n, minLen, globalPeakSpeed)
    if (candidate && (!best || candidate.score > best.score)) best = candidate
  }

  // ---- 2. Repli : aucun candidat crédible ----
  if (!best) {
    const top = argMin(sig.handsY, 1, n - 2)
    const impact = argMax(sig.handsY, Math.max(1, top + 1), n - 1)
    const fallbackAddress = Math.max(0, Math.min(top - 1, Math.round(n * 0.1)))
    best = {
      addressStart: fallbackAddress,
      address: fallbackAddress,
      top: Math.max(1, top),
      impact: Math.max(2, impact),
      finish: n - 1,
      score: 0,
      addressFound: false,
      finishFound: false,
    }
  }

  const { address, top, impact, finish } = best

  // ---- 3. Hauteur des mains, référencée sur le bassin d'adresse ----
  const hipRef = hipCenter(c, address)
  const hipRefY = Number.isFinite(hipRef.y) ? hipRef.y : NaN
  for (let f = 0; f < n; f++) {
    sig.handHeight[f] =
      Number.isFinite(hipRefY) && Number.isFinite(sig.handsY[f])
        ? (hipRefY - sig.handsY[f]) / sig.scale
        : NaN
  }

  // ---- 4. Les 4 approximations basées sur la hauteur des mains ----
  const crossUp = (lo: number, hi: number, level: number): number => {
    for (let f = Math.max(0, lo); f <= Math.min(n - 1, hi); f++) {
      if (sig.handHeight[f] >= level) return f
    }
    return -1
  }
  const crossDown = (lo: number, hi: number, level: number): number => {
    for (let f = Math.min(n - 1, hi); f >= Math.max(0, lo); f--) {
      if (sig.handHeight[f] >= level) return f
    }
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

  // ---- 5. Confiances ----
  const downswingFrames = events.impact - events.top
  // La confiance du candidat retenu porte toute la détection : un score faible
  // signale une vidéo où aucun mouvement ne ressemble vraiment à un swing.
  const structural = clamp(0.35 + 0.6 * best.score, 0.2, 0.95)
  const impactConf = clamp(
    structural * clamp(downswingFrames / QUALITY.minDownswingFrames, 0.3, 1),
    0.2,
    0.95,
  )
  const proxyConf = clamp(structural * 0.65, 0.2, 0.6)

  const confidence: SwingEventConfidence = {
    address: best.addressFound ? structural : structural * 0.5,
    toeUp: toeUpRaw >= 0 ? proxyConf : proxyConf * 0.5,
    midBackswing: midBackRaw >= 0 ? proxyConf : proxyConf * 0.5,
    top: structural,
    midDownswing: midDownRaw >= 0 ? proxyConf : proxyConf * 0.5,
    impact: impactConf,
    midFollowThrough: midFollowRaw >= 0 ? proxyConf : proxyConf * 0.5,
    finish: best.finishFound ? structural : structural * 0.5,
  }

  return {
    events,
    confidence,
    addressWindow: { start: Math.min(best.addressStart, events.address), end: events.address },
  }
}
