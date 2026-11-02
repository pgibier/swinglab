/**
 * Chargement du modèle de pose.
 *
 * MediaPipe Pose Landmarker (BlazePose GHUM) tourne ici en WASM dans le
 * navigateur : aucun serveur de calcul, donc aucun coût d'infrastructure, et
 * la vidéo ne quitte jamais l'appareil de l'utilisateur.
 *
 * Trois variantes de modèle :
 *   - lite  (~5 Mo)  : téléphones modestes
 *   - full  (~9 Mo)  : défaut — meilleur compromis
 *   - heavy (~29 Mo) : précision maximale, pour analyse fine
 *
 * Les fichiers sont cherchés d'abord en local (/models, /wasm) pour que la PWA
 * fonctionne hors-ligne, puis sur le CDN Google en secours.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'
import { EXTRACTION } from '../core/config'

export type ModelVariant = 'lite' | 'full' | 'heavy'

const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm'

const modelUrl = (v: ModelVariant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/latest/pose_landmarker_${v}.task`

const localModelUrl = (v: ModelVariant) => `${import.meta.env.BASE_URL}models/pose_landmarker_${v}.task`

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

export interface LoadedLandmarker {
  landmarker: PoseLandmarker
  variant: ModelVariant
  /** 'GPU' si le délégué matériel a été accepté, 'CPU' sinon. */
  delegate: 'GPU' | 'CPU'
  /** true si les fichiers locaux ont été utilisés (donc hors-ligne possible). */
  local: boolean
}

/**
 * Crée un détecteur en mode VIDEO (suivi temporel activé : MediaPipe réutilise
 * la détection de la frame précédente, ce qui stabilise les points clés).
 */
export async function loadLandmarker(variant: ModelVariant = 'full'): Promise<LoadedLandmarker> {
  const localWasm = `${import.meta.env.BASE_URL}wasm`
  const useLocalWasm = await exists(`${localWasm}/vision_wasm_internal.wasm`)
  const fileset = await FilesetResolver.forVisionTasks(useLocalWasm ? localWasm : CDN_WASM)

  const useLocalModel = await exists(localModelUrl(variant))
  const assetPath = useLocalModel ? localModelUrl(variant) : modelUrl(variant)

  const options = {
    baseOptions: { modelAssetPath: assetPath },
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: EXTRACTION.minPoseDetectionConfidence,
    minPosePresenceConfidence: EXTRACTION.minPosePresenceConfidence,
    minTrackingConfidence: EXTRACTION.minTrackingConfidence,
    outputSegmentationMasks: false,
  }

  // Le délégué GPU est nettement plus rapide mais indisponible sur certains
  // navigateurs mobiles : on tente, puis on retombe sur le CPU.
  try {
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'GPU' },
    })
    return { landmarker, variant, delegate: 'GPU', local: useLocalModel && useLocalWasm }
  } catch {
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' },
    })
    return { landmarker, variant, delegate: 'CPU', local: useLocalModel && useLocalWasm }
  }
}
