import { VIEW_LABELS } from '../lib/labels'
import { CLUB_LABELS } from '../lib/clubs'
import type { SwingReport } from '../core/types'

interface Props {
  report: SwingReport
  modelInfo: string
}

function ring(score: number): string {
  if (score >= 80) return 'var(--color-sev-none)'
  if (score >= 60) return 'var(--color-sev-minor)'
  if (score >= 45) return 'var(--color-sev-moderate)'
  return 'var(--color-sev-major)'
}

export function ScoreHeader({ report, modelInfo }: Props) {
  const { score, meta } = report
  const detected = report.faults.filter((f) => f.detected).length
  const circumference = 2 * Math.PI * 42
  const color = ring(score)

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-4">
        <div className="relative size-24 shrink-0">
          <svg viewBox="0 0 100 100" className="size-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-surface-2)" strokeWidth="8" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - score / 100)}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className="text-2xl font-semibold tabular-nums">{score}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">
            {detected === 0
              ? 'Aucun défaut marqué détecté'
              : `${detected} point${detected > 1 ? 's' : ''} à travailler`}
          </p>
          <p className="text-xs leading-relaxed text-muted">
            Score indicatif, calculé en pondérant chaque défaut par sa fiabilité. Il sert à suivre
            ta progression, pas à te comparer à quelqu&rsquo;un d&rsquo;autre.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-[0.7rem]">
        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1">
          {VIEW_LABELS[meta.view]}
          {meta.view !== 'unknown' && ` · ${Math.round(meta.viewConfidence * 100)} %`}
        </span>
        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1">
          {meta.handedness === 'right' ? 'Droitier' : 'Gaucher'}
        </span>
        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1">
          {meta.club === 'unknown' ? 'Club non précisé' : CLUB_LABELS[meta.club]}
        </span>
        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1 tabular-nums">
          {Math.round(meta.fps)} i/s analysées
        </span>
        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1">{modelInfo}</span>
        {meta.ball && (
          <span className="rounded-lg border border-[color:var(--color-sev-none)]/30 bg-[color:var(--color-sev-none)]/10 px-2 py-1 text-[color:var(--color-sev-none)]">
            Balle repérée
            {meta.impactCorroboratedByBall ? ' · impact confirmé' : ''}
          </span>
        )}
      </div>

      {meta.warnings.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-xl border border-[color:var(--color-sev-minor)]/25 bg-[color:var(--color-sev-minor)]/8 p-3">
          {meta.warnings.map((w) => (
            <li key={w} className="text-[0.78rem] leading-relaxed text-[color:var(--color-sev-minor)]">
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
