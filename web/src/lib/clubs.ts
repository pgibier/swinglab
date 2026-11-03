/** Libellés et persistance du choix de club. */

import type { ClubKind } from '../core/types'

export const CLUBS: Array<{ kind: ClubKind; label: string; hint: string }> = [
  { kind: 'driver', label: 'Driver', hint: 'Appuis larges, buste plus redressé' },
  { kind: 'wood', label: 'Bois · hybride', hint: 'Entre le driver et le fer' },
  { kind: 'iron', label: 'Fer', hint: 'Appuis plus serrés, buste plus penché' },
  { kind: 'wedge', label: 'Wedge', hint: 'Jugé comme un fer' },
  { kind: 'unknown', label: 'Je ne sais pas', hint: 'Bande commune, moins précise' },
]

export const CLUB_LABELS: Record<ClubKind, string> = CLUBS.reduce(
  (acc, c) => ({ ...acc, [c.kind]: c.label }),
  {} as Record<ClubKind, string>,
)

const STORAGE_KEY = 'swinglab.club'

/** Le dernier club choisi, pour ne pas le redemander à chaque vidéo. */
export function loadClub(): ClubKind {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const found = CLUBS.find((c) => c.kind === raw)
    return found ? found.kind : 'unknown'
  } catch {
    // Navigation privée, stockage bloqué : le défaut suffit.
    return 'unknown'
  }
}

export function saveClub(club: ClubKind): void {
  try {
    localStorage.setItem(STORAGE_KEY, club)
  } catch {
    // Sans importance : le choix reste valable pour la session en cours.
  }
}
