/** Règles de la descente et de l'impact. */

import { FAULTS } from '../config'
import { argMax } from '../geometry'
import { makeFault, requireView, ruleConfidence, severityFrom, type Rule } from './common'

/**
 * Early extension : le bassin avance vers la balle pendant la descente au lieu
 * de pivoter en arrière. Invisible de face — mesurable de derrière seulement.
 */
export const earlyExtension: Rule = (ctx) => {
  const id = 'early_extension'
  const label = 'Early extension (bassin qui avance vers la balle)'
  const skip = requireView(ctx, id, label, ['down_the_line'])
  if (skip) return skip

  const { top, impact } = ctx.events
  const frame = argMax(ctx.metrics.hipTowardBall, top, impact)
  if (frame < 0) return null
  const value = ctx.metrics.hipTowardBall[frame]
  if (!Number.isFinite(value)) return null

  const { minor, major } = FAULTS.earlyExtension
  const severity = severityFrom(value, minor, major)

  return makeFault({
    id, label, category: 'downswing', severity,
    confidence: ruleConfidence(ctx, [top, frame, impact], ['top', 'impact']),
    value: Math.round(value * 1000) / 10,
    unit: '% du torse',
    threshold: Math.round(minor * 1000) / 10,
    evidenceFrame: frame,
    referenceFrame: ctx.events.address,
    explanation: severity === 'none'
      ? 'Ton bassin conserve sa distance à la balle pendant la descente : l’espace pour les bras est préservé.'
      : `Ton bassin avance de ${(value * 100).toFixed(0)} % de la longueur de ton torse VERS la balle pendant la descente. Tu supprimes l’espace dont tes bras ont besoin pour passer : le corps se redresse, les mains remontent, et tu produis des shanks, des tops ou des hooks de blocage.`,
    drill: 'Mets-toi en adresse les fesses en contact léger avec le dossier d’une chaise (ou un mur). Fais des demi-swings en gardant le contact jusqu’à l’impact : les fesses doivent rester en arrière, pas s’en décoller.',
    validViews: ['down_the_line'],
  })
}

/** Glissement excessif du bassin vers la cible pendant la descente. */
export const lateralSlide: Rule = (ctx) => {
  const id = 'slide'
  const label = 'Glissement du bassin vers la cible'
  const skip = requireView(ctx, id, label, ['face_on'])
  if (skip) return skip

  const { top, impact } = ctx.events
  const frame = argMax(ctx.metrics.hipLateral, top, impact)
  if (frame < 0) return null
  const value = ctx.metrics.hipLateral[frame]
  if (!Number.isFinite(value)) return null

  const { minor, major } = FAULTS.slide
  const severity = severityFrom(value, minor, major)

  return makeFault({
    id, label, category: 'downswing', severity,
    confidence: ruleConfidence(ctx, [top, frame, impact], ['top', 'impact']),
    value: Math.round(value * 1000) / 10,
    unit: '% du torse',
    threshold: Math.round(minor * 1000) / 10,
    evidenceFrame: frame,
    referenceFrame: ctx.events.address,
    explanation: severity === 'none'
      ? 'Un transfert d’appui vers la cible sans glissement excessif : c’est bon.'
      : `Ton bassin glisse de ${(value * 100).toFixed(0)} % de la longueur de ton torse vers la cible pendant la descente. Un transfert d’appui est nécessaire, mais passé un certain point il remplace la ROTATION : la face de club arrive en retard et la balle part à droite (pour un droitier).`,
    drill: 'Pense « la hanche avant tourne vers l’arrière » plutôt que « le bassin va vers la cible ». Exercice : pied avant en retrait de 20 cm (stance fermé), frappe 10 balles à mi-amplitude — cette position force la rotation.',
    validViews: ['face_on'],
  })
}

/** Loss of posture : l'inclinaison du buste change entre l'adresse et l'impact. */
export const lossOfPosture: Rule = (ctx) => {
  const id = 'loss_of_posture'
  const label = 'Loss of posture (perte de la posture)'
  const skip = requireView(ctx, id, label, ['down_the_line'])
  if (skip) return skip

  const { address, top, impact } = ctx.events
  const base = ctx.metrics.spineTilt[address]
  if (!Number.isFinite(base)) return null

  let worst = 0
  let frame = impact
  for (const f of [top, impact]) {
    const v = ctx.metrics.spineTilt[f]
    if (!Number.isFinite(v)) continue
    const d = Math.abs(v - base)
    if (d > worst) {
      worst = d
      frame = f
    }
  }
  if (worst === 0) return null

  const { minor, major } = FAULTS.lossOfPosture
  const severity = severityFrom(worst, minor, major)
  const standingUp = ctx.metrics.spineTilt[frame] < base

  return makeFault({
    id, label, category: 'downswing', severity,
    confidence: ruleConfidence(ctx, [address, frame], ['address', 'top', 'impact']),
    value: Math.round(worst * 10) / 10,
    unit: '° d’écart vs adresse',
    threshold: minor,
    evidenceFrame: frame,
    referenceFrame: address,
    explanation: severity === 'none'
      ? 'Tu conserves l’angle de buste de ton adresse pendant tout le swing.'
      : standingUp
        ? `Ton buste se redresse de ${worst.toFixed(0)}° par rapport à l’adresse (${frame === top ? 'au sommet' : 'à l’impact'}). En te relevant, tu remontes le bas de l’arc du swing : la tête de club arrive au-dessus de son point prévu, donc tops et contacts fins.`
        : `Ton buste s’affaisse de ${worst.toFixed(0)}° par rapport à l’adresse (${frame === top ? 'au sommet' : 'à l’impact'}). En plongeant, tu descends le point bas du swing et tu prends du gazon avant la balle.`,
    drill: 'Fais 10 swings à vide en gardant la sensation du sternum qui reste à la même hauteur. Variante avec un club posé sur les épaules : il doit tourner autour d’un axe fixe, pas monter ni descendre.',
    validViews: ['down_the_line'],
  })
}

/**
 * Chicken wing : le coude avant reste plié après l'impact au lieu de s'étendre.
 * Lisible de face ; en vue de derrière le bras avant est masqué par le corps.
 */
export const chickenWing: Rule = (ctx) => {
  const id = 'chicken_wing'
  const label = 'Chicken wing (coude avant plié après l’impact)'
  const skip = requireView(ctx, id, label, ['face_on'])
  if (skip) return skip

  const { impact, midFollowThrough } = ctx.events
  const value = ctx.metrics.leadElbow[midFollowThrough]
  if (!Number.isFinite(value)) return null

  const { idealMin, minor, major } = FAULTS.chickenWing
  const deviation = Math.max(0, idealMin - value)
  const severity = severityFrom(deviation, minor, major)

  return makeFault({
    id, label, category: 'impact', severity,
    confidence: ruleConfidence(ctx, [impact, midFollowThrough], ['impact', 'midFollowThrough']),
    value: Math.round(value * 10) / 10,
    unit: '° (180° = bras tendu)',
    threshold: idealMin - minor,
    evidenceFrame: midFollowThrough,
    referenceFrame: impact,
    explanation: severity === 'none'
      ? `Ton bras avant s’étend bien après l’impact (${Math.round(value)}°).`
      : `Ton coude avant reste plié à ${Math.round(value)}° après l’impact (visé au-delà de ${idealMin - minor}°) : c’est le « chicken wing ». Le bras qui se replie raccourcit le rayon du swing, tue la vitesse et ouvre la face de club — typiquement des balles faibles vers la droite pour un droitier.`,
    drill: 'Coince une serviette (ou un gant) entre ton bras avant et ton buste, et frappe des demi-swings sans la faire tomber : elle t’oblige à garder le bras connecté et à l’étendre à travers la balle. Objectif : sentir les DEUX bras longs juste après l’impact.',
    validViews: ['face_on'],
  })
}

export const DOWNSWING_RULES: Rule[] = [earlyExtension, lateralSlide, lossOfPosture, chickenWing]
