/**
 * Journal de progression survivant à un plantage d'onglet.
 *
 * Quand Safari mobile tue la page faute de mémoire, il ne laisse aucune
 * trace : ni exception, ni message, ni console. Impossible de savoir à quelle
 * étape ça s'est produit — donc impossible de corriger autrement qu'à
 * l'aveugle.
 *
 * On écrit donc l'étape en cours dans le stockage local au fil de l'analyse.
 * Si la page revient et qu'une étape est encore marquée « en cours », c'est
 * que le passage précédent est mort là. L'information est affichée à
 * l'utilisateur, qui peut la rapporter.
 */

export interface ProgressMark {
  stage: string
  detail: string
  /** Horodatage du dernier signe de vie. */
  at: number
  /** Contexte utile au diagnostic. */
  device: {
    ua: string
    memoryGb?: number
    cores?: number
    screen: string
  }
}

const KEY = 'swinglab.progress'

function device(): ProgressMark['device'] {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return {
    ua: navigator.userAgent.slice(0, 180),
    memoryGb: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    screen: `${window.screen.width}×${window.screen.height}@${window.devicePixelRatio}`,
  }
}

/** Note l'étape en cours. Appelé souvent : volontairement bon marché. */
export function mark(stage: string, detail = ''): void {
  try {
    const payload: ProgressMark = { stage, detail, at: Date.now(), device: device() }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    // Stockage indisponible : le diagnostic est perdu, pas l'analyse.
  }
}

/** Efface la marque : l'analyse est allée au bout, ou a échoué proprement. */
export function clearMark(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Sans importance.
  }
}

/**
 * Marque laissée par un passage qui ne s'est pas terminé.
 * Lue une seule fois au démarrage, puis effacée.
 */
export function takePendingCrash(): ProgressMark | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    localStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as ProgressMark
    if (typeof parsed?.stage !== 'string' || typeof parsed?.at !== 'number') return null
    // Une marque de plus de 12 h n'apprend plus rien d'utile.
    if (Date.now() - parsed.at > 12 * 3600 * 1000) return null
    return parsed
  } catch {
    return null
  }
}

/** Résumé lisible, que l'utilisateur peut recopier tel quel. */
export function describeCrash(m: ProgressMark): string {
  const parts = [`étape « ${m.stage} »`]
  if (m.detail) parts.push(m.detail)
  parts.push(`${m.device.screen}`)
  if (m.device.memoryGb) parts.push(`${m.device.memoryGb} Go`)
  if (m.device.cores) parts.push(`${m.device.cores} cœurs`)
  return parts.join(' · ')
}
