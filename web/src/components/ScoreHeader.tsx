import { useState } from 'react'
import { VIEW_LABELS } from '../lib/labels'
import { CLUB_LABELS } from '../lib/clubs'
import type { SwingReport } from '../core/types'

interface Props {
  report: SwingReport
  modelInfo: string
}

/**
 * En-tête du rapport.
 *
 * Volontairement sans note sur 100. Deux formules ont été essayées et
 * mesurées : par seuils, un swing de débutant obtient 100 ; par centiles, il
 * obtient 64 — mais les professionnels du corpus aussi. Une note ne pouvait
 * donc qu'induire en erreur, en laissant lire « mon swing vaut 96 » là où la
 * mesure ne dit que « ma géométrie corporelle ressemble à celle d'un pro ».
 *
 * On affiche à la place ce que la mesure permet d'affirmer, et surtout ce
 * qu'elle ne couvre pas.
 */
export function ScoreHeader({ report, modelInfo }: Props) {
  const { meta, summary, coverage } = report
  const [showLimits, setShowLimits] = useState(false)
  const detected = report.faults.filter((f) => f.detected).length

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-4">
        <div className="flex size-20 shrink-0 flex-col items-center justify-center rounded-2xl border border-line bg-surface-2">
          <span className="text-2xl font-semibold tabular-nums">
            {summary.comparable > 0 ? summary.outsideRange : detected}
          </span>
          <span className="text-[0.6rem] text-muted">
            {summary.comparable > 0 ? `/ ${summary.comparable}` : 'défauts'}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">
            {summary.comparable > 0
              ? summary.outsideRange === 0
                ? 'Aucune mesure hors de la plage des pros'
                : `${summary.outsideRange} mesure${summary.outsideRange > 1 ? 's' : ''} hors de la plage des pros`
              : detected === 0
                ? 'Aucun défaut marqué détecté'
                : `${detected} point${detected > 1 ? 's' : ''} à travailler`}
          </p>
          <p className="text-xs leading-relaxed text-muted">
            {summary.medianPercentile !== null
              ? `Sur les ${summary.comparable} mesures comparables, tu te situes en médiane au ${summary.medianPercentile}ᵉ centile d’un corpus de swings de professionnels.`
              : 'Aucun corpus de comparaison disponible pour cette vue.'}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowLimits((v) => !v)}
        className="flex items-center justify-between rounded-xl border border-[color:var(--color-sev-minor)]/30 bg-[color:var(--color-sev-minor)]/8 px-3.5 py-2.5 text-left"
      >
        <span className="text-[0.78rem] font-semibold text-[color:var(--color-sev-minor)]">
          Ce que cette analyse ne mesure pas ({coverage.notMeasured.length})
        </span>
        <span className="text-[color:var(--color-sev-minor)]">{showLimits ? '−' : '+'}</span>
      </button>
      {showLimits && (
        <ul className="flex flex-col gap-2">
          {coverage.notMeasured.map((item) => (
            <li key={item.label} className="rounded-xl border border-line bg-surface-2/60 p-3">
              <p className="text-[0.82rem] font-semibold">{item.label}</p>
              <p className="mt-1 text-[0.76rem] leading-relaxed text-muted">{item.reason}</p>
            </li>
          ))}
          <li className="px-1 text-[0.74rem] leading-relaxed text-muted">
            Autrement dit&nbsp;: une posture irréprochable n&rsquo;implique pas une bonne frappe.
            Cette analyse décrit ton corps, pas le contact entre le club et la balle.
          </li>
        </ul>
      )}

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
        <span className="rounded-lg border border-line bg-surface-2 px-2 py-1">
          {coverage.evaluated}/{coverage.total} règles évaluées
        </span>
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
