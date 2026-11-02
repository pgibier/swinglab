import { useState } from 'react'
import { CATEGORY_LABELS, SEVERITY_LABELS, confidenceLabel, severityClasses } from '../lib/labels'
import { ReferenceBand } from './ReferenceBand'
import type { MetricStats } from '../core/reference'
import type { FaultResult } from '../core/types'

interface Props {
  fault: FaultResult
  selected: boolean
  onSelect: () => void
  /** Statistiques du corpus de référence pour cette métrique, si disponibles. */
  referenceStats?: MetricStats | null
  referenceLabel?: string
}

export function FaultCard({ fault, selected, onSelect, referenceStats, referenceLabel }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <li
      className={`overflow-hidden rounded-xl border transition ${
        selected ? 'border-accent bg-accent/8' : 'border-line bg-surface'
      }`}
    >
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[0.62rem] font-semibold tracking-[0.12em] text-muted uppercase">
              {CATEGORY_LABELS[fault.category] ?? fault.category}
            </span>
            <h3 className="text-[0.95rem] leading-snug font-semibold">{fault.label}</h3>
          </div>
          <span
            className={`shrink-0 rounded-lg border px-2 py-1 text-[0.68rem] font-semibold ${severityClasses(
              fault.severity,
            )}`}
          >
            {SEVERITY_LABELS[fault.severity]}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.72rem] text-muted">
          <span className="tabular-nums">
            Mesuré&nbsp;: <span className="font-semibold text-text">{fault.value}</span> {fault.unit}
          </span>
          <span className="tabular-nums">
            Seuil&nbsp;: {fault.threshold} {fault.unit}
          </span>
          <span>{confidenceLabel(fault.confidence)}</span>
        </div>

        <p className="text-[0.84rem] leading-relaxed text-muted">{fault.explanation}</p>

        {referenceStats && referenceLabel && (
          <ReferenceBand
            stats={referenceStats}
            value={fault.value}
            unit={fault.unit}
            profileLabel={referenceLabel}
          />
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onSelect}
            className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold"
          >
            Voir sur la vidéo
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted"
          >
            {open ? 'Masquer l’exercice' : 'Exercice correctif'}
          </button>
        </div>

        {open && (
          <div className="rounded-xl border border-accent/25 bg-accent/8 p-3">
            <p className="text-[0.62rem] font-semibold tracking-[0.12em] text-accent uppercase">
              À travailler
            </p>
            <p className="mt-1.5 text-[0.84rem] leading-relaxed">{fault.drill}</p>
          </div>
        )}
      </div>
    </li>
  )
}
