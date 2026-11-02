#!/usr/bin/env tsx
/**
 * Fabrique un jeu de validation synthétique : points clés + vérité terrain.
 *
 * Permet d'exercer la boucle de validation (research/validate_events.py) sans
 * dépendre de GolfDB, dont le téléchargement est manuel et la licence non
 * commerciale. La vérité terrain est ici EXACTE par construction : si le
 * moteur se décale, c'est le moteur qui a tort.
 *
 *   npx tsx scripts/synth-set.ts <dossier-sortie>
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { synthSwing, type SynthOptions } from './synth'

const outDir = process.argv[2]
if (!outDir) {
  console.error('Usage : npx tsx scripts/synth-set.ts <dossier-sortie>')
  process.exit(2)
}

const ADDRESS_SEC = 0.5
const FOLLOW_SEC = 0.6

interface Case {
  id: number
  opts: SynthOptions
}

// On fait varier la cadence, la vue et les durées de phases : si une règle de
// détection est accidentellement calée sur 60 i/s, cela doit se voir.
const cases: Case[] = [
  { id: 1, opts: { view: 'face_on' } },
  { id: 2, opts: { view: 'face_on', fps: 30 } },
  { id: 3, opts: { view: 'face_on', fps: 120 } },
  { id: 4, opts: { view: 'down_the_line' } },
  { id: 5, opts: { view: 'down_the_line', fps: 120 } },
  { id: 6, opts: { view: 'face_on', backswingSec: 0.95, downswingSec: 0.3 } },
  { id: 7, opts: { view: 'face_on', backswingSec: 0.55, downswingSec: 0.2 } },
  { id: 8, opts: { view: 'face_on', swayU: 0.3, headShiftU: 0.2 } },
  { id: 9, opts: { view: 'down_the_line', earlyExtensionU: 0.2, postureLossDeg: 15 } },
  { id: 10, opts: { view: 'face_on', fps: 240, backswingSec: 0.8, downswingSec: 0.26 } },
]

mkdirSync(outDir, { recursive: true })
const clips = cases.map(({ id, opts }) => {
  const sequence = synthSwing(opts)
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(sequence))

  const fps = opts.fps ?? 60
  const back = opts.backswingSec ?? 0.75
  const down = opts.downswingSec ?? 0.25
  // Seules les 4 phases structurantes sont définies sans ambiguïté par le
  // générateur. Les 4 autres dépendent de la position du club, que ni le
  // générateur ni le moteur ne connaissent : on ne prétend pas les noter.
  return {
    id,
    view: opts.view,
    frame_count: sequence.frames.length,
    events: {
      address: Math.round(ADDRESS_SEC * fps),
      top: Math.round((ADDRESS_SEC + back) * fps),
      impact: Math.round((ADDRESS_SEC + back + down) * fps),
      finish: Math.round((ADDRESS_SEC + back + down + FOLLOW_SEC) * fps),
    },
  }
})

writeFileSync(join(outDir, 'labels.json'), JSON.stringify({ clips }, null, 1))
console.log(`✓ ${clips.length} clips synthétiques + labels.json → ${outDir}`)
