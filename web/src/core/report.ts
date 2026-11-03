/**
 * Orchestrateur : séquence de pose brute → rapport de diagnostic.
 *
 * Enchaînement : nettoyage → signaux → événements → repère corporel →
 * métriques → règles → score.
 */

import { QUALITY, SCORE_FLOOR, faultsFor } from './config'
import { CORE_LANDMARKS, LM } from './landmarks'
import { clamp, dist, meanFinite } from './geometry'
import { hasAll, pt, cleanSequence, type CleanedPose } from './smoothing'
import { buildReference } from './normalize'
import { computeSignals, detectEvents } from './events'
import { computeMetrics } from './metrics'
import { computeMeasurements } from './measurements'
import { ALL_RULES, isNotEvaluated, penaltyOf, type FaultContext } from './faults'
import type { ClubKind, FaultResult, PoseSequence, SwingQuality, SwingReport } from './types'

export type AnalysisOutcome =
  | { ok: true; report: SwingReport }
  | { ok: false; error: string; hint: string }

const SEVERITY_RANK = { major: 3, moderate: 2, minor: 1, none: 0 } as const

/**
 * Déplacement apparent du milieu des chevilles entre l'adresse et l'impact.
 * Les pieds ne bougeant pas avant l'impact, ce déplacement mesure la dérive
 * de la caméra — et donc la contamination des mesures de translation.
 */
function footDriftU(c: CleanedPose, addressFrame: number, impactFrame: number, scale: number): number {
  const ankles = [LM.LEFT_ANKLE, LM.RIGHT_ANKLE]
  if (!hasAll(c, addressFrame, ankles) || !hasAll(c, impactFrame, ankles)) return NaN
  if (!Number.isFinite(scale) || scale < 1e-9) return NaN
  const at = (f: number) => ({
    x: (pt(c, LM.LEFT_ANKLE, f).x + pt(c, LM.RIGHT_ANKLE, f).x) / 2,
    y: (pt(c, LM.LEFT_ANKLE, f).y + pt(c, LM.RIGHT_ANKLE, f).y) / 2,
  })
  return dist(at(addressFrame), at(impactFrame)) / scale
}

export interface AnalysisOptions {
  /**
   * Club utilisé pour ce swing. Plusieurs zones saines en dépendent
   * réellement — écartement des pieds, inclinaison du buste, perte de
   * posture. Sans cette information, l'analyse applique une bande commune à
   * tous les clubs, qui ne détecte que les écarts francs.
   */
  club?: ClubKind
}

export function analyzeSequence(
  seq: PoseSequence,
  options: AnalysisOptions = {},
): AnalysisOutcome {
  const club: ClubKind = options.club ?? 'unknown'
  const n = seq.frames.length
  if (n === 0 || seq.fps <= 0) {
    return { ok: false, error: 'Vidéo vide ou illisible.', hint: 'Réessaie avec un fichier MP4 ou MOV.' }
  }
  if (n / seq.fps < QUALITY.minDurationSec) {
    return {
      ok: false,
      error: 'Vidéo trop courte pour contenir un swing complet.',
      hint: 'Filme depuis l’adresse jusqu’à une seconde après le finish.',
    }
  }

  const c = cleanSequence(seq)

  const presentCount = c.present.reduce((s, p) => s + (p ? 1 : 0), 0)
  const coverage = presentCount / n
  const visVals: number[] = []
  for (let f = 0; f < n; f++) {
    if (!c.present[f]) continue
    for (const lm of CORE_LANDMARKS) visVals.push(c.vis[lm][f])
  }
  const meanVis = meanFinite(visVals)

  if (coverage < QUALITY.minPoseCoverage) {
    return {
      ok: false,
      error: `Le joueur n’est détecté que sur ${Math.round(coverage * 100)} % des images.`,
      hint: 'Cadre le corps entier, assure-toi que la lumière est suffisante et que personne d’autre n’est dans l’image.',
    }
  }

  const sig = computeSignals(c)
  const ball = seq.ball ?? null
  const {
    events,
    confidence: eventConfidence,
    addressWindow,
    impactCorroboratedByBall,
  } = detectEvents(c, sig, ball)
  const ref = buildReference(c, events.address, events.top)
  const metrics = computeMetrics(c, ref, sig)

  const quality: SwingQuality = {
    poseCoverage: coverage,
    meanVisibility: Number.isFinite(meanVis) ? meanVis : 0,
    fps: c.fps,
    downswingFrames: events.impact - events.top,
    footDrift: footDriftU(c, events.address, events.impact, ref.scale),
  }

  const ctx: FaultContext = {
    c, ref, events, addressWindow, eventConfidence, metrics, quality,
    ball,
    club,
    faults: faultsFor(club),
  }

  const faults: FaultResult[] = []
  const notEvaluatedList: SwingReport['notEvaluated'] = []
  for (const rule of ALL_RULES) {
    let result
    try {
      result = rule(ctx)
    } catch {
      // Une règle qui échoue ne doit jamais faire tomber tout le rapport.
      continue
    }
    if (!result) continue
    if (isNotEvaluated(result)) {
      notEvaluatedList.push({ id: result.id, label: result.label, reason: result.reason })
    } else {
      faults.push(result)
    }
  }

  // Les défauts les plus graves et les plus sûrs d'abord ; les points corrects ensuite.
  faults.sort((a, b) => {
    const da = Number(a.detected)
    const db = Number(b.detected)
    if (da !== db) return db - da
    const ra = SEVERITY_RANK[a.severity] * a.confidence
    const rb = SEVERITY_RANK[b.severity] * b.confidence
    return rb - ra
  })

  // Le score pondère chaque pénalité par la confiance : un diagnostic incertain
  // ne doit pas écraser la note.
  let score = 100
  for (const f of faults) {
    if (f.detected) score -= penaltyOf(f.severity) * f.confidence
  }
  score = Math.round(clamp(score, SCORE_FLOOR, 100))

  const warnings: string[] = []
  if (c.fps < QUALITY.warnFps) {
    warnings.push(
      `Vidéo à ${Math.round(c.fps)} i/s : l’impact et le tempo sont approximatifs. Le mode ralenti du téléphone (120 ou 240 i/s) change tout.`,
    )
  }
  if (coverage < QUALITY.warnPoseCoverage) {
    warnings.push(`Joueur détecté sur ${Math.round(coverage * 100)} % des images seulement — certains diagnostics sont moins fiables.`)
  }
  if (Number.isFinite(meanVis) && meanVis < QUALITY.warnMeanVisibility) {
    warnings.push('Points du corps peu visibles (lumière, vêtements larges ou arrière-plan chargé) : les mesures sont bruitées.')
  }
  if (ref.view === 'unknown') {
    warnings.push('Angle de prise de vue non identifié : seules les règles valables dans toutes les vues ont été appliquées.')
  }
  if (events.impact - events.top < QUALITY.minDownswingFrames) {
    warnings.push(`Seulement ${events.impact - events.top} image(s) entre le sommet et l’impact : la position d’impact est imprécise.`)
  }
  if (Number.isFinite(quality.footDrift) && quality.footDrift > QUALITY.warnFootDrift) {
    const severe = quality.footDrift > QUALITY.maxFootDrift
    warnings.push(
      severe
        ? `La caméra a bougé pendant le swing (tes pieds se déplacent de ${Math.round(quality.footDrift * 100)} % de la longueur de ton torse à l’image). Les mesures de déplacement — tête, bassin, équilibre — ne sont pas fiables : cale le téléphone et refilme.`
        : `Léger mouvement de caméra détecté (${Math.round(quality.footDrift * 100)} % du torse). Cale le téléphone contre un sac pour des mesures plus propres.`,
    )
  }
  if (ref.handednessConfidence < 0.6) {
    warnings.push('Latéralité (droitier / gaucher) incertaine — vérifie-la dans le rapport.')
  }

  return {
    ok: true,
    report: {
      meta: {
        club,
        impactCorroboratedByBall,
        ball,
        view: ref.view,
        viewConfidence: ref.viewConfidence,
        handedness: ref.handedness,
        handednessConfidence: ref.handednessConfidence,
        fps: c.fps,
        frameCount: n,
        quality,
        warnings,
      },
      events,
      eventConfidence,
      metrics,
      faults,
      measurements: computeMeasurements({ c, ref, events, ball }),
      notEvaluated: notEvaluatedList,
      score,
    },
  }
}
