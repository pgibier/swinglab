/** Règles d'adresse (setup). */

import { LM } from '../landmarks'
import { medianOver } from '../geometry'
import { hasAll, pt } from '../smoothing'
import {
  makeFault, requireView, ruleConfidence, severityFrom, type Rule,
} from './common'

/**
 * Inclinaison du buste vers l'avant à l'adresse.
 * ⚠️ Mesurable UNIQUEMENT de derrière (dans l'axe) : vue de face, la flexion
 * se fait vers la caméra et reste invisible en 2D.
 */
export const spineTiltAtAddress: Rule = (ctx) => {
  const id = 'setup_spine_tilt'
  const label = 'Inclinaison du buste à l’adresse'
  const skip = requireView(ctx, id, label, ['down_the_line'])
  if (skip) return skip

  const a = ctx.events.address
  // Médiane sur toute la fenêtre d'immobilité, pas une image isolée.
  const value = medianOver(ctx.metrics.spineTilt, ctx.addressWindow.start, ctx.addressWindow.end)
  if (!Number.isFinite(value)) return null

  const { idealMin, idealMax, minor, major } = ctx.faults.setupSpineTilt
  const deviation = value < idealMin ? idealMin - value : value > idealMax ? value - idealMax : 0
  const severity = severityFrom(deviation, minor, major)
  const tooUpright = value < idealMin

  return makeFault({
    id, label, category: 'setup', severity,
    confidence: ruleConfidence(ctx, [a], ['address']),
    value: Math.round(value * 10) / 10,
    unit: '°',
    threshold: tooUpright ? idealMin : idealMax,
    evidenceFrame: a,
    explanation: severity === 'none'
      ? `Bonne inclinaison du buste à l’adresse (${Math.round(value)}°, zone saine ${idealMin}–${idealMax}°).`
      : tooUpright
        ? `Tu es trop droit à l’adresse (${Math.round(value)}° au lieu de ${idealMin}–${idealMax}°). Le buste pas assez penché depuis les hanches force les bras à chercher la balle, et pousse souvent à se redresser pendant la descente.`
        : `Tu es trop penché à l’adresse (${Math.round(value)}° au lieu de ${idealMin}–${idealMax}°). Un buste trop fermé bloque la rotation des épaules et fatigue le bas du dos.`,
    drill: tooUpright
      ? 'Debout, un club tenu à l’horizontale contre les hanches : pousse les fesses vers l’arrière pour faire glisser le club le long des cuisses, sans plier le dos. Les épaules passent devant les orteils, le poids reste sur la plante des pieds.'
      : 'Pose le club dans le creux des hanches et redresse-toi jusqu’à sentir le dos plat et les bras qui tombent librement sous les épaules. Filme-toi de derrière pour comparer.',
    validViews: ['down_the_line'],
  })
}

/** Flexion des genoux à l'adresse — lisible de derrière (dans l'axe). */
export const kneeFlexAtAddress: Rule = (ctx) => {
  const id = 'setup_knee_flex'
  const label = 'Flexion des genoux à l’adresse'
  const skip = requireView(ctx, id, label, ['down_the_line'])
  if (skip) return skip

  const a = ctx.events.address
  const value = medianOver(ctx.metrics.kneeFlex, ctx.addressWindow.start, ctx.addressWindow.end)
  if (!Number.isFinite(value)) return null

  const { idealMin, idealMax, minor, major } = ctx.faults.setupKneeFlex
  const deviation = value < idealMin ? idealMin - value : value > idealMax ? value - idealMax : 0
  const severity = severityFrom(deviation, minor, major)
  const tooStraight = value > idealMax

  return makeFault({
    id, label, category: 'setup', severity,
    confidence: ruleConfidence(ctx, [a], ['address']),
    value: Math.round(value * 10) / 10,
    unit: '°',
    threshold: tooStraight ? idealMax : idealMin,
    evidenceFrame: a,
    explanation: severity === 'none'
      ? `Flexion de genoux correcte (${Math.round(value)}°).`
      : tooStraight
        ? `Tes jambes sont quasiment tendues à l’adresse (${Math.round(value)}°, visé ${idealMin}–${idealMax}°). Sans ressort dans les jambes, tu perds l’appui au sol et l’équilibre dans la descente.`
        : `Tu es trop assis sur les jambes (${Math.round(value)}°, visé ${idealMin}–${idealMax}°). Un excès de flexion bloque le transfert d’appui et transforme la rotation en mouvement vertical.`,
    drill: 'Debout jambes tendues, fléchis juste assez pour sentir le poids passer du talon à la plante des pieds, puis saute 5 cm sur place : la hauteur de genoux avec laquelle tu atterris est la bonne.',
    validViews: ['down_the_line'],
  })
}

/** Écartement des pieds à l'adresse — lisible de face. */
export const stanceWidthAtAddress: Rule = (ctx) => {
  const id = 'setup_stance_width'
  const label = 'Écartement des pieds'
  const skip = requireView(ctx, id, label, ['face_on'])
  if (skip) return skip

  const { c, events } = ctx
  const a = events.address
  if (!hasAll(c, a, [LM.LEFT_ANKLE, LM.RIGHT_ANKLE, LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER])) return null

  const ankleSep = Math.abs(pt(c, LM.LEFT_ANKLE, a).x - pt(c, LM.RIGHT_ANKLE, a).x)
  const shoulderSep = Math.abs(pt(c, LM.LEFT_SHOULDER, a).x - pt(c, LM.RIGHT_SHOULDER, a).x)
  if (shoulderSep < 1e-6) return null
  const ratio = ankleSep / shoulderSep

  const { idealMin, idealMax, minor, major } = ctx.faults.setupStanceWidth
  const deviation = ratio < idealMin ? idealMin - ratio : ratio > idealMax ? ratio - idealMax : 0
  const severity = severityFrom(deviation, minor, major)
  const tooNarrow = ratio < idealMin

  return makeFault({
    id, label, category: 'setup', severity,
    confidence: ruleConfidence(ctx, [a], ['address']),
    value: Math.round(ratio * 100) / 100,
    unit: '× largeur d’épaules',
    threshold: tooNarrow ? idealMin : idealMax,
    evidenceFrame: a,
    explanation: severity === 'none'
      ? `Écartement des pieds correct (${ratio.toFixed(2)}× la largeur d’épaules).`
      : tooNarrow
        ? `Appuis trop serrés (${ratio.toFixed(2)}× la largeur d’épaules, visé ${idealMin}–${idealMax}). Base trop étroite = équilibre précaire, et le corps compense en freinant la rotation.`
        : `Appuis trop larges (${ratio.toFixed(2)}× la largeur d’épaules, visé ${idealMin}–${idealMax}). Trop écarté, le bassin ne peut plus pivoter : le swing devient un glissement latéral.`,
    drill: 'Pour un fer moyen : l’intérieur des talons à l’aplomb de l’extérieur des épaules. Place deux clubs au sol en repère et refais 10 adresses à vide.',
    validViews: ['face_on'],
  })
}

export const SETUP_RULES: Rule[] = [spineTiltAtAddress, kneeFlexAtAddress, stanceWidthAtAddress]
