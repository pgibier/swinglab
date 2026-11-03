/** Règles du backswing (montée). */

import { argMax } from '../geometry'
import { makeFault, requireView, ruleConfidence, severityFrom, type Rule } from './common'

/**
 * Sway : le bassin glisse latéralement à l'écart de la cible pendant la montée,
 * au lieu de pivoter sur place.
 */
export const sway: Rule = (ctx) => {
  const id = 'sway'
  const label = 'Sway (glissement du bassin à la montée)'
  const skip = requireView(ctx, id, label, ['face_on'])
  if (skip) return skip

  const { address, top } = ctx.events
  // hipLateral est orienté vers la cible : s'éloigner de la cible est donc négatif.
  let worst = 0
  let frame = top
  for (let f = address; f <= top; f++) {
    const v = ctx.metrics.hipLateral[f]
    if (Number.isFinite(v) && -v > worst) {
      worst = -v
      frame = f
    }
  }
  if (worst === 0 && !Number.isFinite(ctx.metrics.hipLateral[top])) return null

  const { minor, major } = ctx.faults.sway
  const severity = severityFrom(worst, minor, major)

  return makeFault({
    id, label, category: 'backswing', severity,
    confidence: ruleConfidence(ctx, [address, top], ['address', 'top']),
    value: Math.round(worst * 1000) / 10,
    unit: '% du torse',
    threshold: Math.round(minor * 1000) / 10,
    evidenceFrame: frame,
    referenceFrame: address,
    explanation: severity === 'none'
      ? 'Le bassin pivote sans glisser pendant la montée — c’est ce qu’on cherche.'
      : `Ton bassin glisse de ${(worst * 100).toFixed(0)} % de la longueur de ton torse à l’écart de la cible pendant la montée, au lieu de tourner sur place. Conséquence directe : le bas du swing se déplace lui aussi, et le contact avec la balle devient une loterie (gratte ou top selon le jour).`,
    drill: 'Place un sac ou un coussin contre la hanche arrière et monte sans le pousser : tu dois sentir la hanche TOURNER contre l’obstacle, pas le déplacer. 10 répétitions à vide, puis 10 balles.',
    validViews: ['face_on'],
  })
}

/**
 * Reverse pivot : au sommet, le buste penche vers la cible au lieu de rester
 * incliné du côté arrière.
 */
export const reversePivot: Rule = (ctx) => {
  const id = 'reverse_pivot'
  const label = 'Reverse pivot (buste basculé vers la cible)'
  const skip = requireView(ctx, id, label, ['face_on'])
  if (skip) return skip

  const { address, top } = ctx.events
  const atTop = ctx.metrics.spineLean[top]
  const atAddress = ctx.metrics.spineLean[address]
  if (!Number.isFinite(atTop) || !Number.isFinite(atAddress)) return null

  // spineLean > 0 = buste incliné vers la cible = faute au sommet du backswing.
  const value = atTop
  const { minor, major } = ctx.faults.reversePivot
  const severity = severityFrom(value, minor, major)

  return makeFault({
    id, label, category: 'backswing', severity,
    confidence: ruleConfidence(ctx, [address, top], ['address', 'top']),
    value: Math.round(value * 10) / 10,
    unit: '° vers la cible',
    threshold: minor,
    evidenceFrame: top,
    referenceFrame: address,
    explanation: severity === 'none'
      ? 'Au sommet, ton buste reste incliné du bon côté : le poids est bien chargé sur la jambe arrière.'
      : `Au sommet, ton buste penche de ${value.toFixed(0)}° VERS la cible (reverse pivot). Le poids part sur la jambe avant à la montée, puis repart en arrière à la descente — l’inverse de ce qu’il faut. C’est l’une des causes les plus fréquentes de contacts grattés et de perte de distance.`,
    drill: 'Monte en gardant la tête légèrement DERRIÈRE la balle et sens l’appui s’installer sur le talon arrière. Exercice : fais ton backswing, arrête-toi au sommet et lève le pied avant — si tu tombes vers l’avant, le poids était du mauvais côté.',
    validViews: ['face_on'],
  })
}

/** Mouvement de la tête entre l'adresse et l'impact. */
export const headMovement: Rule = (ctx) => {
  const id = 'head_movement'
  const label = 'Stabilité de la tête'
  const skip = requireView(ctx, id, label, ['face_on', 'down_the_line'])
  if (skip) return skip

  const { address, impact } = ctx.events
  const frame = argMax(ctx.metrics.headShift, address, impact)
  if (frame < 0) return null
  const value = ctx.metrics.headShift[frame]
  if (!Number.isFinite(value)) return null

  const { minor, major } = ctx.faults.headMovement
  const severity = severityFrom(value, minor, major)

  return makeFault({
    id, label, category: 'backswing', severity,
    confidence: ruleConfidence(ctx, [address, frame, impact], ['address', 'impact']),
    value: Math.round(value * 1000) / 10,
    unit: '% du torse',
    threshold: Math.round(minor * 1000) / 10,
    evidenceFrame: frame,
    referenceFrame: address,
    explanation: severity === 'none'
      ? 'Ta tête reste dans une zone stable pendant tout le swing.'
      : `Ta tête se déplace de ${(value * 100).toFixed(0)} % de la longueur de ton torse entre l’adresse et l’impact. Comme la tête est le sommet de l’arc du swing, tout ce qu’elle bouge se répercute sur le point bas : c’est de la dispersion de contact pure.`,
    drill: 'Filme-toi en plaçant mentalement un cercle autour de ta tête à l’adresse et refais 10 swings à mi-amplitude en essayant de rester dedans. Garde l’idée d’une tête qui TOURNE légèrement plutôt qu’elle ne se DÉPLACE.',
    validViews: ['face_on', 'down_the_line'],
  })
}

export const BACKSWING_RULES: Rule[] = [sway, reversePivot, headMovement]
