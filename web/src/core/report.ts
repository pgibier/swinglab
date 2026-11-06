/**
 * Orchestrateur : séquence de pose brute → rapport de diagnostic.
 *
 * Enchaînement : nettoyage → signaux → événements → repère corporel →
 * métriques → règles → score.
 */

import { QUALITY, faultsFor } from './config'
import { percentileOf, statsFor, type ReferenceProfile } from './reference'
import { CORE_LANDMARKS, LM } from './landmarks'
import { dist, meanFinite } from './geometry'
import { hasAll, pt, cleanSequence, type CleanedPose } from './smoothing'
import { buildReference } from './normalize'
import { computeSignals, detectEvents } from './events'
import { computeMetrics } from './metrics'
import { computeMeasurements } from './measurements'
import { ALL_RULES, isNotEvaluated, type FaultContext } from './faults'
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

/**
 * Ce que l'analyse ne mesure pas, quelle que soit la vidéo.
 *
 * Affiché systématiquement. Taire ces limites laisse croire qu'un bon
 * indice de posture vaut un bon swing, ce qui est faux : on peut avoir une
 * géométrie de corps irréprochable et frapper la balle n'importe comment.
 */
const NOT_MEASURED: Array<{ label: string; reason: string }> = [
  {
    label: 'Qualité de frappe',
    reason:
      'Contact centré, gras ou maigre : il faudrait voir la tête de club au moment du contact, ' +
      'or elle est floue à 60 i/s. Filmer en ralenti (120 ou 240 i/s) est ce qui changerait la donne.',
  },
  {
    label: 'Face et chemin de club',
    reason:
      'Ouverture ou fermeture de la face, trajectoire intérieure ou extérieure : hors de portée ' +
      'd\u2019une caméra unique sans suivi de la tête de club.',
  },
  {
    label: 'Vol de balle',
    reason:
      'À 60 i/s la balle parcourt plus d\u2019un demi-mètre entre deux images et se fond dans le flou. ' +
      'Vérifié image par image : rien d\u2019exploitable ne subsiste après l\u2019impact.',
  },
  {
    label: 'Séquençage du corps',
    reason:
      'L\u2019ordre bassin → torse → bras demande une rotation 3D qu\u2019une seule caméra ne donne pas. ' +
      'Mesuré sur le corpus, le proxy 2D ne retrouve l\u2019ordre attendu que dans 72 % des cas chez ' +
      'des professionnels : trop peu fiable pour être affiché.',
  },
]

export interface AnalysisOptions {
  /**
   * Club utilisé pour ce swing. Plusieurs zones saines en dépendent
   * réellement — écartement des pieds, inclinaison du buste, perte de
   * posture. Sans cette information, l'analyse applique une bande commune à
   * tous les clubs, qui ne détecte que les écarts francs.
   */
  club?: ClubKind
  /**
   * Corpus de référence. Quand il est fourni, le score mesure l'écart au
   * centre de la distribution sur CHAQUE métrique, au lieu de ne compter que
   * les seuils franchis — un swing médiocre partout sans rien dépasser
   * obtenait sinon une note excellente.
   */
  reference?: ReferenceProfile | null
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
  const shaft = seq.shaft ?? null
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

  /*
   * Constat factuel plutôt qu'une note sur 100.
   *
   * Deux formules ont été essayées et mesurées. Celle par seuils donnait 100
   * au swing d'un débutant ; celle par centiles donnait 64, mais donnait
   * aussi 64 de médiane aux 409 swings de professionnels du corpus. Aucune
   * ne discrimine, parce que l'information n'est pas dans les grandeurs
   * mesurées : sur cinq de ses sept mesures, ce débutant est dans la plage
   * p10–p90 des pros. Une note ne peut donc qu'induire en erreur.
   *
   * On rapporte à la place ce que la mesure permet réellement d'affirmer :
   * combien de grandeurs sortent de la plage professionnelle, et où
   * l'utilisateur se situe en médiane.
   */
  const percentiles: number[] = []
  let outsideRange = 0
  for (const f of faults) {
    const match = statsFor(options.reference ?? null, ref.view, f.id, club)
    if (!match) continue
    const position = percentileOf(match.stats, f.value)
    if (!position) continue
    percentiles.push(position.rank)
    if (position.rank < 10 || position.rank > 90) outsideRange++
  }
  const sortedPercentiles = [...percentiles].sort((a, b) => a - b)
  const medianPercentile = sortedPercentiles.length
    ? Math.round(sortedPercentiles[sortedPercentiles.length >> 1])
    : null

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
        shaft,
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
      measurements: computeMeasurements({ c, ref, events, ball, shaft }),
      notEvaluated: notEvaluatedList,
      summary: {
        outsideRange,
        comparable: percentiles.length,
        medianPercentile,
      },
      coverage: {
        evaluated: faults.length,
        total: faults.length + notEvaluatedList.length,
        notMeasured: NOT_MEASURED,
      },
    },
  }
}
