/**
 * Moteur d'analyse de swing — point d'entrée public.
 *
 * Ce module est volontairement sans dépendance (ni React, ni MediaPipe) :
 * il tourne dans le navigateur, dans un Web Worker et dans Node
 * (cf. scripts/analyze.ts pour la validation sur GolfDB).
 */

export { analyzeSequence, type AnalysisOutcome } from './report'
export * from './types'
export { LM, SKELETON_EDGES, CORE_LANDMARKS, LANDMARK_COUNT } from './landmarks'
export { FAULTS, EVENTS, QUALITY, SMOOTHING, VIEW } from './config'
export { cleanSequence, type CleanedPose, pt, hasAll } from './smoothing'
export { buildReference, type BodyRef, handsCenter, hipCenter, shoulderCenter } from './normalize'
export { computeSignals, detectEvents, type EventSignals } from './events'
export { computeMetrics } from './metrics'
export { ALL_RULES } from './faults'
