import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderOverlay } from '../lib/draw'
import { EVENT_LABELS, SEVERITY_COLORS } from '../lib/labels'
import { SWING_EVENTS, type FaultResult, type PoseSequence, type SwingReport } from '../core/types'

export interface SeekRequest {
  frame: number
  /** Incrémenté à chaque demande pour rejouer un seek sur la même frame. */
  nonce: number
}

interface Props {
  url: string
  sequence: PoseSequence
  report: SwingReport
  selectedFault: FaultResult | null
  seekRequest: SeekRequest | null
  onFrameChange?: (frame: number) => void
  /** Hauteur maximale du cadre vidéo, pour laisser l'analyse visible à côté. */
  maxHeight?: string
}

const SPEEDS = [0.15, 0.3, 0.6, 1] as const

/** Frame analysée la plus proche d'un instant vidéo (recherche dichotomique). */
function frameAtTime(timestamps: number[], t: number): number {
  const n = timestamps.length
  if (n === 0) return 0
  if (t <= timestamps[0]) return 0
  if (t >= timestamps[n - 1]) return n - 1
  let lo = 0
  let hi = n - 1
  while (lo < hi - 1) {
    const m = (lo + hi) >> 1
    if (timestamps[m] <= t) lo = m
    else hi = m
  }
  return t - timestamps[lo] <= timestamps[hi] - t ? lo : hi
}

export function SwingPlayer({
  url,
  sequence,
  report,
  selectedFault,
  seekRequest,
  onFrameChange,
  maxHeight,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)

  const [frame, setFrame] = useState(report.events.address)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(0.3)
  const [showSkeleton, setShowSkeleton] = useState(true)
  // Lecture en boucle sur le swing : on veut voir le geste tourner, pas
  // cliquer sur « lecture » à chaque fois.
  const [loop, setLoop] = useState(true)

  const total = sequence.frames.length
  const faultColor = selectedFault ? SEVERITY_COLORS[selectedFault.severity] : SEVERITY_COLORS.none

  /** Redessine l'overlay pour la frame donnée. */
  const draw = useCallback(
    (index: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const dpr = window.devicePixelRatio || 1
      const cssW = canvas.clientWidth
      const cssH = canvas.clientHeight
      if (cssW === 0 || cssH === 0) return
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr)
        canvas.height = Math.round(cssH * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, cssW, cssH)

      // La vidéo est affichée en « contain » : elle ne remplit pas forcément
      // son cadre. L'overlay est donc calé sur le rectangle RÉELLEMENT occupé
      // par l'image, sinon le squelette se décale dès que les proportions du
      // cadre ne sont pas celles de la vidéo — ce qui arrive dès qu'on limite
      // la hauteur pour laisser de la place à l'analyse.
      const fit = Math.min(cssW / sequence.videoWidth, cssH / sequence.videoHeight)
      const drawW = sequence.videoWidth * fit
      const drawH = sequence.videoHeight * fit
      ctx.translate((cssW - drawW) / 2, (cssH - drawH) / 2)

      const refFrame = selectedFault?.referenceFrame ?? report.events.address
      renderOverlay({
        ctx,
        width: drawW,
        height: drawH,
        frame: sequence.frames[index] ?? null,
        reference: sequence.frames[refFrame] ?? null,
        showSkeleton,
        fault: selectedFault,
        faultColor,
        ball: report.meta.ball,
        // Le manche n'est mesuré qu'à l'adresse et au sommet : on ne le
        // trace que sur ces images, sinon il resterait figé au mauvais endroit.
        shaft:
          index === report.events.address
            ? (report.meta.shaft?.address ?? null)
            : index === report.events.top
              ? (report.meta.shaft?.top ?? null)
              : null,
      })
    },
    [faultColor, report.events, report.meta.ball, report.meta.shaft, selectedFault, sequence, showSkeleton],
  )

  const goToFrame = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(total - 1, index))
      setFrame(clamped)
      const video = videoRef.current
      if (video) {
        const t = sequence.timestamps[clamped]
        if (Number.isFinite(t)) video.currentTime = t
      }
    },
    [sequence.timestamps, total],
  )

  // Demande de seek venue de l'extérieur (bande de phases, carte de défaut).
  useEffect(() => {
    if (!seekRequest) return
    const video = videoRef.current
    if (video && !video.paused) {
      video.pause()
      setPlaying(false)
    }
    goToFrame(seekRequest.frame)
  }, [seekRequest, goToFrame])

  // Boucle de rendu pendant la lecture.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      return
    }
    const tick = () => {
      const video = videoRef.current
      if (video) {
        // Boucle bornée au swing : inutile de repasser par les secondes où le
        // joueur se place ou range son club.
        const loopEnd = sequence.timestamps[report.events.finish] ?? video.duration
        const loopStart = sequence.timestamps[report.events.address] ?? 0
        if (loop && video.currentTime >= loopEnd) {
          video.currentTime = loopStart
        }
        const index = frameAtTime(sequence.timestamps, video.currentTime)
        setFrame(index)
        draw(index)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing, draw, loop, sequence.timestamps, report.events.address, report.events.finish])

  // Redessine à l'arrêt (changement de frame, de défaut sélectionné, de taille).
  useLayoutEffect(() => {
    if (!playing) draw(frame)
  }, [draw, frame, playing])

  useEffect(() => {
    onFrameChange?.(frame)
  }, [frame, onFrameChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => draw(frame))
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [draw, frame])

  useEffect(() => {
    const video = videoRef.current
    if (video) video.playbackRate = speed
  }, [speed])

  // Positionne la vidéo sur l'adresse dès qu'elle est prête.
  const onLoaded = () => {
    const video = videoRef.current
    if (!video) return
    video.playbackRate = speed
    const t = sequence.timestamps[report.events.address]
    if (Number.isFinite(t)) video.currentTime = t
    // Démarrage automatique : le swing tourne dès l'ouverture du rapport.
    // Muet et en ligne, donc autorisé sans geste de l'utilisateur.
    void video
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false))
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      // Repart de l'adresse si on est arrivé au bout.
      if (video.currentTime >= (sequence.timestamps[total - 1] ?? 0) - 0.02) {
        video.currentTime = sequence.timestamps[report.events.address] ?? 0
      }
      video.playbackRate = speed
      void video.play()
      setPlaying(true)
    } else {
      video.pause()
      setPlaying(false)
    }
  }

  const currentEvent = SWING_EVENTS.find((name) => report.events[name] === frame)

  return (
    <div className="flex flex-col gap-3">
      {/*
        La hauteur pilote la largeur quand une hauteur maximale est imposée :
        le cadre épouse alors les proportions de la vidéo au lieu de la
        laisser flotter entre deux bandes noires. `maxWidth` reprend la main
        pour une vidéo en paysage, où c'est la largeur qui contraint.
      */}
      <div
        className="relative mx-auto self-center overflow-hidden rounded-2xl bg-black"
        style={
          maxHeight
            ? {
                aspectRatio: `${sequence.videoWidth} / ${sequence.videoHeight}`,
                height: maxHeight,
                width: 'auto',
                maxWidth: '100%',
              }
            : {
                aspectRatio: `${sequence.videoWidth} / ${sequence.videoHeight}`,
                width: '100%',
              }
        }
      >
        <video
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 size-full object-contain"
          onLoadedMetadata={onLoaded}
          onSeeked={() => {
            if (!playing) draw(frame)
          }}
          onEnded={() => setPlaying(false)}
        />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" />

        {currentEvent && (
          <span className="absolute left-3 top-3 rounded-lg bg-ink/75 px-2.5 py-1 text-xs font-semibold text-accent backdrop-blur">
            {EVENT_LABELS[currentEvent]}
          </span>
        )}
        {/* Deux bascules compactes : le cadre vidéo peut être étroit. */}
        <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
          {([
            ['Boucle', loop, () => setLoop((v) => !v)],
            ['Points', showSkeleton, () => setShowSkeleton((v) => !v)],
          ] as const).map(([label, active, toggle]) => (
            <button
              key={label}
              type="button"
              onClick={toggle}
              aria-pressed={active}
              className={`rounded-lg px-2 py-0.5 text-[0.68rem] font-semibold backdrop-blur transition ${
                active ? 'bg-accent/85 text-ink' : 'bg-ink/70 text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={frame}
        onChange={(e) => {
          const video = videoRef.current
          if (video && !video.paused) {
            video.pause()
            setPlaying(false)
          }
          goToFrame(Number(e.target.value))
        }}
        className="w-full"
        aria-label="Position dans le swing"
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => goToFrame(frame - 1)}
            className="grid size-10 place-items-center rounded-xl border border-line bg-surface text-base"
            aria-label="Image précédente"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="grid size-11 place-items-center rounded-xl bg-accent text-ink"
            aria-label={playing ? 'Pause' : 'Lecture'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            type="button"
            onClick={() => goToFrame(frame + 1)}
            className="grid size-10 place-items-center rounded-xl border border-line bg-surface text-base"
            aria-label="Image suivante"
          >
            ›
          </button>
        </div>

        <span className="hidden text-[0.68rem] tabular-nums text-muted sm:inline">
          {frame + 1}/{total}
        </span>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`rounded-lg px-2 py-1.5 text-xs font-semibold tabular-nums transition ${
                speed === s ? 'bg-accent text-ink' : 'border border-line bg-surface text-muted'
              }`}
            >
              {s === 1 ? '1×' : `${s}×`}
            </button>
          ))}
        </div>
      </div>


    </div>
  )
}
