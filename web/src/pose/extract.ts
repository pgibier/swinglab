/**
 * Extraction de la séquence de pose depuis un fichier vidéo, dans le navigateur.
 *
 * Deux difficultés que l'API HTML ne résout pas :
 *  1. Le nombre d'images par seconde d'une vidéo n'est PAS exposé. On le mesure
 *     en observant les frames réellement présentées (requestVideoFrameCallback).
 *  2. Il n'existe pas de « frame suivante ». On avance donc par seek sur le
 *     centre de chaque frame, ce qui donne une couverture déterministe —
 *     contrairement à une lecture en temps réel, où les frames sautent dès que
 *     l'inférence prend du retard.
 */

import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { EXTRACTION } from '../core/config'
import type { Landmark, PoseFrame, PoseSequence } from '../core/types'

/** Déclaration de requestVideoFrameCallback, absente des types DOM standards. */
interface VideoFrameMeta {
  mediaTime: number
  presentedFrames: number
}
type RVFC = (cb: (now: number, meta: VideoFrameMeta) => void) => number
const rvfc = (v: HTMLVideoElement): RVFC | null => {
  const fn = (v as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback
  return typeof fn === 'function' ? fn.bind(v) : null
}

export interface ExtractionProgress {
  /** Avancement [0..1]. */
  ratio: number
  stage: 'probing' | 'extracting'
  frame: number
  totalFrames: number
}

/** Charge un fichier dans un élément vidéo détaché et attend ses métadonnées. */
export async function loadVideo(file: File | Blob): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // Nécessaire pour lire les pixels d'un blob local sans souiller le canvas.
  video.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('Format vidéo non lisible par le navigateur.'))
    }
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('error', onError)
  })

  // Certains navigateurs ne renseignent les dimensions qu'après la 1re frame.
  if (video.videoWidth === 0) {
    await seekTo(video, 0).catch(() => undefined)
  }
  return { video, url }
}

/** Positionne la vidéo sur `time` et attend que la frame soit décodée. */
export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('seek timeout'))
    }, EXTRACTION.seekTimeoutMs)
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const cleanup = () => {
      window.clearTimeout(timer)
      video.removeEventListener('seeked', onSeeked)
    }
    video.addEventListener('seeked', onSeeked)
    video.currentTime = time
  })
}

/** Recale une mesure de FPS sur une valeur usuelle si elle en est proche (±4 %). */
function snapFps(fps: number): number {
  for (const common of EXTRACTION.commonFps) {
    if (Math.abs(fps - common) / common < 0.04) return common
  }
  return Math.round(fps * 100) / 100
}

/**
 * Mesure les images par seconde en observant les frames présentées.
 * Utilise la médiane des écarts : robuste aux frames dupliquées et aux hoquets
 * de décodage, contrairement à une moyenne.
 */
export async function probeFps(video: HTMLVideoElement): Promise<number> {
  const request = rvfc(video)
  if (!request) return EXTRACTION.fallbackFps

  const times: number[] = []
  await seekTo(video, 0).catch(() => undefined)

  const done = new Promise<void>((resolve) => {
    const onFrame = (_now: number, meta: VideoFrameMeta) => {
      times.push(meta.mediaTime)
      if (times.length >= EXTRACTION.fpsProbeFrames) {
        resolve()
        return
      }
      request(onFrame)
    }
    request(onFrame)
    // Garde-fou : une vidéo très courte peut ne jamais fournir assez de frames.
    window.setTimeout(resolve, 2000)
  })

  try {
    await video.play()
  } catch {
    return EXTRACTION.fallbackFps
  }
  await done
  video.pause()

  const deltas = times
    .slice(1)
    .map((t, i) => t - times[i])
    .filter((d) => d > 1e-4)
  if (deltas.length < 3) return EXTRACTION.fallbackFps

  deltas.sort((a, b) => a - b)
  const median = deltas[Math.floor(deltas.length / 2)]
  const fps = 1 / median
  if (!Number.isFinite(fps) || fps < EXTRACTION.minFps || fps > EXTRACTION.maxFps) {
    return EXTRACTION.fallbackFps
  }
  return snapFps(fps)
}

/** Laisse respirer le thread principal pour que la barre de progression avance. */
const yieldToUI = () => new Promise<void>((r) => window.setTimeout(r, 0))

function toFrame(landmarks: Array<{ x: number; y: number; z: number; visibility?: number }> | undefined): PoseFrame {
  if (!landmarks || landmarks.length === 0) return null
  return landmarks.map<Landmark>((l) => ({
    x: l.x,
    y: l.y,
    z: l.z,
    visibility: typeof l.visibility === 'number' ? l.visibility : 1,
  }))
}

export interface ExtractOptions {
  onProgress?: (p: ExtractionProgress) => void
  /** Instant de début de l'analyse, en secondes. */
  startSec?: number
  /** Instant de fin de l'analyse, en secondes. */
  endSec?: number
  signal?: AbortSignal
}

/**
 * Parcourt la vidéo frame par frame et renvoie la séquence de pose.
 *
 * Sous-échantillonne au besoin : une vidéo en ralenti à 240 i/s n'a pas besoin
 * d'être analysée image par image, et 2 000 seeks coûteraient une minute pour
 * rien. Le FPS retourné est le FPS EFFECTIF de l'analyse.
 */
export async function extractPoseSequence(
  video: HTMLVideoElement,
  landmarker: PoseLandmarker,
  opts: ExtractOptions = {},
): Promise<PoseSequence> {
  const { onProgress, signal } = opts
  onProgress?.({ ratio: 0, stage: 'probing', frame: 0, totalFrames: 0 })

  const sourceFps = await probeFps(video)
  const start = Math.max(0, opts.startSec ?? 0)
  const end = Math.min(video.duration || 0, opts.endSec ?? video.duration ?? 0)
  const span = Math.max(0, end - start)

  const rawFrames = Math.max(1, Math.floor(span * sourceFps))
  const stride = Math.max(1, Math.ceil(rawFrames / EXTRACTION.maxAnalysisFrames))
  const effectiveFps = sourceFps / stride
  const totalFrames = Math.max(1, Math.floor(rawFrames / stride))

  const frames: PoseFrame[] = []
  const timestamps: number[] = []
  let lastTimestampMs = -1

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) throw new DOMException('Analyse annulée', 'AbortError')

    // Centre de la frame : évite de tomber pile sur une frontière de frame,
    // où le décodeur peut rendre l'image précédente ou la suivante.
    const t = Math.min(end - 1e-3, start + (i * stride + 0.5) / sourceFps)
    timestamps.push(t)
    try {
      await seekTo(video, t)
    } catch {
      frames.push(null)
      continue
    }

    // MediaPipe exige des timestamps strictement croissants en mode VIDEO.
    const timestampMs = Math.max(lastTimestampMs + 1, Math.round(t * 1000))
    lastTimestampMs = timestampMs

    try {
      const result = landmarker.detectForVideo(video, timestampMs)
      frames.push(toFrame(result.landmarks?.[0]))
    } catch {
      frames.push(null)
    }

    if (i % 3 === 0 || i === totalFrames - 1) {
      onProgress?.({
        ratio: (i + 1) / totalFrames,
        stage: 'extracting',
        frame: i + 1,
        totalFrames,
      })
      await yieldToUI()
    }
  }

  return {
    frames,
    fps: effectiveFps,
    timestamps,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  }
}
