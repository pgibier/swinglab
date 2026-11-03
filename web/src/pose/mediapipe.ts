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

/**
 * Vérifie qu'une URL sert bien le fichier attendu.
 *
 * Un simple `res.ok` ne suffit pas : les hébergeurs statiques avec repli SPA
 * (Cloudflare Pages, Netlify, Vercel…) renvoient `index.html` avec un code 200
 * pour n'importe quel chemin inconnu. Sans ce contrôle, on passe du HTML à
 * MediaPipe, qui échoue avec un obscur « Unable to open zip archive ».
 */
async function isServedFile(url: string, minBytes = 0): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) return false
    const type = res.headers.get('content-type') ?? ''
    if (type.includes('text/html')) return false
    if (minBytes > 0) {
      const length = Number(res.headers.get('content-length') ?? '0')
      // Un Content-Length absent (transfert chunked) n'est pas disqualifiant.
      if (length > 0 && length < minBytes) return false
    }
    return true
  } catch {
    return false
  }
}

/** Un modèle de pose pèse au minimum ~5 Mo : en dessous, ce n'est pas un modèle. */
const MIN_MODEL_BYTES = 1_000_000

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
/**
 * Le runtime WASM est coûteux à initialiser et ne dépend pas de la vidéo :
 * on le garde. Le détecteur, lui, est recréé à chaque analyse (voir plus bas).
 */
let filesetPromise: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null
let filesetIsLocal = false

/**
 * Crée un détecteur NEUF à chaque analyse.
 *
 * Deux raisons, la première rencontrée en test : en mode VIDEO, MediaPipe
 * exige des horodatages strictement croissants sur toute la durée de vie du
 * détecteur. Réutiliser la même instance pour une deuxième vidéo, dont les
 * horodatages repartent de zéro, fait échouer l'analyse — autrement dit,
 * analyser deux swings de suite était cassé.
 *
 * La seconde est plus insidieuse : ce mode entretient un suivi temporel.
 * Conserver ce suivi d'une vidéo à l'autre ferait fuiter la pose du joueur
 * précédent dans les premières images de la suivante.
 *
 * Le coût se limite à la construction du graphe, le runtime WASM étant
 * conservé et le modèle servi par le cache du navigateur.
 */
/**
 * Appareils où le délégué GPU est à éviter.
 * iOS et iPadOS, y compris les iPad récents qui se déclarent « MacIntel ».
 */
export function prefersCpuDelegate(): boolean {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export interface LoadOptions {
  /**
   * Force un délégué d'exécution. Par défaut on tente le GPU puis le CPU.
   *
   * Sur iOS, le délégué GPU alloue des textures WebGL que Safari mobile
   * supporte mal : c'est une cause connue d'onglet tué sans message. Le
   * délégué CPU fait tourner le MÊME modèle sur les MÊMES images, donc sans
   * perte de précision — seulement un peu plus lentement.
   */
  delegate?: 'GPU' | 'CPU'
}

export async function loadLandmarker(
  variant: ModelVariant = 'full',
  loadOptions: LoadOptions = {},
): Promise<LoadedLandmarker> {
  const localWasm = `${import.meta.env.BASE_URL}wasm`
  if (!filesetPromise) {
    filesetIsLocal = await isServedFile(`${localWasm}/vision_wasm_internal.wasm`)
    filesetPromise = FilesetResolver.forVisionTasks(filesetIsLocal ? localWasm : CDN_WASM)
  }
  const fileset = await filesetPromise
  const useLocalWasm = filesetIsLocal

  const useLocalModel = await isServedFile(localModelUrl(variant), MIN_MODEL_BYTES)
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

  // Sur iOS, le délégué GPU alloue des textures WebGL que Safari mobile
  // supporte mal : c'est une cause connue d'onglet tué sans message, et c'est
  // le symptôme observé. On force donc le CPU sur ces appareils.
  //
  // Sans perte de précision : le MÊME modèle tourne sur les MÊMES images.
  // Vérifié sur un swing réel, la chaîne Python — qui utilise le délégué CPU —
  // et la chaîne navigateur en GPU donnent les huit phases à une image près
  // et les métriques à 0,4 point près.
  const forcedDelegate = loadOptions.delegate ?? (prefersCpuDelegate() ? 'CPU' : undefined)

  if (forcedDelegate === 'CPU') {
    const landmarker = await PoseLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { ...options.baseOptions, delegate: 'CPU' },
    })
    return { landmarker, variant, delegate: 'CPU', local: useLocalModel && useLocalWasm }
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
    try {
      const landmarker = await PoseLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      })
      return { landmarker, variant, delegate: 'CPU', local: useLocalModel && useLocalWasm }
    } catch (err) {
      // Les erreurs natives de MediaPipe sont illisibles pour un utilisateur :
      // on les remplace par un message actionnable.
      throw new ModelLoadError(
        'Le modèle de détection de pose n\u2019a pas pu être chargé.',
        assetPath,
        err,
      )
    }
  }
}

export class ModelLoadError extends Error {
  readonly assetPath: string
  readonly cause: unknown
  constructor(message: string, assetPath: string, cause: unknown) {
    super(message)
    this.name = 'ModelLoadError'
    this.assetPath = assetPath
    this.cause = cause
  }
}
