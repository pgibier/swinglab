import { EVENT_LABELS_SHORT } from '../lib/labels'
import { SWING_EVENTS, type SwingReport } from '../core/types'

interface Props {
  report: SwingReport
  currentFrame: number
  onSeek: (frame: number) => void
}

/**
 * Bande des 8 phases. La pastille indique la fiabilité : les 4 phases définies
 * par la position du club dans GolfDB sont des approximations (le club n'est
 * pas détecté), autant que l'utilisateur le sache.
 */
export function PhaseStrip({ report, currentFrame, onSeek }: Props) {
  return (
    // `min-w-0` est indispensable : sans lui, le contenu en `min-w-max`
    // impose sa largeur au conteneur parent au lieu de défiler dedans.
    <div className="w-full min-w-0 overflow-x-auto pb-1">
      <div className="flex min-w-max gap-2">
        {SWING_EVENTS.map((name) => {
          const frame = report.events[name]
          const confidence = report.eventConfidence[name]
          const active = Math.abs(currentFrame - frame) <= 1
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSeek(frame)}
              className={`flex min-w-[5.2rem] flex-col items-start gap-1 rounded-xl border px-2.5 py-2 text-left transition ${
                active ? 'border-accent bg-accent/12' : 'border-line bg-surface'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor:
                      confidence >= 0.7
                        ? 'var(--color-sev-none)'
                        : confidence >= 0.5
                          ? 'var(--color-sev-minor)'
                          : 'var(--color-sev-moderate)',
                  }}
                  title={`Fiabilité ${Math.round(confidence * 100)} %`}
                />
                <span className={`text-xs font-semibold ${active ? 'text-accent' : ''}`}>
                  {EVENT_LABELS_SHORT[name]}
                </span>
              </span>
              <span className="text-[0.65rem] tabular-nums text-muted">img. {frame + 1}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
