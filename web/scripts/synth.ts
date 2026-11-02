/**
 * Générateur de swings synthétiques, pour tester le moteur sans vidéo réelle.
 *
 * On fabrique directement des séquences de points clés au format MediaPipe,
 * avec des défauts injectés de façon contrôlée. Cela permet de vérifier que
 * chaque règle déclenche sur ce qu'elle prétend mesurer — ce qu'aucune vidéo
 * d'exemple ne permet de garantir, faute de vérité terrain annotée.
 *
 * Repère : tout est calculé en « unités de hauteur d'image » (hu), puis x est
 * converti en coordonnée normalisée MediaPipe (x_norm = x_hu / aspect).
 */

import { LANDMARK_COUNT, LM } from '../src/core/landmarks'
import type { Landmark, PoseSequence } from '../src/core/types'

export interface SynthOptions {
  view: 'face_on' | 'down_the_line'
  fps?: number
  width?: number
  height?: number
  /** Décalage latéral du bassin à l'écart de la cible au sommet, en U (sway). */
  swayU?: number
  /** Décalage du bassin vers la cible à l'impact, en U (slide). */
  slideU?: number
  /** Bascule du buste vers la cible au sommet, en degrés (reverse pivot). */
  reversePivotDeg?: number
  /** Déplacement de la tête à l'impact, en U. */
  headShiftU?: number
  /** Avancée du bassin vers la balle à l'impact, en U (early extension). */
  earlyExtensionU?: number
  /** Inclinaison du buste à l'adresse, en degrés (vue DTL). */
  spineTiltDeg?: number
  /** Variation d'inclinaison du buste à l'impact, en degrés (loss of posture). */
  postureLossDeg?: number
  /** Angle du coude avant au mi-finish, en degrés (chicken wing si faible). */
  leadElbowFollowDeg?: number
  /** Angle des genoux à l'adresse, en degrés. */
  kneeAngleDeg?: number
  /** Écartement des chevilles, en multiples de la largeur d'épaules. */
  stanceRatio?: number
  /** Durée de la montée, en secondes. */
  backswingSec?: number
  /** Durée de la descente, en secondes. */
  downswingSec?: number
}

const U = 0.17 // longueur de torse, en unités de hauteur d'image
const SHOULDER_W = 0.9 * U
const HIP_W = 0.62 * U
const HIP_Y = 0.6
const DEG = Math.PI / 180

interface Hu {
  x: number
  y: number
}

/**
 * Place le coude de façon à obtenir l'angle épaule-coude-poignet demandé.
 * Géométrie : pour un coude à distance `d` du milieu du segment,
 * angle = 180° − 2·atan(d / (L/2)).
 */
function elbowFor(shoulder: Hu, wrist: Hu, angleDeg: number, side: number): Hu {
  const dx = wrist.x - shoulder.x
  const dy = wrist.y - shoulder.y
  const L = Math.hypot(dx, dy) || 1e-6
  const d = (L / 2) * Math.tan(((180 - angleDeg) / 2) * DEG)
  const nx = -dy / L
  const ny = dx / L
  return {
    x: shoulder.x + dx / 2 + nx * d * side,
    y: shoulder.y + dy / 2 + ny * d * side,
  }
}

/** Interpolation lissée entre deux valeurs. */
const smooth = (a: number, b: number, t: number): number => {
  const s = t * t * (3 - 2 * t)
  return a + (b - a) * s
}

export function synthSwing(opts: SynthOptions): PoseSequence {
  const fps = opts.fps ?? 60
  const width = opts.width ?? 1080
  const height = opts.height ?? 1920
  const aspect = width / height

  const addressSec = 0.5
  const backSec = opts.backswingSec ?? 0.75
  const downSec = opts.downswingSec ?? 0.25
  const followSec = 0.6
  const finishSec = 0.5
  const totalSec = addressSec + backSec + downSec + followSec + finishSec
  const n = Math.round(totalSec * fps)

  const dtl = opts.view === 'down_the_line'
  // Côté avant = côté cible. En vue de face, caméra devant le joueur : le côté
  // gauche du joueur (droitier) apparaît à droite de l'image → targetSign = +1.
  const targetSign = 1
  const ballSign = 1

  const stanceRatio = opts.stanceRatio ?? 1.05
  const stanceW = dtl ? 0.04 * U : stanceRatio * SHOULDER_W
  const spineTilt0 = opts.spineTiltDeg ?? 32
  const kneeAngle = opts.kneeAngleDeg ?? 163

  const frames: Landmark[][] = []
  const timestamps: number[] = []

  for (let i = 0; i < n; i++) {
    const t = i / fps
    timestamps.push(t)

    // --- progression dans les phases ---
    let phase: 'address' | 'back' | 'down' | 'follow' | 'finish'
    let p = 0
    if (t < addressSec) {
      phase = 'address'
    } else if (t < addressSec + backSec) {
      phase = 'back'
      p = (t - addressSec) / backSec
    } else if (t < addressSec + backSec + downSec) {
      phase = 'down'
      p = (t - addressSec - backSec) / downSec
    } else if (t < addressSec + backSec + downSec + followSec) {
      phase = 'follow'
      p = (t - addressSec - backSec - downSec) / followSec
    } else {
      phase = 'finish'
      p = (t - addressSec - backSec - downSec - followSec) / finishSec
    }

    // --- bassin ---
    let hipX = 0
    if (phase === 'back') hipX = smooth(0, -(opts.swayU ?? 0) * U * targetSign, p)
    else if (phase === 'down') {
      hipX = smooth(-(opts.swayU ?? 0) * U * targetSign, (opts.slideU ?? 0) * U * targetSign, p)
    } else if (phase === 'follow' || phase === 'finish') {
      hipX = (opts.slideU ?? 0) * U * targetSign
    }

    // Early extension : le bassin avance vers la balle pendant la descente.
    let hipBall = 0
    if (phase === 'down') hipBall = smooth(0, (opts.earlyExtensionU ?? 0) * U * ballSign, p)
    else if (phase === 'follow' || phase === 'finish') hipBall = (opts.earlyExtensionU ?? 0) * U * ballSign

    const hip: Hu = { x: (dtl ? hipBall : hipX), y: HIP_Y }

    // --- buste ---
    let tilt = spineTilt0
    if (phase === 'down') tilt = smooth(spineTilt0, spineTilt0 - (opts.postureLossDeg ?? 0), p)
    else if (phase === 'follow' || phase === 'finish') tilt = spineTilt0 - (opts.postureLossDeg ?? 0)

    let lean = 0 // bascule latérale (vue de face) : + = vers la cible
    if (phase === 'back') lean = smooth(0, opts.reversePivotDeg ?? -3, p)
    else if (phase === 'down') lean = smooth(opts.reversePivotDeg ?? -3, 6, p)
    else if (phase === 'follow' || phase === 'finish') lean = 6

    // En DTL l'inclinaison visible est la flexion avant ; de face, la bascule latérale.
    const spineAngle = dtl ? tilt * ballSign : lean * targetSign
    const shoulder: Hu = {
      x: hip.x + Math.sin(spineAngle * DEG) * U,
      y: hip.y - Math.cos(spineAngle * DEG) * U,
    }

    // --- rotation apparente (écrasement par la perspective) ---
    const turn =
      phase === 'back' ? smooth(1, 0.55, p)
      : phase === 'down' ? smooth(0.55, 0.85, p)
      : phase === 'follow' || phase === 'finish' ? 0.6
      : 1
    const shW = (dtl ? 0.25 : 1) * SHOULDER_W * turn
    const hpW = (dtl ? 0.22 : 1) * HIP_W * (0.6 + 0.4 * turn)

    // --- mains ---
    const handAddress: Hu = { x: hip.x + 0.1 * U * ballSign, y: HIP_Y + 0.22 * U }
    let hands: Hu
    if (phase === 'address') hands = handAddress
    else if (phase === 'back') {
      hands = {
        x: smooth(handAddress.x, hip.x - 0.75 * U * targetSign, p),
        y: smooth(handAddress.y, HIP_Y - 1.5 * U, p),
      }
    } else if (phase === 'down') {
      hands = {
        x: smooth(hip.x - 0.75 * U * targetSign, handAddress.x, p),
        y: smooth(HIP_Y - 1.5 * U, handAddress.y, p),
      }
    } else if (phase === 'follow') {
      hands = {
        x: smooth(handAddress.x, hip.x + 0.8 * U * targetSign, p),
        y: smooth(handAddress.y, HIP_Y - 1.35 * U, p),
      }
    } else {
      hands = { x: hip.x + 0.8 * U * targetSign, y: HIP_Y - 1.35 * U }
    }

    // --- tête ---
    const headMove = phase === 'address' ? 0
      : phase === 'back' ? smooth(0, (opts.headShiftU ?? 0) * U, p)
      : (opts.headShiftU ?? 0) * U
    const nose: Hu = {
      x: shoulder.x - 0.1 * U * targetSign + headMove * targetSign,
      y: shoulder.y - 0.45 * U,
    }

    // --- membres ---
    const leadShoulder: Hu = { x: shoulder.x + (shW / 2) * targetSign, y: shoulder.y }
    const trailShoulder: Hu = { x: shoulder.x - (shW / 2) * targetSign, y: shoulder.y }
    const leadHip: Hu = { x: hip.x + (hpW / 2) * targetSign, y: hip.y }
    const trailHip: Hu = { x: hip.x - (hpW / 2) * targetSign, y: hip.y }

    const leadWrist: Hu = { x: hands.x + 0.03 * U * targetSign, y: hands.y }
    const trailWrist: Hu = { x: hands.x - 0.03 * U * targetSign, y: hands.y }

    // Au sommet, le coude arrière est plié et le bras avant reste tendu :
    // c'est ce contraste qui permet au moteur de déduire la latéralité.
    const leadElbowAngle =
      phase === 'back' ? smooth(172, 168, p)
      : phase === 'follow' ? smooth(170, opts.leadElbowFollowDeg ?? 168, p)
      : phase === 'finish' ? (opts.leadElbowFollowDeg ?? 168)
      : 172
    const trailElbowAngle =
      phase === 'back' ? smooth(170, 92, p)
      : phase === 'down' ? smooth(92, 150, p)
      : phase === 'follow' ? smooth(150, 110, p)
      : phase === 'finish' ? 110
      : 168

    const leadElbow = elbowFor(leadShoulder, leadWrist, leadElbowAngle, -targetSign)
    const trailElbow = elbowFor(trailShoulder, trailWrist, trailElbowAngle, targetSign)

    const leadAnkle: Hu = { x: hip.x + (stanceW / 2) * targetSign, y: 0.96 }
    const trailAnkle: Hu = { x: hip.x - (stanceW / 2) * targetSign, y: 0.96 }
    const leadKnee = elbowFor(leadHip, leadAnkle, kneeAngle, ballSign)
    const trailKnee = elbowFor(trailHip, trailAnkle, kneeAngle, ballSign)

    const foot = (ankle: Hu): { heel: Hu; toe: Hu } => ({
      heel: { x: ankle.x - 0.08 * U * ballSign, y: 0.985 },
      toe: { x: ankle.x + 0.3 * U * ballSign, y: 0.99 },
    })
    const leadFoot = foot(leadAnkle)
    const trailFoot = foot(trailAnkle)

    // --- assemblage ---
    const out: Landmark[] = new Array(LANDMARK_COUNT)
    const put = (idx: number, p2: Hu, visibility = 0.95) => {
      out[idx] = { x: p2.x / aspect, y: p2.y, z: 0, visibility }
    }

    // Droitier : le côté avant est le côté GAUCHE.
    put(LM.NOSE, nose)
    for (let k = 1; k <= 10; k++) put(k, nose, 0.8)
    put(LM.LEFT_SHOULDER, leadShoulder)
    put(LM.RIGHT_SHOULDER, trailShoulder)
    put(LM.LEFT_ELBOW, leadElbow)
    put(LM.RIGHT_ELBOW, trailElbow)
    put(LM.LEFT_WRIST, leadWrist)
    put(LM.RIGHT_WRIST, trailWrist)
    put(LM.LEFT_PINKY, leadWrist, 0.7)
    put(LM.RIGHT_PINKY, trailWrist, 0.7)
    put(LM.LEFT_INDEX, leadWrist, 0.7)
    put(LM.RIGHT_INDEX, trailWrist, 0.7)
    put(LM.LEFT_THUMB, leadWrist, 0.7)
    put(LM.RIGHT_THUMB, trailWrist, 0.7)
    put(LM.LEFT_HIP, leadHip)
    put(LM.RIGHT_HIP, trailHip)
    put(LM.LEFT_KNEE, leadKnee)
    put(LM.RIGHT_KNEE, trailKnee)
    put(LM.LEFT_ANKLE, leadAnkle)
    put(LM.RIGHT_ANKLE, trailAnkle)
    put(LM.LEFT_HEEL, leadFoot.heel)
    put(LM.RIGHT_HEEL, trailFoot.heel)
    put(LM.LEFT_FOOT_INDEX, leadFoot.toe)
    put(LM.RIGHT_FOOT_INDEX, trailFoot.toe)

    frames.push(out)
  }

  return { frames, fps, timestamps, videoWidth: width, videoHeight: height }
}
