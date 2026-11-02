import { useState } from 'react'
import { FaultCard } from './FaultCard'
import { SEVERITY_LABELS, severityClasses } from '../lib/labels'
import type { FaultResult, SwingReport } from '../core/types'

interface Props {
  report: SwingReport
  selectedFaultId: string | null
  onSelectFault: (fault: FaultResult) => void
}

export function ReportView({ report, selectedFaultId, onSelectFault }: Props) {
  const [showGood, setShowGood] = useState(false)
  const detected = report.faults.filter((f) => f.detected)
  const good = report.faults.filter((f) => !f.detected)

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          {detected.length > 0 ? 'À travailler en priorité' : 'Diagnostic'}
        </h2>
        {detected.length > 0 ? (
          <ul className="flex flex-col gap-2.5">
            {detected.map((fault) => (
              <FaultCard
                key={fault.id}
                fault={fault}
                selected={selectedFaultId === fault.id}
                onSelect={() => onSelectFault(fault)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-line bg-surface p-3.5 text-[0.86rem] leading-relaxed text-muted">
            Aucun défaut marqué n&rsquo;a dépassé son seuil sur cette vidéo. Cela ne veut pas dire que
            le swing est parfait&nbsp;: les règles appliquées ne couvrent qu&rsquo;une partie de ce qu&rsquo;un
            enseignant regarde, et seulement ce qui est visible sous cet angle.
          </p>
        )}
      </section>

      {good.length > 0 && (
        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowGood((v) => !v)}
            className="flex items-center justify-between rounded-xl border border-line bg-surface px-3.5 py-3 text-left"
          >
            <span className="text-sm font-semibold">
              Ce qui est déjà correct ({good.length})
            </span>
            <span className="text-muted">{showGood ? '−' : '+'}</span>
          </button>
          {showGood && (
            <ul className="flex flex-col gap-2">
              {good.map((fault) => (
                <li
                  key={fault.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[0.86rem] font-medium">{fault.label}</span>
                    <span className="text-[0.72rem] tabular-nums text-muted">
                      {fault.value} {fault.unit}
                    </span>
                  </div>
                  <span
                    className={`shrink-0 rounded-lg border px-2 py-0.5 text-[0.66rem] font-semibold ${severityClasses(
                      'none',
                    )}`}
                  >
                    {SEVERITY_LABELS.none}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {report.notEvaluated.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
            Non évaluable sur cette vidéo ({report.notEvaluated.length})
          </h2>
          <p className="text-[0.8rem] leading-relaxed text-muted">
            Ces défauts ne sont pas mesurables sous cet angle ou avec cette qualité d&rsquo;image.
            Plutôt que de les deviner, l&rsquo;analyse les laisse de côté et t&rsquo;indique quoi filmer.
          </p>
          <ul className="flex flex-col gap-2">
            {report.notEvaluated.map((item) => (
              <li key={item.id} className="rounded-xl border border-line border-dashed bg-surface/60 p-3.5">
                <p className="text-[0.86rem] font-medium">{item.label}</p>
                <p className="mt-1 text-[0.78rem] leading-relaxed text-muted">{item.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-line bg-surface/60 p-3.5">
        <p className="text-[0.72rem] leading-relaxed text-muted">
          <strong className="font-semibold text-text">Comment lire ce rapport.</strong> Les mesures
          proviennent d&rsquo;une estimation de pose 2D à partir d&rsquo;une seule caméra&nbsp;: elles donnent
          des ordres de grandeur fiables, pas des valeurs de laboratoire. Les seuils viennent de la
          littérature biomécanique et de l&rsquo;enseignement du golf, et n&rsquo;ont pas été calés sur un
          jeu de données annoté — il n&rsquo;en existe pas de public pour les défauts de swing. En cas
          de doute, un enseignant reste la référence.
        </p>
      </section>
    </div>
  )
}
