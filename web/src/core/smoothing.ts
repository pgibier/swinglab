/**
 * Nettoyage temporel de la séquence de pose.
 *
 * Trois problèmes à régler avant toute mesure :
 *  1. Les coordonnées MediaPipe sont normalisées indépendamment sur x et y.
 *     Sur une vidéo 16:9, un angle calculé directement dessus est FAUX.
 *     → on remet x à l'échelle de y (unité commune : la hauteur d'image).
 *  2. Un point clé mal vu produit une valeur aberrante isolée, qui suffit à
 *     ruiner une métrique (typiquement à l'impact, où tout est flou).
 *     → gating par visibilité, puis interpolation des trous courts.
 *  3. Les dérivées (vitesse des mains) sont inexploitables sur du signal brut.
 *     → filtre Savitzky-Golay, qui lisse sans écraser les pics — contrairement
 *       à une moyenne glissante, qui déplacerait le pic d'impact.
 */

import { SMOOTHING } from './config'
import { LANDMARK_COUNT } from './landmarks'
import type { Pt } from './geometry'
import type { PoseSequence } from './types'

export interface CleanedPose {
  /** Nombre de frames. */
  n: number
  fps: number
  /** x[lm][frame], à l'échelle de la hauteur d'image (anisotropie corrigée). */
  x: Float64Array[]
  /** y[lm][frame], 0 = haut de l'image. */
  y: Float64Array[]
  /** visibility[lm][frame] d'origine. */
  vis: Float64Array[]
  /** true si la frame contenait une pose. */
  present: boolean[]
  videoWidth: number
  videoHeight: number
  /** Facteur appliqué à x pour corriger l'anisotropie. */
  aspect: number
}

/** Accès à un point clé d'une frame. NaN si indisponible. */
export const pt = (c: CleanedPose, lm: number, f: number): Pt => ({ x: c.x[lm][f], y: c.y[lm][f] })

/** Vrai si tous les points demandés sont exploitables sur cette frame. */
export function hasAll(c: CleanedPose, f: number, lms: readonly number[]): boolean {
  if (f < 0 || f >= c.n) return false
  for (const lm of lms) {
    if (!Number.isFinite(c.x[lm][f]) || !Number.isFinite(c.y[lm][f])) return false
  }
  return true
}

/**
 * Coefficients du filtre Savitzky-Golay pour le point central.
 * Résolution par moindres carrés : a = (AᵀA)⁻¹Aᵀx, on ne garde que a₀.
 */
export function savgolCoeffs(window: number, order: number): Float64Array {
  const h = (window - 1) / 2
  const n = order + 1
  // A[j][p] = (j - h)^p
  const A: number[][] = []
  for (let j = -h; j <= h; j++) {
    const row: number[] = []
    for (let p = 0; p < n; p++) row.push(j ** p)
    A.push(row)
  }
  // AᵀA augmentée de l'identité, puis Gauss-Jordan → inverse
  const M: number[][] = []
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(2 * n).fill(0)
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let r = 0; r < window; r++) s += A[r][i] * A[r][j]
      row[j] = s
    }
    row[n + i] = 1
    M.push(row)
  }
  for (let col = 0; col < n; col++) {
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error('savgol: matrice singulière')
    ;[M[col], M[piv]] = [M[piv], M[col]]
    const d = M[col][col]
    for (let j = 0; j < 2 * n; j++) M[col][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = M[r][col]
      if (factor === 0) continue
      for (let j = 0; j < 2 * n; j++) M[r][j] -= factor * M[col][j]
    }
  }
  // c[j] = Σ_p inv[0][p] · A[j][p]
  const c = new Float64Array(window)
  for (let j = 0; j < window; j++) {
    let s = 0
    for (let p = 0; p < n; p++) s += M[0][n + p] * A[j][p]
    c[j] = s
  }
  return c
}

/** Comble les trous de NaN d'au plus `maxGap` frames par interpolation linéaire. */
export function interpolateGaps(v: Float64Array, maxGap: number): Float64Array {
  const out = Float64Array.from(v)
  const n = out.length
  let i = 0
  while (i < n) {
    if (Number.isFinite(out[i])) {
      i++
      continue
    }
    const start = i
    while (i < n && !Number.isFinite(out[i])) i++
    const end = i // première frame finie après le trou
    const gap = end - start
    const before = start - 1
    if (gap <= maxGap && before >= 0 && end < n) {
      const a = out[before]
      const b = out[end]
      for (let k = 0; k < gap; k++) out[start + k] = a + ((b - a) * (k + 1)) / (gap + 1)
    }
  }
  return out
}

/** Filtre Savitzky-Golay avec bords traités par symétrie (mirror padding). */
export function savgol(v: Float64Array, window: number, order: number): Float64Array {
  const n = v.length
  if (n === 0) return new Float64Array(0)
  const w = Math.min(window % 2 === 1 ? window : window + 1, n % 2 === 1 ? n : n - 1)
  if (w < 3 || w <= order) return Float64Array.from(v)
  const c = savgolCoeffs(w, order)
  const h = (w - 1) / 2
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let wsum = 0
    for (let k = -h; k <= h; k++) {
      // symétrie aux bords
      let idx = i + k
      if (idx < 0) idx = -idx
      if (idx >= n) idx = 2 * (n - 1) - idx
      const val = v[idx]
      if (!Number.isFinite(val)) continue
      s += c[k + h] * val
      wsum += c[k + h]
    }
    out[i] = wsum > 1e-9 ? s / wsum : v[i]
  }
  return out
}

/** Dérivée par différences centrées, en unités/seconde. */
export function derivative(v: Float64Array, fps: number): Float64Array {
  const n = v.length
  const out = new Float64Array(n).fill(NaN)
  if (n < 3) return out
  for (let i = 1; i < n - 1; i++) {
    const a = v[i - 1]
    const b = v[i + 1]
    if (Number.isFinite(a) && Number.isFinite(b)) out[i] = ((b - a) * fps) / 2
  }
  out[0] = out[1]
  out[n - 1] = out[n - 2]
  return out
}

/**
 * Convertit une séquence brute MediaPipe en séquence exploitable :
 * correction d'anisotropie, gating par visibilité, interpolation, lissage.
 */
export function cleanSequence(seq: PoseSequence): CleanedPose {
  const n = seq.frames.length
  const aspect = seq.videoHeight > 0 ? seq.videoWidth / seq.videoHeight : 1
  const window = n >= 24 ? SMOOTHING.savgolWindow : SMOOTHING.savgolWindowShort

  const x: Float64Array[] = []
  const y: Float64Array[] = []
  const vis: Float64Array[] = []
  const present = new Array<boolean>(n).fill(false)

  for (let f = 0; f < n; f++) present[f] = seq.frames[f] !== null

  for (let lm = 0; lm < LANDMARK_COUNT; lm++) {
    const xs = new Float64Array(n).fill(NaN)
    const ys = new Float64Array(n).fill(NaN)
    const vs = new Float64Array(n).fill(0)
    for (let f = 0; f < n; f++) {
      const frame = seq.frames[f]
      if (!frame || !frame[lm]) continue
      const l = frame[lm]
      vs[f] = l.visibility
      if (l.visibility < SMOOTHING.minVisibility) continue
      xs[f] = l.x * aspect
      ys[f] = l.y
    }
    x.push(savgol(interpolateGaps(xs, SMOOTHING.maxGapFill), window, SMOOTHING.savgolOrder))
    y.push(savgol(interpolateGaps(ys, SMOOTHING.maxGapFill), window, SMOOTHING.savgolOrder))
    vis.push(vs)
  }

  return {
    n,
    fps: seq.fps,
    x,
    y,
    vis,
    present,
    videoWidth: seq.videoWidth,
    videoHeight: seq.videoHeight,
    aspect,
  }
}
