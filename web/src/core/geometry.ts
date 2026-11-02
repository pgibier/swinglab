/** Primitives géométriques 2D. Aucune dépendance. */

export interface Pt { x: number; y: number }

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })

/**
 * Angle en degrés au sommet `b` du triangle a-b-c.
 * Retourne NaN si deux points sont confondus.
 */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = sub(a, b)
  const v2 = sub(c, b)
  const n1 = Math.hypot(v1.x, v1.y)
  const n2 = Math.hypot(v2.x, v2.y)
  if (n1 < 1e-9 || n2 < 1e-9) return NaN
  const cos = (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI
}

/**
 * Angle en degrés du segment `from`→`to` par rapport à la verticale image.
 * 0° = parfaitement vertical. Toujours positif (magnitude).
 *
 * Attention : en coordonnées image, y croît vers le bas.
 */
export function angleFromVertical(from: Pt, to: Pt): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.hypot(dx, dy) < 1e-9) return NaN
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI
}

/**
 * Angle signé du segment `from`→`to` par rapport à la verticale, orienté
 * par `positiveDir` (+1 : un `dx` positif donne un angle positif).
 */
export function signedAngleFromVertical(from: Pt, to: Pt, positiveDir: number): number {
  const dx = (to.x - from.x) * (positiveDir >= 0 ? 1 : -1)
  const dy = to.y - from.y
  if (Math.hypot(dx, dy) < 1e-9) return NaN
  return (Math.atan2(dx, Math.abs(dy)) * 180) / Math.PI
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Moyenne en ignorant les NaN. Retourne NaN si tout est NaN.
 * Accepte aussi bien un tableau qu'un Float64Array.
 */
export function meanFinite(values: ArrayLike<number>): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v)) {
      sum += v
      n++
    }
  }
  return n === 0 ? NaN : sum / n
}

/** Écart-type en ignorant les NaN. */
export function stdFinite(values: ArrayLike<number>): number {
  const m = meanFinite(values)
  if (!Number.isFinite(m)) return NaN
  let sum = 0
  let n = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (Number.isFinite(v)) {
      sum += (v - m) ** 2
      n++
    }
  }
  return n < 2 ? 0 : Math.sqrt(sum / (n - 1))
}

/**
 * Médiane des valeurs finies sur [lo, hi]. NaN si aucune.
 * Préférée à la moyenne pour résumer une fenêtre : un point clé aberrant
 * isolé ne déplace pas une médiane.
 */
export function medianOver(values: ArrayLike<number>, lo: number, hi: number): number {
  const picked: number[] = []
  for (let i = Math.max(0, lo); i <= Math.min(values.length - 1, hi); i++) {
    const v = values[i]
    if (Number.isFinite(v)) picked.push(v)
  }
  if (picked.length === 0) return NaN
  picked.sort((a, b) => a - b)
  const mid = picked.length >> 1
  return picked.length % 2 ? picked[mid] : (picked[mid - 1] + picked[mid]) / 2
}

/** Index de la valeur finie minimale sur [lo, hi]. -1 si aucune. */
export function argMin(values: ArrayLike<number>, lo = 0, hi = values.length - 1): number {
  let best = -1
  let bestV = Infinity
  for (let i = Math.max(0, lo); i <= Math.min(values.length - 1, hi); i++) {
    const v = values[i]
    if (Number.isFinite(v) && v < bestV) {
      bestV = v
      best = i
    }
  }
  return best
}

/** Index de la valeur finie maximale sur [lo, hi]. -1 si aucune. */
export function argMax(values: ArrayLike<number>, lo = 0, hi = values.length - 1): number {
  let best = -1
  let bestV = -Infinity
  for (let i = Math.max(0, lo); i <= Math.min(values.length - 1, hi); i++) {
    const v = values[i]
    if (Number.isFinite(v) && v > bestV) {
      bestV = v
      best = i
    }
  }
  return best
}
