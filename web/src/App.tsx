import { useCallback, useEffect, useRef, useState } from 'react'
import { UploadScreen } from './components/UploadScreen'
import { ClubSelector } from './components/ClubSelector'
import { Processing } from './components/Processing'
import { ScoreHeader } from './components/ScoreHeader'
import { PhaseStrip } from './components/PhaseStrip'
import { SwingPlayer, type SeekRequest } from './components/SwingPlayer'
import { ReportView } from './components/ReportView'
import { ModelLoadError, loadLandmarker, type LoadedLandmarker } from './pose/mediapipe'
import { detectBall } from './pose/ball'
import { measureShaft } from './pose/shaft'
import {
  extractPoseSequence,
  isLowEndDevice,
  loadVideo,
  releaseVideo,
  type ExtractionProgress,
} from './pose/extract'
import { analyzeSequence } from './core'
import { loadReferenceProfile } from './lib/loadReference'
import { loadClub, saveClub } from './lib/clubs'
import { clearMark, mark, takePendingCrash, type ProgressMark } from './lib/crashLog'
import { CrashNotice } from './components/CrashNotice'
import type { ReferenceProfile } from './core/reference'
import type { ClubKind, FaultResult, PoseSequence, SwingReport } from './core/types'

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
  const [club, setClub] = useState<ClubKind>(() => loadClub())
  // Lue une fois au démarrage : trace éventuelle d'un passage tué par le système.
  const [pendingCrash] = useState<ProgressMark | null>(() => takePendingCrash())

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

  // Un détecteur neuf par analyse : voir loadLandmarker. Celui en cours est
  // conservé le temps d'une éventuelle reprise, puis libéré.
  const landmarkerRef = useRef<LoadedLandmarker | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  // Lu dans handleFile sans le faire dépendre de `club`, pour que la fonction
  // reste stable entre deux rendus.
  const clubRef = useRef<ClubKind>(club)
  clubRef.current = club
  // Le corpus sert au score par centiles : il doit être lisible depuis
  // handleFile sans en faire une dépendance de rendu.
  const referenceRef = useRef<ReferenceProfile | null>(null)
  referenceRef.current = reference

  const seekTo = useCallback((frame: number) => {
    setSeekRequest((prev) => ({ frame, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  /**
   * Changer de club ne nécessite PAS de refaire la détection de pose : la
   * séquence de points clés est déjà calculée, seules les règles changent.
   * Le rapport se met donc à jour instantanément.
   */
  const changeClub = useCallback((next: ClubKind) => {
    setClub(next)
    saveClub(next)
    setStage((prev) => {
      if (prev.k !== 'done') return prev
      const outcome = analyzeSequence(prev.data.sequence, { club: next, reference: referenceRef.current })
      if (!outcome.ok) return prev
      return { ...prev, data: { ...prev.data, report: outcome.report } }
    })
    setSelectedFault(null)
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
      mark('chargement de la vidéo', `${Math.round(file.size / 1e6)} Mo`)
      setStage({ k: 'working', label: 'Chargement de la vidéo…', ratio: 0.02 })
      const { video, url } = await loadVideo(file)
      urlRef.current = url

      mark('préparation du modèle', `${video.videoWidth}×${video.videoHeight}`)
      setStage({
        k: 'working',
        label: 'Préparation du modèle de pose…',
        detail: 'Le modèle est téléchargé une seule fois, puis mis en cache.',
        ratio: 0.08,
      })
      landmarkerRef.current?.landmarker.close()
      landmarkerRef.current = null
      const loaded = await loadLandmarker('full')
      landmarkerRef.current = loaded

      setStage({
        k: 'working',
        label: 'Détection des points du corps…',
        detail: 'Calcul effectué dans ton navigateur, rien n’est envoyé.',
        ratio: 0.12,
      })

      const onExtractProgress = (p: ExtractionProgress) => {
        mark(p.stage === 'extracting' ? 'détection de pose' : 'repérage du swing',
          p.totalFrames ? `image ${p.frame}/${p.totalFrames}` : '')
        setStage({
          k: 'working',
          label: 'Détection des points du corps…',
          detail:
            p.stage === 'probing'
              ? 'Mesure de la cadence vidéo…'
              : p.stage === 'scanning'
                ? 'Repérage du swing dans la vidéo…'
                : `Image ${p.frame} / ${p.totalFrames}`,
          // 12 % de budget pour le chargement, 85 % pour l'extraction.
          ratio: 0.12 + p.ratio * 0.85,
        })
      }

      /**
       * Mode économe d'emblée sur un appareil contraint, et en second essai
       * si le premier échoue. Safari mobile tue l'onglet sans message quand
       * la mémoire manque : mieux vaut analyser moins d'images que de ne rien
       * rendre du tout.
       */
      let lowEnd = isLowEndDevice()
      let sequence: PoseSequence
      try {
        sequence = await extractPoseSequence(video, loaded.landmarker, {
          signal: controller.signal,
          lowEnd,
          onProgress: onExtractProgress,
        })
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        if (lowEnd) throw err
        lowEnd = true
        setStage({
          k: 'working',
          label: 'Nouvel essai en mode économe…',
          detail: 'La première passe a échoué, probablement faute de mémoire.',
          ratio: 0.12,
        })
        sequence = await extractPoseSequence(video, loaded.landmarker, {
          signal: controller.signal,
          lowEnd: true,
          onProgress: onExtractProgress,
        })
      }

      mark('analyse du swing', `${sequence.frames.length} images`)
      setStage({ k: 'working', label: 'Analyse du swing…', ratio: 0.98 })
      let outcome = analyzeSequence(sequence, { club: clubRef.current, reference: referenceRef.current })

      /**
       * Filet de sécurité du recadrage automatique : si le swing détecté
       * touche un bord de la fenêtre, c'est qu'elle était trop serrée et
       * qu'une partie du geste manque. On refait alors l'extraction sur la
       * vidéo entière plutôt que de rendre une analyse amputée.
       *
       * Le cas est rare — les marges sont généreuses — et ce second passage
       * ne coûte que dans ce cas précis.
       */
      const touchesEdge =
        outcome.ok &&
        sequence.window?.trimmed === true &&
        (outcome.report.events.address <= 2 ||
          outcome.report.events.finish >= sequence.frames.length - 3)
      if (touchesEdge || (!outcome.ok && sequence.window?.trimmed)) {
        setStage({
          k: 'working',
          label: 'Reprise sur la vidéo entière…',
          detail: 'Le swing débordait de la fenêtre repérée.',
          ratio: 0.5,
        })
        const full = await extractPoseSequence(video, loaded.landmarker, {
          signal: controller.signal,
          lowEnd,
          startSec: 0,
          endSec: video.duration,
          onProgress: (p) =>
            setStage({
              k: 'working',
              label: 'Reprise sur la vidéo entière…',
              detail: `Image ${p.frame} / ${p.totalFrames}`,
              ratio: 0.5 + p.ratio * 0.48,
            }),
        })
        const retry = analyzeSequence(full, { club: clubRef.current, reference: referenceRef.current })
        if (retry.ok) {
          sequence = full
          outcome = retry
        }
      }

      if (!outcome.ok) {
        setStage({ k: 'error', message: outcome.error, hint: outcome.hint })
        return
      }

      /*
       * Repérage de la balle, une fois l'impact cinématique connu — il sert
       * de point de départ à la recherche. Si elle est trouvée, son départ
       * DATE l'impact au lieu de le déduire, et l'analyse est refaite : seules
       * les règles tournent à nouveau, la détection de pose n'est pas
       * recommencée.
       *
       * Une balle absente (swing à vide, filet, mauvais angle) n'est pas une
       * erreur : on garde simplement l'impact cinématique.
       */
      try {
        mark('repérage de la balle')
        setStage({
          k: 'working',
          label: 'Repérage de la balle…',
          detail: 'Pour dater l\u2019impact précisément.',
          ratio: 0.99,
        })
        const ball = await detectBall(video, sequence, outcome.report.events.impact, {
          signal: controller.signal,
          lowEnd,
        })
        if (ball) {
          sequence = { ...sequence, ball }
          const withBall = analyzeSequence(sequence, { club: clubRef.current, reference: referenceRef.current })
          if (withBall.ok) outcome = withBall
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        // La balle est un bonus : son échec ne doit pas emporter l'analyse.
      }

      /*
       * Mesure du manche aux deux images où il est net : adresse et sommet.
       * Comme la balle, c'est une mesure sans verdict — mais la voir
       * superposée à la vidéo vaut mieux que de ne rien montrer du club.
       */
      try {
        mark('mesure du manche')
        setStage({
          k: 'working',
          label: 'Repérage du club…',
          detail: 'Manche à l\u2019adresse et au sommet.',
          ratio: 0.995,
        })
        const shaft = await measureShaft(
          video,
          sequence,
          { address: outcome.report.events.address, top: outcome.report.events.top },
          { signal: controller.signal },
        )
        if (shaft) {
          sequence = { ...sequence, shaft }
          const withShaft = analyzeSequence(sequence, {
            club: clubRef.current,
            reference: referenceRef.current,
          })
          if (withShaft.ok) outcome = withShaft
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err
        // Le club est un bonus : son échec ne doit pas emporter l'analyse.
      }

      // Le décodeur de l'élément d'extraction est libéré : sur mobile, le
      // lecteur du rapport en ouvre un second, et deux décodeurs vivants pour
      // la même vidéo pèsent lourd.
      releaseVideo(video)
      /*
       * La marque n'est pas effacée tout de suite : si la page meurt en
       * affichant le rapport — lecture en boucle, overlay redessiné à chaque
       * image —, le plantage serait invisible au diagnostic. On la laisse
       * quelques secondes, le temps que le rapport tienne debout.
       */
      mark('affichage du rapport')
      window.setTimeout(clearMark, 6000)

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
      clearMark()
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
      <div className="mx-auto w-full max-w-lg px-4 pb-16 pt-3 lg:max-w-6xl">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-[0.18em] text-muted uppercase">SwingLab</span>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-muted"
          >
            Nouvelle vidéo
          </button>
        </div>

        {/*
          La vidéo reste visible pendant qu'on lit l'analyse : collée en haut
          sur téléphone, en colonne à côté sur grand écran. Sans cela, il faut
          faire défiler entre le défaut décrit et le geste qui l'illustre.
        */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
          <div className="sticky top-0 z-20 flex w-full min-w-0 flex-col gap-2 bg-ink pb-3 pt-1 lg:top-4 lg:w-[44%] lg:shrink-0 lg:self-start">
            <SwingPlayer
              url={data.url}
              sequence={data.sequence}
              report={data.report}
              selectedFault={selectedFault}
              seekRequest={seekRequest}
              onFrameChange={setCurrentFrame}
              maxHeight="34vh"
            />
            <PhaseStrip report={data.report} currentFrame={currentFrame} onSeek={seekTo} />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <ScoreHeader report={data.report} modelInfo={data.modelInfo} />

            <div className="rounded-2xl border border-line bg-surface p-3.5">
              <p className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
                Club utilisé
              </p>
              <ClubSelector value={club} onChange={changeClub} compact />
              <p className="mt-2 text-[0.74rem] leading-relaxed text-muted">
                Change-le pour réévaluer ce swing&nbsp;: l&rsquo;analyse est immédiate, la
                vidéo n&rsquo;est pas retraitée. Sept règles sur douze ont une zone saine
                qui dépend du club.
              </p>
            </div>

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
        </div>
      </div>
    )
  }

  return (
    <UploadScreen
      onFile={handleFile}
      busy={false}
      crashNotice={pendingCrash ? <CrashNotice mark={pendingCrash} /> : null}
      club={club}
      onClubChange={(next) => {
        setClub(next)
        saveClub(next)
      }}
    />
  )
}
