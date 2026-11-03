/**
 * Détection de la balle jouée.
 *
 * Un practice est jonché de balles : en chercher une par sa couleur ou sa
 * forme ne distingue pas celle qui est frappée. On exploite donc la seule
 * propriété qui n'appartient qu'à elle — elle est immobile avant l'impact et
 * absente juste après. La différence entre la moyenne des images d'avant et
 * celle d'après la fait ressortir seule.
 *
 * Deux usages, et une limite assumée :
 *  - son départ DATE l'impact, là où la cinématique du corps n'en donne qu'un
 *    proxy ;
 *  - sa position situe la balle par rapport aux appuis ;
 *  - sa trajectoire, en revanche, n'est pas mesurable : à 60 i/s elle
 *    parcourt plus d'un demi-mètre entre deux images et se fond dans le flou.
 *    Vérifié sur vidéo réelle, aucun blob exploitable ne subsiste.
 *
 * Résolution : vérifié sur un swing réel, la balle reste correctement
 * localisée sur des images réduites à 512 px de haut (position à 0,3 % près
 * de celle mesurée en 1080×1920). On réutilise donc le même sous-
 * échantillonnage que l'inférence de pose.
 */

import { EXTRACTION } from '../core/config'
import { LM } from '../core/landmarks'
import type { BallObservation, PoseSequence } from '../core/types'
import { seekTo } from './extract'

interface Gray {
  data: Float32Array
  width: number
  height: number
}

/** Luminance d'une image, dans le repère réduit. */
function toGray(image: ImageData): Gray {
  const { width, height, data } = image
  const out = new Float32Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  }
  return { data: out, width, height }
}

interface Blob {
  cx: number
  cy: number
  area: number
  radius: number
  fill: number
  peak: number
}

/**
 * Composantes connexes du masque, avec leur compacité.
 * Une balle est un petit disque plein : l'aire rapportée au disque
 * circonscrit écarte les traînées de jambes et les ombres allongées.
 */
function findBlobs(diff: Gray, threshold: number, yFrom: number, yTo: number): Blob[] {
  const { width, data } = diff
  const seen = new Uint8Array(width * (yTo - yFrom))
  const blobs: Blob[] = []
  const stack: number[] = []

  for (let y = yFrom; y < yTo; y++) {
    for (let x = 0; x < width; x++) {
      const local = (y - yFrom) * width + x
      if (seen[local]) continue
      if (data[y * width + x] < threshold) continue

      let sumX = 0
      let sumY = 0
      let area = 0
      let peak = 0
      const pixels: number[] = []
      stack.length = 0
      stack.push(x, y)
      seen[local] = 1

      while (stack.length) {
        const py = stack.pop() as number
        const px = stack.pop() as number
        const value = data[py * width + px]
        sumX += px
        sumY += py
        area++
        if (value > peak) peak = value
        pixels.push(px, py)
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx
            const ny = py + dy
            if (nx < 0 || nx >= width || ny < yFrom || ny >= yTo) continue
            const nLocal = (ny - yFrom) * width + nx
            if (seen[nLocal]) continue
            if (data[ny * width + nx] < threshold) continue
            seen[nLocal] = 1
            stack.push(nx, ny)
          }
        }
      }

      if (area < 3) continue
      const cx = sumX / area
      const cy = sumY / area
      let radius = 0
      for (let i = 0; i < pixels.length; i += 2) {
        const d = Math.hypot(pixels[i] - cx, pixels[i + 1] - cy)
        if (d > radius) radius = d
      }
      radius = Math.max(radius, 0.6)
      blobs.push({ cx, cy, area, radius, fill: area / (Math.PI * radius * radius), peak })
    }
  }
  return blobs
}

export interface BallDetectionOptions {
  signal?: AbortSignal
  onProgress?: (ratio: number) => void
  /**
   * Budget réduit : moins d'images moyennées, donc moins de seeks.
   *
   * La détection de balle intervient APRÈS une analyse réussie. Sur un
   * appareil déjà à la limite, lui faire dépenser un tiers de seeks en plus
   * risquerait de faire perdre un résultat déjà acquis.
   */
  lowEnd?: boolean
}

export async function detectBall(
  video: HTMLVideoElement,
  sequence: PoseSequence,
  impactFrame: number,
  options: BallDetectionOptions = {},
): Promise<BallObservation | null> {
  const { timestamps, frames } = sequence
  const n = frames.length
  const impactLandmarks = frames[impactFrame]
  if (!impactLandmarks) return null

  const scale = Math.min(1, EXTRACTION.inferenceMaxHeight / Math.max(1, video.videoHeight))
  const width = Math.max(8, Math.round(video.videoWidth * scale))
  const height = Math.max(8, Math.round(video.videoHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  const grab = async (frameIndex: number): Promise<Gray | null> => {
    if (options.signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError')
    const t = timestamps[frameIndex]
    if (!Number.isFinite(t)) return null
    try {
      await seekTo(video, t)
    } catch {
      return null
    }
    ctx.drawImage(video, 0, 0, width, height)
    return toGray(ctx.getImageData(0, 0, width, height))
  }

  const average = async (indices: number[]): Promise<Gray | null> => {
    let acc: Float32Array | null = null
    let count = 0
    for (const index of indices) {
      const g = await grab(index)
      if (!g) continue
      if (!acc) acc = new Float32Array(g.data.length)
      for (let i = 0; i < acc.length; i++) acc[i] += g.data[i]
      count++
      options.onProgress?.(count / (indices.length * 2))
      await new Promise<void>((r) => window.setTimeout(r, 0))
    }
    if (!acc || count < 3) return null
    for (let i = 0; i < acc.length; i++) acc[i] /= count
    return { data: acc, width, height }
  }

  const range = (from: number, to: number) => {
    const out: number[] = []
    for (let i = Math.max(0, from); i < Math.min(n, to); i++) out.push(i)
    return out
  }
  // Sous-échantillonnage : quelques images suffisent à moyenner un fond
  // immobile, et chaque image coûte un seek.
  const stride = options.lowEnd ? 4 : 2
  const span = options.lowEnd
    ? Math.round(EXTRACTION.ballBeforeFrames * 0.6)
    : EXTRACTION.ballBeforeFrames
  const pick = (list: number[]) => list.filter((_, i) => i % stride === 0)

  const before = await average(pick(range(impactFrame - span, impactFrame - 2)))
  const after = await average(
    pick(range(impactFrame + EXTRACTION.ballAfterSkip, impactFrame + EXTRACTION.ballAfterSkip + span)),
  )
  if (!before || !after) return null

  const diff: Gray = { data: new Float32Array(before.data.length), width, height }
  let maxDiff = 0
  for (let i = 0; i < diff.data.length; i++) {
    const v = Math.abs(before.data[i] - after.data[i])
    diff.data[i] = v
    if (v > maxDiff) maxDiff = v
  }
  if (maxDiff < 16) return null

  // Zone de recherche : du bassin au sol. Au-dessus, c'est le joueur.
  const hipY = ((impactLandmarks[LM.LEFT_HIP].y + impactLandmarks[LM.RIGHT_HIP].y) / 2) * height
  const ankleY = ((impactLandmarks[LM.LEFT_ANKLE].y + impactLandmarks[LM.RIGHT_ANKLE].y) / 2) * height
  const shoulderY =
    ((impactLandmarks[LM.LEFT_SHOULDER].y + impactLandmarks[LM.RIGHT_SHOULDER].y) / 2) * height
  const torsoPx = Math.abs(hipY - shoulderY)
  if (!(torsoPx > 4)) return null
  const yFrom = Math.max(0, Math.round(hipY))
  const yTo = Math.min(height, Math.round(ankleY + 0.08 * height))
  if (yTo - yFrom < 6) return null

  const blobs = findBlobs(diff, Math.max(14, maxDiff * 0.45), yFrom, yTo)
  const candidates = blobs.filter(
    (b) =>
      b.radius > EXTRACTION.ballMinRadiusU * torsoPx &&
      b.radius < EXTRACTION.ballMaxRadiusU * torsoPx &&
      b.fill >= EXTRACTION.ballMinFill,
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.peak - a.peak)
  const ball = candidates[0]

  // Date du départ : corrélation d'une vignette centrée sur la balle avec son
  // état au repos. Elle chute franchement dès que la balle n'est plus là.
  const pad = Math.max(3, Math.round(ball.radius * 3))
  const patchAt = (g: Gray): Float32Array => {
    const out = new Float32Array((pad * 2) * (pad * 2))
    let k = 0
    for (let y = Math.round(ball.cy) - pad; y < Math.round(ball.cy) + pad; y++) {
      for (let x = Math.round(ball.cx) - pad; x < Math.round(ball.cx) + pad; x++) {
        const inside = x >= 0 && x < g.width && y >= 0 && y < g.height
        out[k++] = inside ? g.data[y * g.width + x] : 0
      }
    }
    return out
  }
  const correlate = (a: Float32Array, b: Float32Array): number => {
    let ma = 0
    let mb = 0
    for (let i = 0; i < a.length; i++) {
      ma += a[i]
      mb += b[i]
    }
    ma /= a.length
    mb /= b.length
    let num = 0
    let da = 0
    let db = 0
    for (let i = 0; i < a.length; i++) {
      const x = a[i] - ma
      const y = b[i] - mb
      num += x * y
      da += x * x
      db += y * y
    }
    return num / (Math.sqrt(da * db) + 1e-6)
  }

  const restFrame = Math.max(0, impactFrame - span)
  const rest = await grab(restFrame)
  if (!rest) return null
  const restPatch = patchAt(rest)

  let departureFrame = -1
  for (let f = Math.max(0, impactFrame - 4); f <= Math.min(n - 1, impactFrame + 6); f++) {
    const g = await grab(f)
    if (!g) continue
    if (correlate(patchAt(g), restPatch) < EXTRACTION.ballDepartureCorrelation) {
      departureFrame = f
      break
    }
  }
  if (departureFrame < 0) return null

  // Confiance : netteté du blob, compacité, et franchise du départ.
  const confidence = Math.min(
    0.95,
    0.35 + 0.35 * Math.min(1, ball.peak / Math.max(1, maxDiff)) + 0.3 * Math.min(1, ball.fill / 0.8),
  )

  return {
    x: ball.cx / width,
    y: ball.cy / height,
    radius: ball.radius / height,
    departureFrame,
    confidence,
  }
}
