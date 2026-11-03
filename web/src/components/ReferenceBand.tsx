import { bandLayout, percentileOf, type MetricStats, type ReferenceScope } from '../core/reference'

interface Props {
  stats: MetricStats
  /** 'club' quand la référence correspond au club choisi, 'all' sinon. */
  scope: ReferenceScope
  value: number
  unit: string
  profileLabel: string
}

const fmt = (v: number): string =>
  Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)

/**
 * Situe la mesure dans la bande de référence.
 * Aucun jugement de direction : selon la métrique, être au-dessus ou en
 * dessous de la bande peut être bon, mauvais, ou juste différent.
 */
export function ReferenceBand({ stats, scope, value, unit, profileLabel }: Props) {
  const layout = bandLayout(stats, value)
  if (!layout) return null
  const pct = percentileOf(stats, value)

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.62rem] font-semibold tracking-[0.12em] text-muted uppercase">
          Comparaison
        </span>
        <span className="text-[0.66rem] text-muted">
          {profileLabel} · {scope === 'club' ? 'même club' : 'tous clubs'} · n&nbsp;=&nbsp;{stats.n}
        </span>
      </div>

      <div className="relative h-7">
        {/* Axe */}
        <div className="absolute top-3 h-1 w-full rounded-full bg-line" />
        {/* Bande 10e–90e centile */}
        <div
          className="absolute top-3 h-1 rounded-full bg-accent/45"
          style={{
            left: `${layout.low * 100}%`,
            width: `${Math.max(0.5, (layout.high - layout.low) * 100)}%`,
          }}
        />
        {/* Médiane de référence */}
        <div
          className="absolute top-1.5 h-4 w-0.5 -translate-x-1/2 rounded-full bg-accent"
          style={{ left: `${layout.median * 100}%` }}
          title="Médiane de référence"
        />
        {/* Mesure de l'utilisateur */}
        <div
          className="absolute top-0.5 flex -translate-x-1/2 flex-col items-center"
          style={{ left: `${layout.value * 100}%` }}
        >
          <span className="size-2.5 rounded-full border-2 border-ink bg-text" />
          <span className="mt-0.5 text-[0.6rem] font-semibold tabular-nums whitespace-nowrap">
            {fmt(value)}
            {layout.clamped ? ' ↗' : ''}
          </span>
        </div>
      </div>

      <p className="text-[0.72rem] leading-relaxed text-muted">
        Référence&nbsp;: médiane <span className="tabular-nums text-text">{fmt(stats.percentiles['50'])}</span>{' '}
        {unit}, 80&nbsp;% des swings entre{' '}
        <span className="tabular-nums text-text">{fmt(stats.percentiles['10'] ?? stats.percentiles['5'])}</span> et{' '}
        <span className="tabular-nums text-text">{fmt(stats.percentiles['90'] ?? stats.percentiles['95'])}</span>.
        {pct !== null && (
          <>
            {' '}Ta mesure se situe{' '}
            {pct.bounded === 'above'
              ? 'au-delà du '
              : pct.bounded === 'below'
                ? 'en deçà du '
                : 'autour du '}
            <span className="tabular-nums text-text">
              {Math.round(pct.rank)}
              <sup>e</sup>
            </span>{' '}
            centile de ce corpus.
          </>
        )}
      </p>
    </div>
  )
}
