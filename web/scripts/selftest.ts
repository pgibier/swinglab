/**
 * Tests du moteur sur des swings synthétiques.
 *
 * Objectif : vérifier qu'une règle déclenche sur le défaut qu'elle prétend
 * mesurer, et NE déclenche pas sur un swing propre. Sans jeu de données
 * annoté public, c'est le seul garde-fou honnête contre une règle qui
 * « marche » par accident.
 *
 *   npx tsx scripts/selftest.ts
 */

import { analyzeSequence } from '../src/core/report'
import { SWING_EVENTS, type SwingReport } from '../src/core/types'
import { synthSwing, type SynthOptions } from './synth'

let failures = 0
let checks = 0

function check(label: string, condition: boolean, detail = ''): void {
  checks++
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function analyze(name: string, opts: SynthOptions): SwingReport {
  const outcome = analyzeSequence(synthSwing(opts))
  if (!outcome.ok) {
    failures++
    checks++
    console.log(`  ✗ ${name} : analyse refusée — ${outcome.error}`)
    throw new Error(outcome.error)
  }
  return outcome.report
}

const sev = (r: SwingReport, id: string) => r.faults.find((f) => f.id === id)?.severity ?? 'absent'
const val = (r: SwingReport, id: string) => r.faults.find((f) => f.id === id)?.value ?? NaN
const skipped = (r: SwingReport, id: string) => r.notEvaluated.some((x) => x.id === id)

// ---------------------------------------------------------------------------
console.log('\n[1] Swing propre, vue de face')
// ---------------------------------------------------------------------------
{
  const r = analyze('clean face_on', { view: 'face_on' })

  check('vue identifiée comme « de face »', r.meta.view === 'face_on', r.meta.view)
  check('latéralité identifiée droitier', r.meta.handedness === 'right', r.meta.handedness)

  const e = r.events
  const ordered = SWING_EVENTS.every((name, i) =>
    i === 0 ? true : e[name] > e[SWING_EVENTS[i - 1]],
  )
  check('les 8 phases sont strictement ordonnées', ordered, JSON.stringify(e))

  // Repères attendus : adresse ≈ 0,50 s (frame 30), sommet ≈ 1,25 s (75),
  // impact ≈ 1,50 s (90), finish ≈ 2,10 s (126) à 60 i/s.
  check('adresse détectée vers la frame 30', Math.abs(e.address - 30) <= 4, `obtenu ${e.address}`)
  check('sommet détecté vers la frame 75', Math.abs(e.top - 75) <= 5, `obtenu ${e.top}`)
  check('impact détecté vers la frame 90', Math.abs(e.impact - 90) <= 5, `obtenu ${e.impact}`)
  check('finish détecté vers la frame 126', Math.abs(e.finish - 126) <= 6, `obtenu ${e.finish}`)

  const detected = r.faults.filter((f) => f.detected).map((f) => `${f.id}:${f.severity}`)
  check('aucun défaut majeur sur un swing propre',
    !r.faults.some((f) => f.severity === 'major'), detected.join(', '))
  check('score élevé', r.score >= 80, `score ${r.score}`)

  // Les règles réservées à la vue de derrière doivent se taire, pas deviner.
  check('early extension non évaluée de face', skipped(r, 'early_extension'))
  check('posture non évaluée de face', skipped(r, 'loss_of_posture'))
  console.log(`     score=${r.score} défauts détectés=[${detected.join(', ')}]`)
}

// ---------------------------------------------------------------------------
console.log('\n[2] Sway injecté (bassin qui glisse de 30 % du torse)')
// ---------------------------------------------------------------------------
{
  const r = analyze('sway', { view: 'face_on', swayU: 0.3 })
  check('sway détecté en gravité « important »', sev(r, 'sway') === 'major', sev(r, 'sway'))
  check('valeur mesurée proche de 30 % du torse',
    Math.abs(val(r, 'sway') - 30) < 7, `${val(r, 'sway')} %`)
  check('score dégradé', r.score < 90, `score ${r.score}`)
}

// ---------------------------------------------------------------------------
console.log('\n[3] Reverse pivot injecté (+18° vers la cible au sommet)')
// ---------------------------------------------------------------------------
{
  const r = analyze('reverse pivot', { view: 'face_on', reversePivotDeg: 18 })
  check('reverse pivot détecté', sev(r, 'reverse_pivot') === 'major', sev(r, 'reverse_pivot'))
  check('valeur proche de 18°', Math.abs(val(r, 'reverse_pivot') - 18) < 5, `${val(r, 'reverse_pivot')}°`)
}

// ---------------------------------------------------------------------------
console.log('\n[4] Chicken wing injecté (coude avant à 120° au mi-finish)')
// ---------------------------------------------------------------------------
{
  const r = analyze('chicken wing', { view: 'face_on', leadElbowFollowDeg: 120 })
  const s = sev(r, 'chicken_wing')
  check('chicken wing détecté', s === 'major' || s === 'moderate', s)
  check('bras avant mesuré très plié', val(r, 'chicken_wing') < 145, `${val(r, 'chicken_wing')}°`)
}

// ---------------------------------------------------------------------------
console.log('\n[5] Tête qui bouge (25 % du torse)')
// ---------------------------------------------------------------------------
{
  const r = analyze('head', { view: 'face_on', headShiftU: 0.25 })
  const s = sev(r, 'head_movement')
  check('mouvement de tête détecté', s === 'major' || s === 'moderate', s)
}

// ---------------------------------------------------------------------------
console.log('\n[6] Swing propre, vue de derrière (axe de jeu)')
// ---------------------------------------------------------------------------
{
  const r = analyze('clean dtl', { view: 'down_the_line' })
  check('vue identifiée comme « de derrière »', r.meta.view === 'down_the_line', r.meta.view)
  check('inclinaison du buste mesurée ≈ 32°',
    Math.abs(val(r, 'setup_spine_tilt') - 32) < 6, `${val(r, 'setup_spine_tilt')}°`)
  check('inclinaison du buste jugée correcte', sev(r, 'setup_spine_tilt') === 'none', sev(r, 'setup_spine_tilt'))
  check('genoux mesurés ≈ 163°', Math.abs(val(r, 'setup_knee_flex') - 163) < 8, `${val(r, 'setup_knee_flex')}°`)
  // Les règles réservées à la vue de face doivent se taire.
  check('sway non évalué de derrière', skipped(r, 'sway'))
  check('chicken wing non évalué de derrière', skipped(r, 'chicken_wing'))
}

// ---------------------------------------------------------------------------
console.log('\n[7] Early extension injectée (bassin +22 % du torse vers la balle)')
// ---------------------------------------------------------------------------
{
  const r = analyze('early extension', { view: 'down_the_line', earlyExtensionU: 0.22 })
  check('early extension détectée', sev(r, 'early_extension') === 'major', sev(r, 'early_extension'))
  check('valeur proche de 22 % du torse',
    Math.abs(val(r, 'early_extension') - 22) < 7, `${val(r, 'early_extension')} %`)
}

// ---------------------------------------------------------------------------
console.log('\n[8] Loss of posture injectée (buste qui se redresse de 20°)')
// ---------------------------------------------------------------------------
{
  const r = analyze('loss of posture', { view: 'down_the_line', postureLossDeg: 20 })
  check('perte de posture détectée', sev(r, 'loss_of_posture') === 'major', sev(r, 'loss_of_posture'))
  check('valeur proche de 20°', Math.abs(val(r, 'loss_of_posture') - 20) < 6, `${val(r, 'loss_of_posture')}°`)
}

// ---------------------------------------------------------------------------
console.log('\n[9] Posture d’adresse trop droite (12°)')
// ---------------------------------------------------------------------------
{
  const r = analyze('upright', { view: 'down_the_line', spineTiltDeg: 12 })
  const s = sev(r, 'setup_spine_tilt')
  check('posture trop droite détectée', s === 'minor' || s === 'moderate' || s === 'major', s)
}

// ---------------------------------------------------------------------------
console.log('\n[10] Tempo : montée trop rapide (1:1)')
// ---------------------------------------------------------------------------
{
  const r = analyze('tempo', { view: 'face_on', backswingSec: 0.3, downswingSec: 0.3 })
  const s = sev(r, 'tempo')
  check('tempo anormal détecté', s !== 'none' && s !== 'absent', `${s} (${val(r, 'tempo')}:1)`)
}

// ---------------------------------------------------------------------------
console.log('\n[11] Vidéo 30 i/s : le moteur doit avertir, pas se taire')
// ---------------------------------------------------------------------------
{
  const r = analyze('30fps', { view: 'face_on', fps: 30 })
  check('avertissement sur la cadence vidéo',
    r.meta.warnings.some((w) => w.includes('i/s')), r.meta.warnings.join(' | '))
}

// ---------------------------------------------------------------------------
console.log('\n[12] Appuis trop serrés (0,5× la largeur d’épaules)')
// ---------------------------------------------------------------------------
{
  const r = analyze('stance', { view: 'face_on', stanceRatio: 0.5 })
  const s = sev(r, 'setup_stance_width')
  check('appuis trop serrés détectés', s === 'major' || s === 'moderate', `${s} (${val(r, 'setup_stance_width')})`)
}

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? '✓ TOUS LES TESTS PASSENT' : '✗ ÉCHECS'} — ${checks - failures}/${checks} vérifications\n`)
process.exit(failures === 0 ? 0 : 1)
