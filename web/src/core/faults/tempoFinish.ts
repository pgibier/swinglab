/** Règles de tempo et de finish. */

import { QUALITY } from '../config'
import { stdFinite } from '../geometry'
import {
  makeFault, notEvaluated, requireView, ruleConfidence, severityFrom, type Rule,
} from './common'

/**
 * Tempo : rapport entre la durée de la montée et celle de la descente.
 * Les joueurs de tour tournent autour de 3:1.
 */
export const tempo: Rule = (ctx) => {
  const id = 'tempo'
  const label = 'Tempo (ratio montée / descente)'
  const skip = requireView(ctx, id, label, ['face_on', 'down_the_line'])
  if (skip) return skip

  const { address, top, impact } = ctx.events
  const backFrames = top - address
  const downFrames = impact - top

  if (downFrames < QUALITY.minDownswingFrames) {
    return notEvaluated(
      id, label,
      `Descente mesurée sur ${downFrames} image(s) seulement : à ${Math.round(ctx.c.fps)} i/s, le tempo n’est pas mesurable de façon fiable. Filme en 60 i/s ou plus (mode ralenti du téléphone).`,
    )
  }
  if (backFrames < 2) return null

  const ratio = backFrames / downFrames
  const { idealMin, idealMax, minor, major } = ctx.faults.tempo
  const deviation = ratio < idealMin ? idealMin - ratio : ratio > idealMax ? ratio - idealMax : 0
  const severity = severityFrom(deviation, minor, major)
  const tooFast = ratio < idealMin

  return makeFault({
    id, label, category: 'tempo', severity,
    confidence: ruleConfidence(ctx, [address, top, impact], ['address', 'top', 'impact']),
    value: Math.round(ratio * 100) / 100,
    unit: ': 1',
    threshold: tooFast ? idealMin : idealMax,
    evidenceFrame: top,
    referenceFrame: impact,
    explanation: severity === 'none'
      ? `Ton tempo est de ${ratio.toFixed(1)}:1, dans la zone de référence (${idealMin}–${idealMax}:1).`
      : tooFast
        ? `Ta montée est trop rapide par rapport à ta descente (${ratio.toFixed(1)}:1, référence ${idealMin}–${idealMax}:1). Une montée précipitée ne laisse pas le temps au corps de se séquencer : tu pars des bras et tu perds en régularité bien plus qu’en vitesse.`
        : `Ta montée est très lente par rapport à ta descente (${ratio.toFixed(1)}:1, référence ${idealMin}–${idealMax}:1). Une montée trop posée casse le rythme et pousse souvent à accélérer brutalement depuis le haut.`,
    drill: 'Compte « un-deux-trois » sur la montée et « un » sur la descente, à voix haute, sur 10 swings. Enchaîne 5 balles en gardant le même comptage.',
    validViews: ['face_on', 'down_the_line'],
  })
}

/** Équilibre tenu pendant le finish. */
export const finishBalance: Rule = (ctx) => {
  const id = 'finish_balance'
  const label = 'Équilibre au finish'
  const skip = requireView(ctx, id, label, ['face_on', 'down_the_line'])
  if (skip) return skip

  const { impact, finish } = ctx.events
  const { windowStartSec, windowLengthSec } = ctx.faults.finishBalance
  // Fenêtre ancrée sur l'impact : indépendante de la détection d'une phase
  // « finish » stable, qui par définition n'existe pas quand le joueur vacille.
  const start = Math.min(ctx.c.n - 1, impact + Math.round(windowStartSec * ctx.c.fps))
  const end = Math.min(ctx.c.n - 1, start + Math.round(windowLengthSec * ctx.c.fps))
  if (end - start < 3) {
    return notEvaluated(
      id, label,
      'La vidéo s’arrête trop tôt après l’impact. Continue de filmer une bonne seconde après la fin du swing.',
    )
  }

  const hipSeries = ctx.metrics.hipLateral.slice(start, end + 1)
  const headSeries = ctx.metrics.headShift.slice(start, end + 1)
  const hipStd = stdFinite(hipSeries)
  const headStd = stdFinite(headSeries)
  const value = Math.max(
    Number.isFinite(hipStd) ? hipStd : 0,
    Number.isFinite(headStd) ? headStd : 0,
  )
  if (!Number.isFinite(value)) return null

  const { minor, major } = ctx.faults.finishBalance
  const severity = severityFrom(value, minor, major)

  return makeFault({
    id, label, category: 'finish', severity,
    confidence: ruleConfidence(ctx, [start, end], ['impact']),
    value: Math.round(value * 1000) / 10,
    unit: '% du torse (instabilité)',
    threshold: Math.round(minor * 1000) / 10,
    evidenceFrame: Math.round((start + end) / 2),
    referenceFrame: finish,
    explanation: severity === 'none'
      ? 'Tu tiens ton finish sans vaciller : signe que le swing est resté équilibré du début à la fin.'
      : `Tu continues de bouger après le finish (instabilité de ${(value * 100).toFixed(0)} % du torse). Un finish qu’on ne peut pas tenir trahit presque toujours un problème en amont : trop de glissement latéral, ou un excès de vitesse non maîtrisé.`,
    drill: 'Finis tes 10 prochains swings en tenant la position 3 secondes, poids entièrement sur le pied avant, poitrine face à la cible. Si tu ne peux pas tenir, réduis ton amplitude de 20 % jusqu’à y arriver.',
    validViews: ['face_on', 'down_the_line'],
  })
}

export const TEMPO_FINISH_RULES: Rule[] = [tempo, finishBalance]
