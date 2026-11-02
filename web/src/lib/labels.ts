/** Libellés français du moteur. Centralisés pour rester cohérents dans l'UI. */

import type { Severity, SwingEventName, ViewType } from '../core/types'

export const EVENT_LABELS: Record<SwingEventName, string> = {
  address: 'Adresse',
  toeUp: 'Club à l’horizontale',
  midBackswing: 'Mi-montée',
  top: 'Sommet',
  midDownswing: 'Mi-descente',
  impact: 'Impact',
  midFollowThrough: 'Mi-finish',
  finish: 'Finish',
}

/** Version courte pour la bande de phases sur petit écran. */
export const EVENT_LABELS_SHORT: Record<SwingEventName, string> = {
  address: 'Adresse',
  toeUp: 'Horiz.',
  midBackswing: 'Mi-mont.',
  top: 'Sommet',
  midDownswing: 'Mi-desc.',
  impact: 'Impact',
  midFollowThrough: 'Mi-fin.',
  finish: 'Finish',
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  none: 'Correct',
  minor: 'Léger',
  moderate: 'Marqué',
  major: 'Important',
}

export const SEVERITY_COLORS: Record<Severity, string> = {
  none: 'var(--color-sev-none)',
  minor: 'var(--color-sev-minor)',
  moderate: 'var(--color-sev-moderate)',
  major: 'var(--color-sev-major)',
}

export const VIEW_LABELS: Record<ViewType, string> = {
  face_on: 'De face',
  down_the_line: 'De derrière (axe de jeu)',
  unknown: 'Angle indéterminé',
}

export const CATEGORY_LABELS: Record<string, string> = {
  setup: 'Adresse',
  backswing: 'Montée',
  downswing: 'Descente',
  impact: 'Impact',
  finish: 'Finish',
  tempo: 'Tempo',
}

/** Classe Tailwind de fond/texte par gravité. */
export function severityClasses(severity: Severity): string {
  switch (severity) {
    case 'major':
      return 'bg-[color:var(--color-sev-major)]/15 text-[color:var(--color-sev-major)] border-[color:var(--color-sev-major)]/30'
    case 'moderate':
      return 'bg-[color:var(--color-sev-moderate)]/15 text-[color:var(--color-sev-moderate)] border-[color:var(--color-sev-moderate)]/30'
    case 'minor':
      return 'bg-[color:var(--color-sev-minor)]/15 text-[color:var(--color-sev-minor)] border-[color:var(--color-sev-minor)]/30'
    default:
      return 'bg-[color:var(--color-sev-none)]/15 text-[color:var(--color-sev-none)] border-[color:var(--color-sev-none)]/30'
  }
}

/** Confiance en texte lisible plutôt qu'en pourcentage brut. */
export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return 'Fiabilité élevée'
  if (confidence >= 0.5) return 'Fiabilité moyenne'
  if (confidence >= 0.3) return 'Fiabilité faible'
  return 'Indicatif seulement'
}
