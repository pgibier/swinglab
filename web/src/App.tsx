import { useCallback, useEffect, useRef, useState } from 'react'
import { UploadScreen } from './components/UploadScreen'
import { Processing } from './components/Processing'
import { ScoreHeader } from './components/ScoreHeader'
import { PhaseStrip } from './components/PhaseStrip'
import { SwingPlayer, type SeekRequest } from './components/SwingPlayer'
import { ReportView } from './components/ReportView'
import { ModelLoadError, loadLandmarker, type LoadedLandmarker } from './pose/mediapipe'
import { extractPoseSequence, loadVideo } from './pose/extract'
import { analyzeSequence } from './core'
import { loadReferenceProfile } from './lib/loadReference'
import type { ReferenceProfile } from './core/reference'
import type { FaultResult, PoseSequence, SwingReport } from './core/types'

interface Analysis {
  url: string
  sequence: PoseSequence
  report: SwingReport
  modelInfo: string
}

type Stage =
  | { k: 'idle' }
  | { k: 'working'; label: string; detail?: string; ratio: number }
  | { k: 'error'; message: string; hint?: string }
  | { k: 'done'; data: Analysis }

export default function App() {
  const [stage, setStage] = useState<Stage>({ k: 'idle' })
  const [selectedFault, setSelectedFault] = useState<FaultResult | null>(null)
  const [seekRequest, setSeekRequest] = useState<SeekRequest | null>(null)
  const [currentFrame, setCurrentFrame] = useState(0)
  const [reference, setReference] = useState<ReferenceProfile | null>(null)

  // Le corpus de comparaison est facultatif : s'il n'est pas publié avec le
  // site, l'app n'affiche simplement aucune comparaison.
  useEffect(() => {
    let cancelled = false
    void loadReferenceProfile().then((profile) => {
      if (!cancelled) setReference(profile)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Le détecteur est coûteux à créer : on le garde pour les analyses suivantes.
  const landmarkerRef = useRef<LoadedLandmarker | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)

  const seekTo = useCallback((frame: number) => {
    setSeekRequest((prev) => ({ frame, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setSelectedFault(null)
    setSeekRequest(null)
    setCurrentFrame(0)
    setStage({ k: 'idle' })
  }, [])

  const handleFile = useCallback(async (file: File) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setSelectedFault(null)
    setSeekRequest(null)

    try {
      setStage({ k: 'working', label: 'Chargement de la vidéo…', ratio: 0.02 })
      const { video, url } = await loadVideo(file)
      urlRef.current = url

      if (!landmarkerRef.current) {
        setStage({
          k: 'working',
          label: 'Téléchargement du modèle de pose…',
          detail: 'Une seule fois, puis il reste en cache.',
          ratio: 0.08,
        })
        landmarkerRef.current = await loadLandmarker('full')
      }
      const loaded = landmarkerRef.current

      setStage({
        k: 'working',
        label: 'Détection des points du corps…',
        detail: 'Calcul effectué dans ton navigateur, rien n’est envoyé.',
        ratio: 0.12,
      })

      const sequence = await extractPoseSequence(video, loaded.landmarker, {
        signal: controller.signal,
        onProgress: (p) => {
          setStage({
            k: 'working',
            label: 'Détection des points du corps…',
            detail:
              p.stage === 'probing'
                ? 'Mesure de la cadence vidéo…'
                : `Image ${p.frame} / ${p.totalFrames}`,
            // 12 % de budget pour le chargement, 85 % pour l'extraction.
            ratio: 0.12 + p.ratio * 0.85,
          })
        },
      })

      setStage({ k: 'working', label: 'Analyse du swing…', ratio: 0.98 })
      const outcome = analyzeSequence(sequence)
      if (!outcome.ok) {
        setStage({ k: 'error', message: outcome.error, hint: outcome.hint })
        return
      }

      setCurrentFrame(outcome.report.events.address)
      setStage({
        k: 'done',
        data: {
          url,
          sequence,
          report: outcome.report,
          modelInfo: `MediaPipe ${loaded.variant} · ${loaded.delegate}`,
        },
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      if (err instanceof ModelLoadError) {
        setStage({
          k: 'error',
          message: err.message,
          hint: 'Vérifie ta connexion : le modèle est téléchargé une seule fois, puis mis en cache. Si le problème persiste, recharge la page.',
        })
        return
      }
      setStage({
        k: 'error',
        message: err instanceof Error ? err.message : 'Analyse impossible.',
        hint: 'Essaie une autre vidéo, ou un enregistrement plus court et mieux cadré.',
      })
    }
  }, [])

  if (stage.k === 'working') {
    return (
      <Processing
        label={stage.label}
        detail={stage.detail}
        ratio={stage.ratio}
        onCancel={() => {
          abortRef.current?.abort()
          reset()
        }}
      />
    )
  }

  if (stage.k === 'error') {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col justify-center gap-4 px-6 text-center">
        <p className="text-base font-semibold text-[color:var(--color-sev-major)]">{stage.message}</p>
        {stage.hint && <p className="text-sm leading-relaxed text-muted">{stage.hint}</p>}
        <button
          type="button"
          onClick={reset}
          className="mx-auto rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-ink"
        >
          Réessayer
        </button>
      </div>
    )
  }

  if (stage.k === 'done') {
    const { data } = stage
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-4 pb-16 pt-5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold tracking-[0.18em] text-muted uppercase">SwingLab</span>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted"
          >
            Nouvelle vidéo
          </button>
        </div>

        <ScoreHeader report={data.report} modelInfo={data.modelInfo} />

        <SwingPlayer
          url={data.url}
          sequence={data.sequence}
          report={data.report}
          selectedFault={selectedFault}
          seekRequest={seekRequest}
          onFrameChange={setCurrentFrame}
        />

        <PhaseStrip report={data.report} currentFrame={currentFrame} onSeek={seekTo} />

        <ReportView
          report={data.report}
          reference={reference}
          selectedFaultId={selectedFault?.id ?? null}
          onSelectFault={(fault) => {
            setSelectedFault(fault)
            seekTo(fault.evidenceFrame)
          }}
        />
      </div>
    )
  }

  return <UploadScreen onFile={handleFile} busy={false} />
}
