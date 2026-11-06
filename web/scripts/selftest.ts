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

import { analyzeSequence, type AnalysisOptions } from '../src/core/report'
import { SWING_EVENTS, type SwingReport } from '../src/core/types'
import { synthSwing, type SynthOptions } from './synth'
import { EXTRACTION } from '../src/core/config'

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

function analyze(name: string, opts: SynthOptions, options: AnalysisOptions = {}): SwingReport {
  const outcome = analyzeSequence(synthSwing(opts), options)
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
  check('aucun défaut détecté sur un swing propre', detected.length === 0, detected.join(', '))

  // Les règles réservées à la vue de derrière doivent se taire, pas deviner.
  check('early extension non évaluée de face', skipped(r, 'early_extension'))
  check('posture non évaluée de face', skipped(r, 'loss_of_posture'))
  console.log(`     défauts détectés=[${detected.join(', ')}]`)
}

// ---------------------------------------------------------------------------
console.log('\n[2] Sway injecté (bassin qui glisse de 30 % du torse)')
// ---------------------------------------------------------------------------
{
  const r = analyze('sway', { view: 'face_on', swayU: 0.3 })
  check('sway détecté en gravité « important »', sev(r, 'sway') === 'major', sev(r, 'sway'))
  check('valeur mesurée proche de 30 % du torse',
    Math.abs(val(r, 'sway') - 30) < 7, `${val(r, 'sway')} %`)
  check('le sway est bien signalé comme défaut', r.faults.some((f) => f.id === 'sway' && f.detected))
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
console.log('\n[16] Le club doit changer le verdict, pas seulement l\u2019affichage')
// ---------------------------------------------------------------------------
{
  // Un même swing jugé selon deux clubs. Sans ce test, la sélection de club
  // pourrait n'avoir aucun effet réel sans que rien ne le signale.
  const wide = { view: 'face_on' as const, stanceRatio: 1.75 }
  const asDriver = analyze('stance driver', wide, { club: 'driver' })
  const asIron = analyze('stance fer', wide, { club: 'iron' })
  check('appuis à 1,75 : normaux au driver', sev(asDriver, 'setup_stance_width') === 'none',
    `${sev(asDriver, 'setup_stance_width')} (${val(asDriver, 'setup_stance_width')})`)
  check('appuis à 1,75 : trop larges au fer', sev(asIron, 'setup_stance_width') !== 'none',
    `${sev(asIron, 'setup_stance_width')}`)

  const upright = { view: 'down_the_line' as const, spineTiltDeg: 24 }
  const tiltDriver = analyze('buste driver', upright, { club: 'driver' })
  const tiltIron = analyze('buste fer', upright, { club: 'iron' })
  check('buste à 24° : normal au driver', sev(tiltDriver, 'setup_spine_tilt') === 'none',
    `${sev(tiltDriver, 'setup_spine_tilt')} (${val(tiltDriver, 'setup_spine_tilt')}°)`)
  check('buste à 24° : trop droit au fer', sev(tiltIron, 'setup_spine_tilt') !== 'none',
    `${sev(tiltIron, 'setup_spine_tilt')}`)

  // Le wedge emprunte la distribution des fers.
  const wedge = analyze('appuis wedge', wide, { club: 'wedge' })
  check('le wedge suit le calage des fers',
    sev(wedge, 'setup_stance_width') === sev(asIron, 'setup_stance_width'))

  // Sans club, la bande commune ne doit pas être plus stricte que les deux.
  const unknown = analyze('appuis sans club', wide)
  check('sans club, la bande commune reste tolérante',
    sev(unknown, 'setup_stance_width') === 'none',
    `${sev(unknown, 'setup_stance_width')}`)

  // Le club ne doit PAS bouger les règles que la mesure dit indépendantes.
  const sd = analyze('sway driver', { view: 'face_on', swayU: 0.3 }, { club: 'driver' })
  const si = analyze('sway fer', { view: 'face_on', swayU: 0.3 }, { club: 'iron' })
  check('le sway ne dépend pas du club', sev(sd, 'sway') === sev(si, 'sway'))
}

// ---------------------------------------------------------------------------
console.log('\n[17] Le rapport constate, il ne note pas')
// ---------------------------------------------------------------------------
{
  /*
   * Le défaut corrigé : une note sur 100 laissait lire « mon swing vaut 96 »
   * là où la mesure ne disait que « ma géométrie corporelle ressemble à celle
   * d'un pro ». Deux formules ont été mesurées, aucune ne discrimine — voir
   * docs/LIMITES.md. Le rapport expose désormais un constat vérifiable et la
   * liste de ce qu'il ne couvre pas.
   */
  const band = (p10: number, p50: number, p90: number) => ({
    n: 200, mean: p50, sd: (p90 - p10) / 2.5,
    percentiles: {
      '5': p10 - (p50 - p10) * 0.4, '10': p10, '25': (p10 + p50) / 2, '50': p50,
      '75': (p50 + p90) / 2, '90': p90, '95': p90 + (p90 - p50) * 0.4,
    },
  })
  const reference = {
    label: 'test', clipsAnalysed: 200, clipsKept: 200,
    views: {
      face_on: {
        sway: band(0, 1, 14),
        slide: band(-3, 8, 27),
        head_movement: band(13, 23, 40),
        reverse_pivot: band(-8, 4, 12),
        chicken_wing: band(134, 151, 166),
        tempo: band(2.3, 3.3, 5.0),
        finish_balance: band(2.7, 5.6, 11.8),
        setup_stance_width: band(1.24, 1.5, 1.84),
      },
    },
  } as never

  const clean = analyzeSequence(synthSwing({ view: 'face_on' }), { reference })
  check('le rapport situe l\u2019utilisateur dans le corpus',
    clean.ok && clean.report.summary.comparable >= 4 && clean.report.summary.medianPercentile !== null,
    clean.ok ? `${clean.report.summary.comparable} mesures comparables` : 'refusé')

  const extreme = analyzeSequence(
    synthSwing({ view: 'face_on', swayU: 0.45, headShiftU: 0.8 }),
    { reference },
  )
  check('un écart franc sort de la plage du corpus',
    extreme.ok && clean.ok && extreme.report.summary.outsideRange > clean.report.summary.outsideRange,
    extreme.ok && clean.ok
      ? `${extreme.report.summary.outsideRange} vs ${clean.report.summary.outsideRange}`
      : 'refusé')

  const report = analyze('couverture', { view: 'face_on' })
  check('la couverture annonce ce qui n\u2019est pas mesuré',
    report.coverage.notMeasured.length >= 3 &&
    report.coverage.notMeasured.some((x) => /frappe/i.test(x.label)),
    `${report.coverage.notMeasured.length} dimensions`)
  check('aucune note sur 100 n\u2019est exposée',
    !('score' in (report as unknown as Record<string, unknown>)))
}

// ---------------------------------------------------------------------------
// [18] Paramètres de lecture acceptables par un navigateur
//
// Régression réelle : une vitesse de 0,06 avait été configurée. Chromium et
// WebKit lèvent une exception sous 1/16 au lieu de ramener la valeur dans la
// plage, ce qui faisait échouer l'analyse entière au lieu de la ralentir. Le
// défaut n'était visible que dans un vrai navigateur ; ce contrôle le rend
// détectable sans en lancer un.
console.log('\n[18] Vitesses de lecture dans la plage supportée par un navigateur')
{
  const FLOOR = 0.0625
  check('aucune vitesse sous le plancher HTML (1/16)',
    EXTRACTION.playbackRates.every((r) => r >= FLOOR),
    EXTRACTION.playbackRates.join(', '))
  check('vitesses ordonnées de la plus rapide à la plus lente',
    EXTRACTION.playbackRates.every((r, i, a) => i === 0 || r < a[i - 1]),
    EXTRACTION.playbackRates.join(', '))
  check('aucune vitesse au-dessus de 16',
    EXTRACTION.playbackRates.every((r) => r <= 16))
}

// ---------------------------------------------------------------------------
console.log(`\n${failures === 0 ? '✓ TOUS LES TESTS PASSENT' : '✗ ÉCHECS'} — ${checks - failures}/${checks} vérifications\n`)
process.exit(failures === 0 ? 0 : 1)
