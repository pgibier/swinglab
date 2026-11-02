/**
 * Profil de référence : situer une mesure par rapport à un corpus de swings.
 *
 * Pourquoi des centiles plutôt qu'un seuil : « ton sway est à 28 %, la
 * référence est à 3 % en médiane et 5 % au 90e centile » se comprend sans
 * connaître la biomécanique, et c'est vérifiable — contrairement à un seuil
 * posé a priori.
 *
 * Volontairement sans direction de « mieux » : certaines métriques sont
 * mauvaises quand elles montent (sway), d'autres quand elles descendent
 * (angle du coude avant), d'autres encore ont une zone saine au milieu
 * (inclinaison du buste, tempo, écartement des pieds). On affiche donc la
 * BANDE de référence et où l'utilisateur se place dedans, sans prétendre
 * qu'un côté est systématiquement meilleur.
 */

import type { ViewType } from './types'

export interface MetricStats {
  /** Nombre de swings ayant contribué à cette métrique. */
  n: number
  mean: number
  sd: number
  /** Centiles indexés par leur rang en texte ('5', '10', '25', '50', '75', '90', '95'). */
  percentiles: Record<string, number>
}

export interface ReferenceProfile {
  /** Nom du corpus, affiché tel quel à l'utilisateur. */
  label: string
  /**
   * Provenance et limites du corpus, affichées dans le rapport.
   * Un utilisateur doit pouvoir savoir à quoi il est comparé, et ce que la
   * comparaison ne couvre pas.
   */
  note?: string
  clipsAnalysed: number
  clipsKept: number
  views: Partial<Record<ViewType, Record<string, MetricStats>>>
}

/**
 * Valide un profil chargé depuis le réseau.
 *
 * Nécessaire : un hébergeur statique avec repli SPA renvoie `index.html` en
 * HTTP 200 pour un fichier absent (même piège que pour le modèle de pose).
 * Un profil mal formé ne doit jamais faire tomber le rapport.
 */
export function isReferenceProfile(value: unknown): value is ReferenceProfile {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Partial<ReferenceProfile>
  if (typeof p.label !== 'string' || typeof p.views !== 'object' || p.views === null) return false
  for (const metrics of Object.values(p.views)) {
    if (typeof metrics !== 'object' || metrics === null) return false
    for (const stats of Object.values(metrics)) {
      const s = stats as Partial<MetricStats>
      if (typeof s.n !== 'number' || typeof s.percentiles !== 'object' || s.percentiles === null) {
        return false
      }
      if (typeof s.percentiles['50'] !== 'number') return false
    }
  }
  return true
}

export function statsFor(
  profile: ReferenceProfile | null,
  view: ViewType,
  metricId: string,
): MetricStats | null {
  if (!profile) return null
  const metrics = profile.views[view]
  if (!metrics) return null
  return metrics[metricId] ?? null
}

/** Les rangs de centiles disponibles, triés. */
function ranks(stats: MetricStats): Array<[number, number]> {
  return Object.entries(stats.percentiles)
    .map(([rank, value]) => [Number(rank), value] as [number, number])
    .filter(([rank, value]) => Number.isFinite(rank) && Number.isFinite(value))
    .sort((a, b) => a[0] - b[0])
}

export interface PercentilePosition {
  /** Rang du centile, interpolé entre les centiles connus. */
  rank: number
  /**
   * Renseigné quand la valeur sort de la plage mesurée : on connaît seulement
   * le dernier rang disponible, pas le vrai centile. Dire « autour du 95e »
   * d'une valeur cinq fois supérieure au 95e centile serait faux — c'est
   * « au-delà du 95e » qu'il faut annoncer.
   */
  bounded: 'below' | 'above' | null
}

/**
 * Centile approximatif d'une valeur, par interpolation linéaire entre les
 * centiles connus. Hors bornes, renvoie le rang extrême en signalant le
 * débordement : quelques dizaines de swings ne permettent pas de distinguer
 * un 97e d'un 99,9e centile.
 */
export function percentileOf(stats: MetricStats, value: number): PercentilePosition | null {
  const points = ranks(stats)
  if (points.length < 2 || !Number.isFinite(value)) return null
  // Les valeurs doivent croître avec le rang pour que l'interpolation ait un sens.
  for (let i = 1; i < points.length; i++) {
    if (points[i][1] < points[i - 1][1]) return null
  }
  if (value < points[0][1]) return { rank: points[0][0], bounded: 'below' }
  const last = points[points.length - 1]
  if (value > last[1]) return { rank: last[0], bounded: 'above' }
  for (let i = 1; i < points.length; i++) {
    const [r0, v0] = points[i - 1]
    const [r1, v1] = points[i]
    if (value <= v1) {
      if (v1 === v0) return { rank: r1, bounded: null }
      return { rank: r0 + ((value - v0) / (v1 - v0)) * (r1 - r0), bounded: null }
    }
  }
  return { rank: last[0], bounded: null }
}

export interface BandLayout {
  /** Bornes de l'axe affiché. */
  min: number
  max: number
  /** Position [0..1] des repères sur l'axe. */
  low: number
  median: number
  high: number
  /** Position [0..1] de la valeur mesurée, bornée à l'axe. */
  value: number
  /** Vrai si la valeur sort de l'axe (flèche de débordement à afficher). */
  clamped: boolean
}

/**
 * Prépare l'axe d'affichage d'une bande de référence.
 * L'axe couvre la bande p10–p90 ET la valeur de l'utilisateur, avec 15 % de
 * marge : la comparaison reste lisible même quand la mesure est très loin.
 */
export function bandLayout(stats: MetricStats, value: number): BandLayout | null {
  const p = stats.percentiles
  const low = p['10'] ?? p['5'] ?? p['25']
  const median = p['50']
  const high = p['90'] ?? p['95'] ?? p['75']
  if (![low, median, high].every((v) => typeof v === 'number' && Number.isFinite(v))) return null
  if (!Number.isFinite(value)) return null

  const lo = Math.min(low, value)
  const hi = Math.max(high, value)
  const span = hi - lo || Math.max(Math.abs(median), 1) * 0.2
  const min = lo - span * 0.15
  const max = hi + span * 0.15
  const at = (v: number) => (max === min ? 0.5 : (v - min) / (max - min))

  return {
    min,
    max,
    low: at(low),
    median: at(median),
    high: at(high),
    value: Math.min(1, Math.max(0, at(value))),
    clamped: value < min || value > max,
  }
}
