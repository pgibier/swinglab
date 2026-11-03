import { useState } from 'react'
import { describeCrash, type ProgressMark } from '../lib/crashLog'

interface Props {
  mark: ProgressMark
}

/**
 * Signale qu'une analyse précédente s'est interrompue, et où.
 *
 * Sans ce message, un onglet tué par le système est indiscernable d'un
 * rechargement volontaire — pour l'utilisateur comme pour le diagnostic.
 */
export function CrashNotice({ mark }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  return (
    <div className="rounded-xl border border-[color:var(--color-sev-minor)]/30 bg-[color:var(--color-sev-minor)]/8 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.78rem] font-semibold text-[color:var(--color-sev-minor)]">
          L&rsquo;analyse précédente s&rsquo;est interrompue
        </p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Masquer"
          className="shrink-0 text-muted"
        >
          ×
        </button>
      </div>
      <p className="mt-1.5 text-[0.76rem] leading-relaxed text-muted">
        Elle s&rsquo;est arrêtée à l&rsquo;{describeCrash(mark)}. Si cela se reproduit,
        recopie cette ligne&nbsp;: elle indique exactement où le traitement a été
        coupé.
      </p>
    </div>
  )
}
