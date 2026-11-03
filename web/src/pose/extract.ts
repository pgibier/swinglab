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
  stage: 'probing' | 'scanning' | 'extracting'
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
  // Pas de crossOrigin : une URL blob: est de même origine par construction,
  // et l'attribut fait échouer le chargement sur certaines versions de Safari.

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

export interface SwingWindow {
  startSec: number
  endSec: number
  /** false quand le mouvement n'a pas pu être localisé : on analyse tout. */
  trimmed: boolean
}

/**
 * Localise la fenêtre de mouvement par différence d'images sur une vignette.
 *
 * Pourquoi un pré-passage : l'inférence de pose coûte plusieurs dizaines de
 * millisecondes par image, une différence de vignette quelques dizaines de
 * microsecondes. Sur une vidéo de 9 secondes dont 3 contiennent le swing,
 * localiser d'abord puis n'inférer que là divise le travail par trois.
 *
 * La marge conservée de part et d'autre est généreuse : l'adresse et le
 * finish tenu font partie du diagnostic, et les rogner coûterait plus cher
 * que les quelques images gagnées.
 */
export async function findSwingWindow(
  video: HTMLVideoElement,
  onProgress?: (ratio: number) => void,
): Promise<SwingWindow> {
  const duration = video.duration || 0
  const whole: SwingWindow = { startSec: 0, endSec: duration, trimmed: false }
  if (!Number.isFinite(duration) || duration < EXTRACTION.minWindowSec * 2) return whole

  const height = EXTRACTION.motionThumbHeight
  const width = Math.max(
    1,
    Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * height),
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return whole

  const step = EXTRACTION.motionSampleStepSec
  const times: number[] = []
  for (let t = 0; t < duration; t += step) times.push(t)
  if (times.length < 6) return whole

  const energy: number[] = []
  let previous: Uint8ClampedArray | null = null
  for (let i = 0; i < times.length; i++) {
    try {
      await seekTo(video, Math.min(duration - 1e-3, times[i]))
    } catch {
      return whole
    }
    ctx.drawImage(video, 0, 0, width, height)
    const frame = ctx.getImageData(0, 0, width, height).data
    if (previous) {
      let sum = 0
      // Luminance approchée, un pixel sur deux : on cherche un ordre de
      // grandeur de mouvement, pas une mesure fine.
      for (let k = 0; k < frame.length; k += 8) {
        sum += Math.abs(frame[k] - previous[k]) + Math.abs(frame[k + 1] - previous[k + 1])
      }
      energy.push(sum / (frame.length / 8))
    } else {
      energy.push(0)
    }
    previous = frame
    if (i % 8 === 0) {
      onProgress?.(i / times.length)
      await new Promise<void>((r) => window.setTimeout(r, 0))
    }
  }

  // Ligne de base robuste : la médiane ignore le swing lui-même, qui ne
  // représente qu'une poignée d'échantillons.
  const sorted = [...energy].sort((a, b) => a - b)
  const baseline = sorted[sorted.length >> 1]
  let peakIndex = 0
  for (let i = 1; i < energy.length; i++) if (energy[i] > energy[peakIndex]) peakIndex = i
  const peak = energy[peakIndex]
  if (!Number.isFinite(peak) || peak - baseline <= 1e-6) return whole
  const threshold = baseline + (peak - baseline) * EXTRACTION.motionThreshold

  // Expansion de part et d'autre du PIC, et non balayage de toute la vidéo :
  // le joueur entre dans le champ, se place, puis range son club, et ces
  // mouvements-là ne doivent pas élargir la fenêtre.
  const expand = (direction: 1 | -1): number => {
    let edge = peakIndex
    let misses = 0
    for (let i = peakIndex + direction; i >= 0 && i < energy.length; i += direction) {
      if (energy[i] >= threshold) {
        edge = i
        misses = 0
      } else if (++misses > EXTRACTION.motionGapSamples) {
        break
      }
    }
    return edge
  }
  const first = expand(-1)
  const last = expand(1)

  const startSec = Math.max(0, times[first] - EXTRACTION.motionPadBeforeSec)
  const endSec = Math.min(duration, times[last] + EXTRACTION.motionPadAfterSec)
  const span = endSec - startSec
  if (span < EXTRACTION.minWindowSec) return whole
  if (span > duration * EXTRACTION.maxWindowFraction) return whole
  return { startSec, endSec, trimmed: true }
}

/**
 * Horodatages remis à un curseur global croissant.
 *
 * MediaPipe en mode VIDEO refuse tout horodatage inférieur au précédent, sur
 * toute la durée de vie du détecteur. Dériver l'horodatage du temps vidéo
 * casse donc dès qu'on analyse une deuxième vidéo, ou qu'on refait un passage
 * sur la même. Les ÉCARTS entre images sont préservés — c'est ce qui compte
 * pour le suivi temporel —, seule l'origine est décalée.
 */
let timestampCursor = 0

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

/**
 * Libère le décodeur vidéo.
 *
 * Sur mobile, le nombre de vidéos décodables simultanément est très limité,
 * et l'élément d'extraction reste sinon vivant en même temps que celui du
 * lecteur. Ne pas le relâcher consomme un décodeur et sa mémoire pour rien.
 */
export function releaseVideo(video: HTMLVideoElement): void {
  try {
    video.pause()
    video.removeAttribute('src')
    video.load()
  } catch {
    // Rien à faire : l'élément est de toute façon abandonné.
  }
}

/** Appareil à faibles ressources : on y réduit la charge plutôt que de planter. */
export function isLowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const memory = nav.deviceMemory
  const cores = navigator.hardwareConcurrency
  if (typeof memory === 'number' && memory <= 4) return true
  if (typeof cores === 'number' && cores <= 4) return true
  // Safari n'expose ni l'un ni l'autre : on considère iOS comme contraint,
  // car c'est précisément là que l'onglet est tué sans message.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export interface ExtractOptions {
  onProgress?: (p: ExtractionProgress) => void
  /** Force le mode économe : moins d'images analysées, pour tenir en mémoire. */
  lowEnd?: boolean
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

  // Recadrage automatique sur le mouvement, sauf fenêtre imposée par l'appelant.
  let window: SwingWindow = {
    startSec: opts.startSec ?? 0,
    endSec: opts.endSec ?? video.duration ?? 0,
    trimmed: false,
  }
  if (opts.startSec === undefined && opts.endSec === undefined) {
    onProgress?.({ ratio: 0.02, stage: 'scanning', frame: 0, totalFrames: 0 })
    window = await findSwingWindow(video, (ratio) => {
      onProgress?.({ ratio: 0.02 + ratio * 0.08, stage: 'scanning', frame: 0, totalFrames: 0 })
    })
  }

  const start = Math.max(0, window.startSec)
  const end = Math.min(video.duration || 0, window.endSec)
  const span = Math.max(0, end - start)

  const lowEnd = opts.lowEnd ?? isLowEndDevice()
  const maxFrames = lowEnd ? EXTRACTION.maxAnalysisFramesLowEnd : EXTRACTION.maxAnalysisFrames
  const rawFrames = Math.max(1, Math.floor(span * sourceFps))
  const stride = Math.max(1, Math.ceil(rawFrames / maxFrames))
  const effectiveFps = sourceFps / stride
  const totalFrames = Math.max(1, Math.floor(rawFrames / stride))

  // Image réduite envoyée à l'inférence : voir EXTRACTION.inferenceMaxHeight.
  // La hauteur est la MÊME sur tout appareil — seul le nombre d'images varie
  // en mode économe — pour que la précision de mesure ne dépende pas du
  // téléphone.
  const scale = Math.min(1, EXTRACTION.inferenceMaxHeight / Math.max(1, video.videoHeight))
  const inferWidth = Math.max(1, Math.round(video.videoWidth * scale))
  const inferHeight = Math.max(1, Math.round(video.videoHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = inferWidth
  canvas.height = inferHeight
  const canvasCtx = canvas.getContext('2d')
  // Les points clés sont normalisés : les réduire ne change pas leurs
  // coordonnées, seulement la finesse de la détection.
  const source: HTMLVideoElement | HTMLCanvasElement = canvasCtx ? canvas : video

  const frames: PoseFrame[] = []
  const timestamps: number[] = []
  // Un écart franc signale une discontinuité au suivi temporel.
  const timestampBase = timestampCursor + 1000
  let lastTimestampMs = timestampBase - 1

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
    const timestampMs = Math.max(lastTimestampMs + 1, timestampBase + Math.round((t - start) * 1000))
    lastTimestampMs = timestampMs
    timestampCursor = timestampMs

    try {
      if (canvasCtx) canvasCtx.drawImage(video, 0, 0, inferWidth, inferHeight)
      const result = landmarker.detectForVideo(source, timestampMs)
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
    window,
  }
}
