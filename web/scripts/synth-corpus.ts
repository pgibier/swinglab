#!/usr/bin/env tsx
/**
 * Fabrique un corpus synthétique de swings « propres », avec variation.
 *
 * À quoi ça sert : exercer et valider toute la chaîne de profil de référence
 * (research/build_reference.py) avant de disposer d'un vrai corpus de pros.
 * Les valeurs tirées imitent la dispersion attendue chez de bons joueurs,
 * elles ne la MESURENT pas — ce corpus ne remplace pas de vraies données et
 * ne doit jamais servir à caler les seuils livrés.
 *
 *   npx tsx scripts/synth-corpus.ts <dossier> [nombre] [graine]
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { synthSwing, type SynthOptions } from './synth'

const [outDir, countArg, seedArg] = process.argv.slice(2)
if (!outDir) {
  console.error('Usage : npx tsx scripts/synth-corpus.ts <dossier> [nombre] [graine]')
  process.exit(2)
}
const count = Number(countArg ?? 40)
let state = Number(seedArg ?? 12345) >>> 0

/** Générateur congruentiel : reproductible, suffisant pour fabriquer du bruit. */
function rand(): number {
  state = (state * 1664525 + 1013904223) >>> 0
  return state / 0x100000000
}
/** Tirage approximativement normal (somme de 3 uniformes). */
function gauss(mean: number, sd: number): number {
  return mean + ((rand() + rand() + rand() - 1.5) / 0.866) * sd
}
const pick = <T,>(values: readonly T[]): T => values[Math.floor(rand() * values.length)]

mkdirSync(outDir, { recursive: true })

const clips: Array<Record<string, unknown>> = []
for (let i = 1; i <= count; i++) {
  const view = pick(['face_on', 'down_the_line'] as const)
  const fps = pick([60, 120, 240] as const)
  const backswingSec = Math.max(0.5, gauss(0.78, 0.07))

  const opts: SynthOptions = {
    view,
    fps,
    backswingSec,
    // Tempo autour de 3:1, comme observé chez les joueurs confirmés.
    downswingSec: Math.max(0.12, backswingSec / gauss(3.0, 0.3)),
    swayU: Math.max(0, gauss(0.04, 0.03)),
    slideU: Math.max(0, gauss(0.14, 0.05)),
    reversePivotDeg: gauss(-4, 3),
    headShiftU: Math.max(0, gauss(0.06, 0.03)),
    earlyExtensionU: Math.max(0, gauss(0.03, 0.025)),
    spineTiltDeg: gauss(33, 4),
    postureLossDeg: gauss(3, 2.5),
    leadElbowFollowDeg: gauss(170, 6),
    kneeAngleDeg: gauss(162, 5),
    stanceRatio: gauss(1.1, 0.12),
  }

  const sequence = synthSwing(opts)
  writeFileSync(join(outDir, `${i}.json`), JSON.stringify(sequence))
  clips.push({ id: i, view, fps, club: pick(['driver', 'iron', 'wedge']), level: 'reference' })
}

writeFileSync(join(outDir, 'corpus.json'), JSON.stringify({ clips }, null, 1))
console.log(`✓ ${count} swings de référence synthétiques → ${outDir}`)
