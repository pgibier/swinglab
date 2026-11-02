/** Agrégation des règles de diagnostic. */

import { SETUP_RULES } from './setup'
import { BACKSWING_RULES } from './backswing'
import { DOWNSWING_RULES } from './downswing'
import { TEMPO_FINISH_RULES } from './tempoFinish'
import type { Rule } from './common'

/** Ordre d'exécution = ordre chronologique du swing. */
export const ALL_RULES: Rule[] = [
  ...SETUP_RULES,
  ...BACKSWING_RULES,
  ...DOWNSWING_RULES,
  ...TEMPO_FINISH_RULES,
]

export * from './common'
export { SETUP_RULES, BACKSWING_RULES, DOWNSWING_RULES, TEMPO_FINISH_RULES }
