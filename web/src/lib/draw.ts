/**
 * Rendu de l'overlay sur le canvas.
 *
 * L'overlay n'est JAMAIS gravé dans la vidéo : on dessine par-dessus
 * l'élément <video> d'origine. Conséquences : aucun ré-encodage (donc analyse
 * bien plus rapide), overlays activables à la volée, et scrub image par image
 * fluide.
 *
 * Attention : on travaille ici sur les coordonnées MediaPipe BRUTES (x et y
 * normalisés indépendamment), car elles correspondent exactement au cadre
 * affiché. La correction d'anisotropie du moteur ne s'applique qu'aux calculs
 * d'angles, pas à l'affichage.
 */

import { LM, SKELETON_EDGES } from '../core/landmarks'
import { SMOOTHING } from '../core/config'
import type { BallObservation, FaultResult, Landmark } from '../core/types'

const JOINT_RADIUS = 4.5
const BONE_WIDTH = 3

interface Px { x: number; y: number }

const toPx = (l: Landmark, w: number, h: number): Px => ({ x: l.x * w, y: l.y * h })

const visible = (l: Landmark | undefined): boolean =>
  !!l && l.visibility >= SMOOTHING.minVisibility

const midPx = (a: Landmark, b: Landmark, w: number, h: number): Px => ({
  x: ((a.x + b.x) / 2) * w,
  y: ((a.y + b.y) / 2) * h,
})

/** Squelette : os puis articulations, pour que les points restent lisibles. */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  frame: Landmark[],
  w: number,
  h: number,
  color = 'rgba(61, 220, 151, 0.95)',
): void {
  ctx.lineCap = 'round'
  ctx.lineWidth = BONE_WIDTH
  for (const [a, b] of SKELETON_EDGES) {
    const la = frame[a]
    const lb = frame[b]
    if (!visible(la) || !visible(lb)) continue
    const pa = toPx(la, w, h)
    const pb = toPx(lb, w, h)
    // Halo sombre : garde le squelette lisible sur un fond clair (gazon, ciel).
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.lineWidth = BONE_WIDTH + 2.5
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
    ctx.strokeStyle = color
    ctx.lineWidth = BONE_WIDTH
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
  }

  for (let i = 0; i < frame.length; i++) {
    const l = frame[i]
    if (!visible(l)) continue
    // Les points du visage ne servent qu'au nez : on n'encombre pas l'image.
    if (i >= 1 && i <= 10) continue
    const p = toPx(l, w, h)
    ctx.beginPath()
    ctx.arc(p.x, p.y, JOINT_RADIUS, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.stroke()
  }
}

function dashedVLine(ctx: CanvasRenderingContext2D, x: number, h: number, color: string): void {
  ctx.save()
  ctx.setLineDash([7, 6])
  ctx.lineWidth = 2
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, h)
  ctx.stroke()
  ctx.restore()
}

function doubleArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  color: string,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(x1, y)
  ctx.lineTo(x2, y)
  ctx.stroke()
  const dir = Math.sign(x2 - x1) || 1
  for (const [tip, d] of [[x2, dir], [x1, -dir]] as const) {
    ctx.beginPath()
    ctx.moveTo(tip, y)
    ctx.lineTo(tip - d * 10, y - 6)
    ctx.lineTo(tip - d * 10, y + 6)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

function marker(ctx: CanvasRenderingContext2D, p: Px, color: string, radius = 11): void {
  ctx.save()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Segment épaissi, pour désigner un membre en cause. */
function emphasize(
  ctx: CanvasRenderingContext2D,
  a: Landmark,
  b: Landmark,
  w: number,
  h: number,
  color: string,
): void {
  if (!visible(a) || !visible(b)) return
  const pa = toPx(a, w, h)
  const pb = toPx(b, w, h)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = BONE_WIDTH + 4
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(pa.x, pa.y)
  ctx.lineTo(pb.x, pb.y)
  ctx.stroke()
  ctx.restore()
}

/** Ligne du rachis comparée à la verticale, avec repère d'adresse. */
function drawSpine(
  ctx: CanvasRenderingContext2D,
  frame: Landmark[],
  w: number,
  h: number,
  color: string,
): void {
  const lh = frame[LM.LEFT_HIP]
  const rh = frame[LM.RIGHT_HIP]
  const ls = frame[LM.LEFT_SHOULDER]
  const rs = frame[LM.RIGHT_SHOULDER]
  if (!visible(lh) || !visible(rh) || !visible(ls) || !visible(rs)) return
  const hip = midPx(lh, rh, w, h)
  const sh = midPx(ls, rs, w, h)
  ctx.save()
  ctx.lineWidth = 3.5
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(hip.x, hip.y)
  ctx.lineTo(sh.x, sh.y)
  ctx.stroke()
  // Verticale de référence depuis les hanches.
  ctx.setLineDash([5, 5])
  ctx.lineWidth = 1.8
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.moveTo(hip.x, hip.y)
  ctx.lineTo(hip.x, sh.y)
  ctx.stroke()
  ctx.restore()
}

export interface AnnotationInput {
  ctx: CanvasRenderingContext2D
  /** Frame courante (coordonnées brutes MediaPipe). */
  frame: Landmark[]
  /** Frame de référence du défaut (souvent l'adresse). */
  reference: Landmark[] | null
  width: number
  height: number
  color: string
}

/**
 * Annotations spécifiques à chaque défaut : c'est ce qui transforme un
 * squelette en explication visuelle. Un défaut sans annotation dédiée
 * n'affiche que le squelette.
 */
const ANNOTATIONS: Record<string, (a: AnnotationInput) => void> = {
  sway: hipDisplacement,
  slide: hipDisplacement,
  early_extension: hipDisplacement,
  head_movement: ({ ctx, frame, reference, width, height, color }) => {
    const nose = frame[LM.NOSE]
    if (!visible(nose)) return
    if (reference && visible(reference[LM.NOSE])) {
      marker(ctx, toPx(reference[LM.NOSE], width, height), 'rgba(255,255,255,0.65)', 13)
    }
    marker(ctx, toPx(nose, width, height), color, 13)
    if (reference && visible(reference[LM.NOSE])) {
      const a = toPx(reference[LM.NOSE], width, height)
      const b = toPx(nose, width, height)
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      ctx.restore()
    }
  },
  setup_spine_tilt: ({ ctx, frame, width, height, color }) => drawSpine(ctx, frame, width, height, color),
  loss_of_posture: ({ ctx, frame, reference, width, height, color }) => {
    if (reference) drawSpine(ctx, reference, width, height, 'rgba(255,255,255,0.5)')
    drawSpine(ctx, frame, width, height, color)
  },
  reverse_pivot: ({ ctx, frame, width, height, color }) => drawSpine(ctx, frame, width, height, color),
  setup_knee_flex: ({ ctx, frame, width, height, color }) => {
    emphasize(ctx, frame[LM.LEFT_HIP], frame[LM.LEFT_KNEE], width, height, color)
    emphasize(ctx, frame[LM.LEFT_KNEE], frame[LM.LEFT_ANKLE], width, height, color)
    emphasize(ctx, frame[LM.RIGHT_HIP], frame[LM.RIGHT_KNEE], width, height, color)
    emphasize(ctx, frame[LM.RIGHT_KNEE], frame[LM.RIGHT_ANKLE], width, height, color)
  },
  setup_stance_width: ({ ctx, frame, width, height, color }) => {
    const la = frame[LM.LEFT_ANKLE]
    const ra = frame[LM.RIGHT_ANKLE]
    const ls = frame[LM.LEFT_SHOULDER]
    const rs = frame[LM.RIGHT_SHOULDER]
    if (visible(la) && visible(ra)) {
      const a = toPx(la, width, height)
      const b = toPx(ra, width, height)
      doubleArrow(ctx, a.x, b.x, Math.max(a.y, b.y) + 18, color)
    }
    if (visible(ls) && visible(rs)) {
      const a = toPx(ls, width, height)
      const b = toPx(rs, width, height)
      doubleArrow(ctx, a.x, b.x, Math.min(a.y, b.y) - 18, 'rgba(255,255,255,0.7)')
    }
  },
  chicken_wing: ({ ctx, frame, width, height, color }) => {
    // Les deux bras sont mis en évidence : la comparaison saute aux yeux.
    emphasize(ctx, frame[LM.LEFT_SHOULDER], frame[LM.LEFT_ELBOW], width, height, color)
    emphasize(ctx, frame[LM.LEFT_ELBOW], frame[LM.LEFT_WRIST], width, height, color)
    emphasize(ctx, frame[LM.RIGHT_SHOULDER], frame[LM.RIGHT_ELBOW], width, height, color)
    emphasize(ctx, frame[LM.RIGHT_ELBOW], frame[LM.RIGHT_WRIST], width, height, color)
  },
}

function hipDisplacement({ ctx, frame, reference, width, height, color }: AnnotationInput): void {
  const lh = frame[LM.LEFT_HIP]
  const rh = frame[LM.RIGHT_HIP]
  if (!visible(lh) || !visible(rh)) return
  const hip = midPx(lh, rh, width, height)
  if (reference && visible(reference[LM.LEFT_HIP]) && visible(reference[LM.RIGHT_HIP])) {
    const ref = midPx(reference[LM.LEFT_HIP], reference[LM.RIGHT_HIP], width, height)
    dashedVLine(ctx, ref.x, height, 'rgba(255,255,255,0.6)')
    if (Math.abs(hip.x - ref.x) > 3) doubleArrow(ctx, ref.x, hip.x, hip.y, color)
  }
  dashedVLine(ctx, hip.x, height, color)
  marker(ctx, hip, color, 9)
}

/** Repère de la balle, avec un rayon minimal pour rester visible. */
function drawBall(ctx: CanvasRenderingContext2D, ball: BallObservation, w: number, h: number): void {
  const cx = ball.x * w
  const cy = ball.y * h
  const r = Math.max(7, ball.radius * h * 1.6)
  ctx.save()
  ctx.lineWidth = 2.5
  ctx.strokeStyle = 'rgba(255, 210, 90, 0.95)'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, cy, 1.6, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255, 210, 90, 0.95)'
  ctx.fill()
  ctx.restore()
}

export interface OverlayRequest {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  frame: Landmark[] | null
  reference: Landmark[] | null
  showSkeleton: boolean
  /** Défaut sélectionné, dont l'annotation dédiée est tracée. */
  fault: FaultResult | null
  faultColor: string
  /** Balle repérée, dessinée en repère permanent. */
  ball?: BallObservation | null
}

export function renderOverlay(req: OverlayRequest): void {
  const { ctx, width, height, frame, reference, showSkeleton, fault, faultColor, ball } = req
  ctx.clearRect(0, 0, width, height)
  if (ball && showSkeleton) drawBall(ctx, ball, width, height)
  if (!frame) return
  if (showSkeleton) drawSkeleton(ctx, frame, width, height)
  if (fault) {
    const draw = ANNOTATIONS[fault.id]
    if (draw) draw({ ctx, frame, reference, width, height, color: faultColor })
  }
}
