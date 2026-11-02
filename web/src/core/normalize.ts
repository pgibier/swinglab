/**
 * Mise en repère corporelle : échelle, latéralité, vue, orientations.
 *
 * Toute mesure du moteur est exprimée en « U » (longueur de torse à l'adresse)
 * et non en pixels : l'analyse devient indépendante de la distance au
 * téléphone, de la résolution et de la taille du joueur.
 */

import { VIEW } from './config'
import { LM } from './landmarks'
import { angleAt, clamp, dist, mid, type Pt } from './geometry'
import { hasAll, pt, type CleanedPose } from './smoothing'
import type { Handedness, ViewType } from './types'

export interface BodyRef {
  addressFrame: number
  /** 1 U = longueur de torse à l'adresse, en unités de hauteur d'image. */
  scale: number
  hipOrigin: Pt
  shoulderOrigin: Pt
  noseOrigin: Pt
  handedness: Handedness
  handednessConfidence: number
  view: ViewType
  viewConfidence: number
  /** +1 si l'axe x de l'image pointe vers la cible, -1 sinon. */
  targetSign: number
  /** +1 si l'axe x de l'image pointe vers la balle (utile en vue down-the-line). */
  ballSign: number
  /** Indices des points clés du côté avant (côté cible). */
  lead: { shoulder: number; elbow: number; wrist: number; hip: number; knee: number; ankle: number }
  /** Indices des points clés du côté arrière. */
  trail: { shoulder: number; elbow: number; wrist: number; hip: number; knee: number; ankle: number }
}

const LEFT_SIDE = {
  shoulder: LM.LEFT_SHOULDER, elbow: LM.LEFT_ELBOW, wrist: LM.LEFT_WRIST,
  hip: LM.LEFT_HIP, knee: LM.LEFT_KNEE, ankle: LM.LEFT_ANKLE,
}
const RIGHT_SIDE = {
  shoulder: LM.RIGHT_SHOULDER, elbow: LM.RIGHT_ELBOW, wrist: LM.RIGHT_WRIST,
  hip: LM.RIGHT_HIP, knee: LM.RIGHT_KNEE, ankle: LM.RIGHT_ANKLE,
}

/** Interpolation douce : 0 sous `lo`, 1 au-dessus de `hi`. */
function smoothstep(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0.5
  if (hi <= lo) return v >= hi ? 1 : 0
  const t = clamp((v - lo) / (hi - lo), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Milieu des hanches d'une frame. NaN si indisponible. */
export function hipCenter(c: CleanedPose, f: number): Pt {
  if (!hasAll(c, f, [LM.LEFT_HIP, LM.RIGHT_HIP])) return { x: NaN, y: NaN }
  return mid(pt(c, LM.LEFT_HIP, f), pt(c, LM.RIGHT_HIP, f))
}

/** Milieu des épaules d'une frame. NaN si indisponible. */
export function shoulderCenter(c: CleanedPose, f: number): Pt {
  if (!hasAll(c, f, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER])) return { x: NaN, y: NaN }
  return mid(pt(c, LM.LEFT_SHOULDER, f), pt(c, LM.RIGHT_SHOULDER, f))
}

/** Milieu des poignets — proxy de la position des mains (le club n'est pas détecté). */
export function handsCenter(c: CleanedPose, f: number): Pt {
  if (!hasAll(c, f, [LM.LEFT_WRIST, LM.RIGHT_WRIST])) return { x: NaN, y: NaN }
  return mid(pt(c, LM.LEFT_WRIST, f), pt(c, LM.RIGHT_WRIST, f))
}

/**
 * Trajectoire des mains sur toute la séquence, avec repli sur un seul poignet.
 *
 * Pourquoi : exiger les DEUX poignets perd le signal dès qu'un bras masque
 * l'autre — ce qui est la norme en vue de derrière. Mesuré sur 1 045 swings de
 * professionnels, les deux poignets ne sont visibles plus de 90 % du temps que
 * dans 40 % des clips, alors qu'AU MOINS UN l'est dans 100 % d'entre eux. La
 * conséquence était une erreur médiane de 34 images sur l'adresse en vue de
 * derrière, contre 9 de face.
 *
 * Le repli n'utilise pas le poignet brut, qui introduirait un saut de position
 * à chaque bascule et donc un faux pic de vitesse : on applique le décalage
 * médian mesuré entre ce poignet et le milieu, sur les images où les deux sont
 * visibles. Les mains tenant le même grip, ce décalage est petit et stable.
 */
export function handsSeries(c: CleanedPose): { x: Float64Array; y: Float64Array } {
  const n = c.n
  const x = new Float64Array(n).fill(NaN)
  const y = new Float64Array(n).fill(NaN)

  const offLx: number[] = []
  const offLy: number[] = []
  const offRx: number[] = []
  const offRy: number[] = []

  for (let f = 0; f < n; f++) {
    if (!hasAll(c, f, [LM.LEFT_WRIST, LM.RIGHT_WRIST])) continue
    const l = pt(c, LM.LEFT_WRIST, f)
    const r = pt(c, LM.RIGHT_WRIST, f)
    const m = mid(l, r)
    x[f] = m.x
    y[f] = m.y
    offLx.push(m.x - l.x)
    offLy.push(m.y - l.y)
    offRx.push(m.x - r.x)
    offRy.push(m.y - r.y)
  }

  const median = (values: number[]): number => {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const i = sorted.length >> 1
    return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2
  }
  const dLx = median(offLx)
  const dLy = median(offLy)
  const dRx = median(offRx)
  const dRy = median(offRy)

  for (let f = 0; f < n; f++) {
    if (Number.isFinite(x[f])) continue
    if (hasAll(c, f, [LM.LEFT_WRIST])) {
      const l = pt(c, LM.LEFT_WRIST, f)
      x[f] = l.x + dLx
      y[f] = l.y + dLy
    } else if (hasAll(c, f, [LM.RIGHT_WRIST])) {
      const r = pt(c, LM.RIGHT_WRIST, f)
      x[f] = r.x + dRx
      y[f] = r.y + dRy
    }
  }
  return { x, y }
}

/**
 * Longueur de torse médiane sur toute la séquence.
 * Sert d'échelle provisoire avant que l'adresse ne soit connue.
 */
export function medianTorso(c: CleanedPose): number {
  const vals: number[] = []
  for (let f = 0; f < c.n; f++) {
    const h = hipCenter(c, f)
    const s = shoulderCenter(c, f)
    if (Number.isFinite(h.x) && Number.isFinite(s.x)) vals.push(dist(h, s))
  }
  if (vals.length === 0) return NaN
  vals.sort((a, b) => a - b)
  return vals[Math.floor(vals.length / 2)]
}

/**
 * Latéralité déduite de la physique du swing : au sommet du backswing, le
 * coude ARRIÈRE est nettement plié tandis que le bras avant reste tendu.
 * Avantage sur une heuristique de position : fonctionne dans les deux vues et
 * ne dépend pas du sens de la caméra.
 */
function detectHandedness(
  c: CleanedPose,
  topFrame: number,
): { handedness: Handedness; confidence: number } {
  const span = 2
  const leftAngles: number[] = []
  const rightAngles: number[] = []
  for (let f = topFrame - span; f <= topFrame + span; f++) {
    if (f < 0 || f >= c.n) continue
    if (hasAll(c, f, [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST])) {
      const a = angleAt(pt(c, LM.LEFT_SHOULDER, f), pt(c, LM.LEFT_ELBOW, f), pt(c, LM.LEFT_WRIST, f))
      if (Number.isFinite(a)) leftAngles.push(a)
    }
    if (hasAll(c, f, [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST])) {
      const a = angleAt(pt(c, LM.RIGHT_SHOULDER, f), pt(c, LM.RIGHT_ELBOW, f), pt(c, LM.RIGHT_WRIST, f))
      if (Number.isFinite(a)) rightAngles.push(a)
    }
  }
  if (leftAngles.length === 0 || rightAngles.length === 0) {
    return { handedness: 'right', confidence: 0.3 }
  }
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
  const l = avg(leftAngles)
  const r = avg(rightAngles)
  // Le coude le plus fermé est le coude arrière.
  const handedness: Handedness = r < l ? 'right' : 'left'
  const confidence = 0.5 + 0.5 * clamp(Math.abs(l - r) / 35, 0, 1)
  return { handedness, confidence }
}

/**
 * Classification de la vue à partir de la géométrie d'adresse.
 * De face : chevilles et épaules nettement écartées horizontalement.
 * Down-the-line (derrière, dans l'axe de la cible) : tout est écrasé par la perspective.
 */
function detectView(
  c: CleanedPose,
  addressFrame: number,
  torso: number,
): { view: ViewType; confidence: number } {
  if (!Number.isFinite(torso) || torso < 1e-6) return { view: 'unknown', confidence: 0 }

  const indicators: number[] = []

  if (hasAll(c, addressFrame, [LM.LEFT_ANKLE, LM.RIGHT_ANKLE])) {
    const sep = Math.abs(pt(c, LM.LEFT_ANKLE, addressFrame).x - pt(c, LM.RIGHT_ANKLE, addressFrame).x) / torso
    indicators.push(smoothstep(sep, VIEW.stanceRatioDtlMax, VIEW.stanceRatioFaceOnMin))
  }
  if (hasAll(c, addressFrame, [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER])) {
    const sep = Math.abs(pt(c, LM.LEFT_SHOULDER, addressFrame).x - pt(c, LM.RIGHT_SHOULDER, addressFrame).x) / torso
    indicators.push(smoothstep(sep, VIEW.shoulderRatioDtlMax, VIEW.shoulderRatioFaceOnMin))
  }
  if (indicators.length === 0) return { view: 'unknown', confidence: 0 }

  const score = indicators.reduce((s, v) => s + v, 0) / indicators.length
  const confidence = clamp(Math.abs(score - 0.5) * 2, 0, 1)
  if (confidence < VIEW.minConfidence) return { view: 'unknown', confidence }
  return { view: score > 0.5 ? 'face_on' : 'down_the_line', confidence }
}

/**
 * Construit le repère corporel. `topFrame` est nécessaire pour la latéralité.
 */
export function buildReference(c: CleanedPose, addressFrame: number, topFrame: number): BodyRef {
  const hipOrigin = hipCenter(c, addressFrame)
  const shoulderOrigin = shoulderCenter(c, addressFrame)
  const noseOrigin = hasAll(c, addressFrame, [LM.NOSE])
    ? pt(c, LM.NOSE, addressFrame)
    : { x: NaN, y: NaN }

  let scale = Number.isFinite(hipOrigin.x) && Number.isFinite(shoulderOrigin.x)
    ? dist(hipOrigin, shoulderOrigin)
    : NaN
  if (!Number.isFinite(scale) || scale < 1e-6) scale = medianTorso(c)

  const { handedness, confidence: handednessConfidence } = detectHandedness(c, topFrame)
  const { view, confidence: viewConfidence } = detectView(c, addressFrame, scale)

  const lead = handedness === 'right' ? LEFT_SIDE : RIGHT_SIDE
  const trail = handedness === 'right' ? RIGHT_SIDE : LEFT_SIDE

  // Le côté avant fait face à la cible.
  let targetSign = 1
  if (hasAll(c, addressFrame, [lead.hip, trail.hip])) {
    const d = pt(c, lead.hip, addressFrame).x - pt(c, trail.hip, addressFrame).x
    if (Math.abs(d) > 1e-6) targetSign = Math.sign(d)
  }

  // Les orteils pointent vers la balle.
  let ballSign = 1
  const toeDeltas: number[] = []
  for (const [toe, heel] of [
    [LM.LEFT_FOOT_INDEX, LM.LEFT_HEEL],
    [LM.RIGHT_FOOT_INDEX, LM.RIGHT_HEEL],
  ] as const) {
    if (hasAll(c, addressFrame, [toe, heel])) {
      toeDeltas.push(pt(c, toe, addressFrame).x - pt(c, heel, addressFrame).x)
    }
  }
  if (toeDeltas.length > 0) {
    const m = toeDeltas.reduce((s, v) => s + v, 0) / toeDeltas.length
    if (Math.abs(m) > 1e-6) ballSign = Math.sign(m)
  }

  return {
    addressFrame,
    scale,
    hipOrigin,
    shoulderOrigin,
    noseOrigin,
    handedness,
    handednessConfidence,
    view,
    viewConfidence,
    targetSign,
    ballSign,
    lead,
    trail,
  }
}
