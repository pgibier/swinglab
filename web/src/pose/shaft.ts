/**
 * Mesure du manche du club.
 *
 * Le manche est une structure fine, rectiligne et contrastée qui part des
 * mains — donc un segment de droite ancré sur un point que la pose donne
 * déjà. On le cherche par détection de contours puis transformée de Hough,
 * en ne gardant que les segments dont une extrémité touche les mains.
 *
 * Portée vérifiée sur une vidéo réelle en 1080×1920 : détection exacte à
 * l'adresse et au sommet, perdue dans les phases rapides par flou de
 * mouvement (84 % des images après filtrage de continuité).
 *
 * Limite assumée : aucune calibration n'est possible. Sur les vignettes
 * 160×160 du corpus de référence, le détecteur trouve une ligne dans 100 %
 * des cas mais l'étendue des angles atteint 233° — il attrape les bords de
 * tapis et le filet. Ces grandeurs sont donc MESURÉES, jamais jugées.
 */

import { EXTRACTION } from '../core/config'
import { LM } from '../core/landmarks'
import type { PoseSequence, ShaftObservation, ShaftSegment } from '../core/types'
import { seekTo } from './extract'

interface Segment {
  length: number
  angle: number
  nearX: number
  nearY: number
  farX: number
  farY: number
}

/** Contours par gradient de Sobel seuillé — suffisant pour une tige nette. */
function edgeMap(gray: Float32Array, width: number, height: number, threshold: number): Uint8Array {
  const out = new Uint8Array(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const gx =
        -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] +
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
      out[i] = Math.hypot(gx, gy) >= threshold ? 1 : 0
    }
  }
  return out
}

/**
 * Cherche le segment le plus long partant des mains, par balayage angulaire.
 *
 * Une transformée de Hough complète serait du gaspillage : on connaît déjà
 * le point d'ancrage, il ne reste qu'une direction à trouver. On parcourt
 * donc les rayons issus des mains et on mesure la continuité des contours
 * le long de chacun.
 */
function bestRay(
  edges: Uint8Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  maxLength: number,
  minLength: number,
): Segment | null {
  let best: Segment | null = null
  const step = 0.6 // degrés
  for (let deg = -180; deg < 180; deg += step) {
    const rad = (deg * Math.PI) / 180
    const dx = Math.cos(rad)
    const dy = -Math.sin(rad)
    let run = 0
    let misses = 0
    let reached = 0
    for (let r = 2; r < maxLength; r++) {
      const x = Math.round(originX + dx * r)
      const y = Math.round(originY + dy * r)
      if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) break
      let hit = 0
      // Tolérance d'un pixel de part et d'autre : une tige fine n'est jamais
      // parfaitement alignée sur la grille.
      for (let o = -1; o <= 1 && !hit; o++) {
        if (edges[(y + o) * width + x] || edges[y * width + x + o]) hit = 1
      }
      if (hit) {
        run++
        misses = 0
        reached = r
      } else if (++misses > 4) {
        break
      }
    }
    // Il faut que le rayon soit couvert de contours, pas seulement long.
    if (reached >= minLength && run / reached > 0.55) {
      if (!best || reached > best.length) {
        best = {
          length: reached,
          angle: deg,
          nearX: originX,
          nearY: originY,
          farX: originX + dx * reached,
          farY: originY + dy * reached,
        }
      }
    }
  }
  return best
}

/** Angle du manche sur une image, en degrés image (0 = vers la droite). */
async function shaftAt(
  video: HTMLVideoElement,
  sequence: PoseSequence,
  frameIndex: number,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): Promise<Segment | null> {
  const lms = sequence.frames[frameIndex]
  if (!lms) return null
  const t = sequence.timestamps[frameIndex]
  if (!Number.isFinite(t)) return null
  try {
    await seekTo(video, t)
  } catch {
    return null
  }
  const { width, height } = canvas
  ctx.drawImage(video, 0, 0, width, height)
  const image = ctx.getImageData(0, 0, width, height).data
  const gray = new Float32Array(width * height)
  for (let i = 0, p = 0; i < image.length; i += 4, p++) {
    gray[p] = 0.299 * image[i] + 0.587 * image[i + 1] + 0.114 * image[i + 2]
  }

  const handsX = ((lms[LM.LEFT_WRIST].x + lms[LM.RIGHT_WRIST].x) / 2) * width
  const handsY = ((lms[LM.LEFT_WRIST].y + lms[LM.RIGHT_WRIST].y) / 2) * height
  const torso = Math.hypot(
    ((lms[LM.LEFT_SHOULDER].x + lms[LM.RIGHT_SHOULDER].x) / 2 -
      (lms[LM.LEFT_HIP].x + lms[LM.RIGHT_HIP].x) / 2) * width,
    ((lms[LM.LEFT_SHOULDER].y + lms[LM.RIGHT_SHOULDER].y) / 2 -
      (lms[LM.LEFT_HIP].y + lms[LM.RIGHT_HIP].y) / 2) * height,
  )
  if (!(torso > 8)) return null

  const edges = edgeMap(gray, width, height, EXTRACTION.shaftEdgeThreshold)
  return bestRay(
    edges,
    width,
    height,
    handsX,
    handsY,
    Math.round(torso * EXTRACTION.shaftMaxLengthU),
    Math.round(torso * EXTRACTION.shaftMinLengthU),
  )
}

/**
 * Mesure l'angle du manche à l'adresse et au sommet.
 *
 * Chaque mesure est reprise sur plusieurs images voisines : un angle retenu
 * doit être stable, sinon c'est une ligne du décor qui a été attrapée.
 */
export async function measureShaft(
  video: HTMLVideoElement,
  sequence: PoseSequence,
  frames: { address: number; top: number },
  options: { signal?: AbortSignal } = {},
): Promise<ShaftObservation | null> {
  const scale = Math.min(1, EXTRACTION.inferenceMaxHeight / Math.max(1, video.videoHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(8, Math.round(video.videoWidth * scale))
  canvas.height = Math.max(8, Math.round(video.videoHeight * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const stable = async (center: number): Promise<{ segment: ShaftSegment; spread: number } | null> => {
    const found: Segment[] = []
    for (const offset of [-2, 0, 2]) {
      if (options.signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError')
      const index = center + offset
      if (index < 0 || index >= sequence.frames.length) continue
      const seg = await shaftAt(video, sequence, index, canvas, ctx)
      if (seg) found.push(seg)
      await new Promise<void>((r) => window.setTimeout(r, 0))
    }
    if (found.length < 2) return null
    const angles = found.map((f) => f.angle)
    const sorted = [...angles].sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]
    const spread = Math.max(...angles.map((a) => Math.abs(((a - median + 180) % 360) - 180)))
    // Un angle instable d'une image à l'autre trahit une ligne du décor.
    if (spread > EXTRACTION.shaftMaxSpreadDeg) return null
    const pick = found.reduce((b, f) =>
      Math.abs(f.angle - median) < Math.abs(b.angle - median) ? f : b,
    )
    return {
      spread,
      segment: {
        x1: pick.nearX / canvas.width,
        y1: pick.nearY / canvas.height,
        x2: pick.farX / canvas.width,
        y2: pick.farY / canvas.height,
        angle: Math.round(pick.angle * 10) / 10,
      },
    }
  }

  const address = await stable(frames.address)
  const top = await stable(frames.top)
  if (!address && !top) return null

  // Confiance : d'autant plus haute que les angles sont stables d'une image
  // à l'autre, et que les deux repères ont été trouvés.
  const spreads = [address?.spread, top?.spread].filter((v): v is number => v !== undefined)
  const stability = spreads.length
    ? 1 - Math.min(1, Math.max(...spreads) / EXTRACTION.shaftMaxSpreadDeg)
    : 0
  const confidence = Math.min(0.9, 0.35 + 0.35 * stability + (address && top ? 0.2 : 0))

  return {
    address: address?.segment ?? null,
    top: top?.segment ?? null,
    confidence,
  }
}
