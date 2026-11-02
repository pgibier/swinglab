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
console.log('\n[5] Tête qui bouge (60 % du torse — au-delà du 98e centile des pros)')
// ---------------------------------------------------------------------------
{
  // 60 % du torse : au-delà du 98e centile mesuré chez les professionnels (53 %).
  const r = analyze('head', { view: 'face_on', headShiftU: 0.6 })
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
console.log('\n[13] Déséquilibre au finish')
// ---------------------------------------------------------------------------
{
  // Un vacillement franc doit sortir en « marqué » au minimum ; un léger
  // report d'appui reste normal et ne doit pas être puni.
  const r = analyze('finish wobble', { view: 'face_on', finishWobbleU: 0.45 })
  const s = sev(r, 'finish_balance')
  check('déséquilibre franc au finish détecté', s === 'major' || s === 'moderate',
    `${s} (${val(r, 'finish_balance')} %)`)
  const calm = analyze('finish calme', { view: 'face_on', finishWobbleU: 0.02 })
  check('léger report d\u2019appui non pénalisé', sev(calm, 'finish_balance') === 'none',
    `${sev(calm, 'finish_balance')} (${val(calm, 'finish_balance')} %)`)
}

// ---------------------------------------------------------------------------
console.log('\n[14] Corpus de référence : un bon swing ne doit pas déclencher')
// ---------------------------------------------------------------------------
{
  // Garde-fou le plus important de la suite : si une règle se déclenche sur
  // des swings de bon niveau, elle produit du faux positif en production.
  // C'est précisément ce qu'avait révélé le profil de référence sur la
  // stabilité de tête.
  const views = ['face_on', 'down_the_line'] as const
  let majors = 0
  let triggered = 0
  let total = 0
  const culprits = new Map<string, number>()
  for (const view of views) {
    for (let i = 0; i < 12; i++) {
      // Variation déterministe autour de valeurs de bon joueur.
      const k = i / 11
      const r = analyze(`ref ${view} ${i}`, {
        view,
        fps: [60, 120, 240][i % 3],
        backswingSec: 0.7 + 0.14 * k,
        downswingSec: (0.7 + 0.14 * k) / (2.6 + 0.7 * k),
        swayU: 0.02 + 0.04 * k,
        slideU: 0.1 + 0.08 * k,
        reversePivotDeg: -6 + 4 * k,
        headShiftU: 0.03 + 0.05 * k,
        earlyExtensionU: 0.01 + 0.04 * k,
        spineTiltDeg: 29 + 7 * k,
        postureLossDeg: 1 + 4 * k,
        leadElbowFollowDeg: 176 - 12 * k,
        kneeAngleDeg: 156 + 10 * k,
        stanceRatio: 0.95 + 0.25 * k,
      })
      total++
      for (const f of r.faults) {
        if (!f.detected) continue
        triggered++
        culprits.set(f.id, (culprits.get(f.id) ?? 0) + 1)
        if (f.severity === 'major') majors++
      }
    }
  }
  const worst = [...culprits.entries()].sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${id}×${n}`).join(', ')
  check(`aucun défaut « important » sur ${total} swings de référence`, majors === 0, worst)
  check('moins d\u2019un défaut léger par swing en moyenne', triggered / total < 1,
    `${(triggered / total).toFixed(2)} défaut(s)/swing — ${worst}`)
  console.log(`     ${total} swings, ${triggered} déclenchements${worst ? ` (${worst})` : ''}`)
}

// ---------------------------------------------------------------------------
console.log('\n[15] Tempo : la zone saine doit accepter les tempos de pros')
// ---------------------------------------------------------------------------
{
  // Verrouille la calibration mesurée sur les 1 399 swings annotés de GolfDB
  // (médiane 3,39 ; p10 2,72 ; p90 4,71). La bande 2,3–3,8 utilisée au départ
  // classait 33 % des professionnels en « montée trop lente ».
  for (const [label, back, down] of [
    ['p10 des pros (2,7:1)', 0.81, 0.3],
    ['médiane des pros (3,4:1)', 0.85, 0.25],
    ['p90 des pros (4,7:1)', 0.94, 0.2],
  ] as const) {
    const r = analyze(`tempo ${label}`, {
      view: 'face_on',
      fps: 120,
      backswingSec: back,
      downswingSec: down,
    })
    check(`tempo ${label} jugé correct`, sev(r, 'tempo') === 'none',
      `${sev(r, 'tempo')} (${val(r, 'tempo')}:1)`)
  }
  const slow = analyze('tempo très lent', {
    view: 'face_on', fps: 120, backswingSec: 1.2, downswingSec: 0.17,
  })
  check('montée franchement trop lente détectée', sev(slow, 'tempo') !== 'none',
    `${sev(slow, 'tempo')} (${val(slow, 'tempo')}:1)`)
}

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? '✓ TOUS LES TESTS PASSENT' : '✗ ÉCHECS'} — ${checks - failures}/${checks} vérifications\n`)
process.exit(failures === 0 ? 0 : 1)
