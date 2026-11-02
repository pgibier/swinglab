interface Props {
  label: string
  ratio: number
  detail?: string
  onCancel?: () => void
}

export function Processing({ label, ratio, detail, onCancel }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-2 text-center">
        <p className="text-lg font-semibold">{label}</p>
        {detail && <p className="text-sm text-muted">{detail}</p>}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-center text-sm tabular-nums text-muted">{pct} %</p>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mx-auto rounded-xl border border-line px-4 py-2 text-sm text-muted"
        >
          Annuler
        </button>
      )}
    </div>
  )
}
