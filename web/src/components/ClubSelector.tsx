import { CLUBS } from '../lib/clubs'
import type { ClubKind } from '../core/types'

interface Props {
  value: ClubKind
  onChange: (club: ClubKind) => void
  /** Variante compacte, pour le rapport. */
  compact?: boolean
}

/**
 * Choix du club.
 *
 * Ce n'est pas cosmétique : mesuré sur un corpus de professionnels,
 * l'écartement des pieds passe de 1,27× la largeur d'épaules au fer à 1,54×
 * au driver, et l'inclinaison du buste de 34° à 28°. Sans cette information,
 * sept règles sur douze appliquent une bande commune qui ne détecte que les
 * écarts francs.
 */
export function ClubSelector({ value, onChange, compact = false }: Props) {
  const current = CLUBS.find((c) => c.kind === value)
  return (
    <div className="flex flex-col gap-2">
      {!compact && (
        <p className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Club utilisé
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {CLUBS.map((club) => (
          <button
            key={club.kind}
            type="button"
            onClick={() => onChange(club.kind)}
            aria-pressed={value === club.kind}
            className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              value === club.kind
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line bg-surface text-muted'
            }`}
          >
            {club.label}
          </button>
        ))}
      </div>
      {!compact && current && (
        <p className="text-[0.76rem] leading-relaxed text-muted">{current.hint}</p>
      )}
    </div>
  )
}
