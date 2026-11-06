#!/usr/bin/env tsx
/**
 * Exécute le moteur d'analyse sur un fichier de points clés, en ligne de commande.
 *
 * C'est le pont entre l'atelier Python (../research) et le moteur TypeScript :
 * une seule implémentation des règles, utilisée aussi bien par l'application
 * que par les scripts de validation. Dupliquer le moteur en Python serait le
 * meilleur moyen de valider une version et d'en livrer une autre.
 *
 *   npx tsx scripts/analyze.ts --batch dossier -o out.jsonl [--clubs labels.json]
 *                                                     → tout un corpus en un
 *                                                       seul processus
 *   npx tsx scripts/analyze.ts points.json            → rapport complet (JSON)
 *   npx tsx scripts/analyze.ts points.json --events   → uniquement les phases
 *   npx tsx scripts/analyze.ts points.json --metrics  → une valeur scalaire par règle
 *   npx tsx scripts/analyze.ts points.json --summary  → résumé lisible
 *
 * Format d'entrée attendu :
 *   { "fps": 60, "videoWidth": 1080, "videoHeight": 1920,
 *     "timestamps": [...],            // facultatif, déduit de fps sinon
 *     "frames": [ [ {x,y,z,visibility} × 33 ] | null, ... ] }
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeSequence } from '../src/core/report'
import { isReferenceProfile, type ReferenceProfile } from '../src/core/reference'
import { SWING_EVENTS, type ClubKind, type PoseSequence } from '../src/core/types'

const argv = process.argv.slice(2)

/** Corpus de référence, nécessaire au score par centiles. */
function loadReference(): ReferenceProfile | null {
  const i = argv.indexOf('--reference')
  if (i < 0 || !argv[i + 1]) return null
  const parsed: unknown = JSON.parse(readFileSync(argv[i + 1], 'utf8'))
  if (!isReferenceProfile(parsed)) throw new Error('profil de référence invalide')
  return parsed
}
const reference = loadReference()

/** Complète une séquence partielle lue depuis un fichier. */
function toSequence(raw: Partial<PoseSequence>): PoseSequence {
  if (!Array.isArray(raw.frames) || typeof raw.fps !== 'number') {
    throw new Error('« frames » (tableau) et « fps » (nombre) sont requis')
  }
  const fps = raw.fps
  return {
    frames: raw.frames,
    fps,
    timestamps: raw.timestamps ?? raw.frames.map((_, i) => i / fps),
    videoWidth: raw.videoWidth ?? 1080,
    videoHeight: raw.videoHeight ?? 1920,
    ball: raw.ball ?? null,
  }
}

/**
 * Mode corpus : un seul processus pour tout un dossier.
 *
 * Indispensable à l'échelle : lancer `npx tsx` une fois par clip coûte ~1,5 s
 * de démarrage, soit plus de 30 minutes de pur temps mort sur 1 400 clips —
 * davantage que l'analyse elle-même.
 */
if (argv[0] === '--batch') {
  const dir = argv[1]
  const outIndex = argv.indexOf('-o')
  const outPath = outIndex > 0 ? argv[outIndex + 1] : undefined
  if (!dir || !outPath) {
    console.error('Usage : npx tsx scripts/analyze.ts --batch <dossier> -o <sortie.jsonl> [--clubs labels.json]')
    process.exit(2)
  }

  // Analyser chaque clip avec SON club : sans cela, la validation d'un calage
  // par club mesurerait en réalité la bande commune.
  const clubsIndex = argv.indexOf('--clubs')
  const clubByClip = new Map<string, ClubKind>()
  if (clubsIndex > 0 && argv[clubsIndex + 1]) {
    const golfdbToKind: Record<string, ClubKind> = {
      driver: 'driver', fairway: 'wood', hybrid: 'wood', iron: 'iron', wedge: 'wedge',
    }
    const labels = JSON.parse(readFileSync(argv[clubsIndex + 1], 'utf8')) as {
      clips: Array<{ id: number | string; club?: string }>
    }
    for (const clip of labels.clips) {
      const kind = golfdbToKind[clip.club ?? '']
      if (kind) clubByClip.set(String(clip.id), kind)
    }
    console.error(`  clubs connus pour ${clubByClip.size} clips`)
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'corpus.json' && f !== 'labels.json')
    .sort()

  const lines: string[] = []
  let ok = 0
  let failed = 0

  for (const file of files) {
    const id = file.replace(/\.json$/, '')
    try {
      const sequence = toSequence(JSON.parse(readFileSync(join(dir, file), 'utf8')))
      const club = clubByClip.get(id) ?? 'unknown'
      const outcome = analyzeSequence(sequence, { club, reference })
      if (!outcome.ok) {
        failed++
        lines.push(JSON.stringify({ id, ok: false, error: outcome.error }))
        continue
      }
      const r = outcome.report
      const metrics: Record<string, number> = {}
      // La gravité est exportée avec la valeur : c'est elle qui permet de
      // mesurer le taux de déclenchement d'une règle sur un corpus de
      // référence — le diagnostic de calibration le plus direct qui soit.
      const severities: Record<string, string> = {}
      for (const fault of r.faults) {
        if (Number.isFinite(fault.value)) metrics[fault.id] = fault.value
        severities[fault.id] = fault.severity
      }
      ok++
      lines.push(
        JSON.stringify({
          id,
          ok: true,
          club,
          view: r.meta.view,
          impactSource: r.meta.impactSource,
          hasBall: r.meta.ball !== null,
          viewConfidence: r.meta.viewConfidence,
          handedness: r.meta.handedness,
          fps: r.meta.fps,
          poseCoverage: r.meta.quality.poseCoverage,
          meanVisibility: r.meta.quality.meanVisibility,
          downswingFrames: r.meta.quality.downswingFrames,
          footDrift: r.meta.quality.footDrift,
          eventConfidence: r.eventConfidence,
          events: r.events,
          outsideRange: r.summary.outsideRange,
          comparable: r.summary.comparable,
          medianPercentile: r.summary.medianPercentile,
          metrics,
          severities,
        }),
      )
    } catch (err) {
      failed++
      lines.push(JSON.stringify({ id, ok: false, error: String(err) }))
    }
    if ((ok + failed) % 100 === 0) {
      console.error(`  … ${ok + failed}/${files.length}`)
    }
  }

  writeFileSync(outPath, lines.join('\n') + '\n')
  console.error(`✓ ${ok} analysés, ${failed} en échec → ${outPath}`)
  process.exit(0)
}

const [path, ...flags] = argv
if (!path) {
  console.error('Usage : npx tsx scripts/analyze.ts <points.json> [--events|--metrics|--summary]')
  console.error('   ou : npx tsx scripts/analyze.ts --batch <dossier> -o <sortie.jsonl>')
  process.exit(2)
}

let sequence: PoseSequence
try {
  sequence = toSequence(JSON.parse(readFileSync(path, 'utf8')) as Partial<PoseSequence>)
} catch (err) {
  console.error(`Fichier invalide : ${err instanceof Error ? err.message : String(err)}`)
  process.exit(2)
}

const outcome = analyzeSequence(sequence, { reference })
if (!outcome.ok) {
  console.log(JSON.stringify({ ok: false, error: outcome.error, hint: outcome.hint }))
  process.exit(1)
}

const { report } = outcome

if (flags.includes('--metrics')) {
  // Chaque règle produit exactement un scalaire, dans une unité documentée.
  // C'est ce vecteur qu'on agrège sur un corpus pour bâtir un profil de
  // référence (cf. research/build_reference.py) : pas besoin d'un second
  // jeu de métriques à maintenir en parallèle des règles.
  const metrics: Record<string, number> = {}
  for (const fault of report.faults) {
    if (Number.isFinite(fault.value)) metrics[fault.id] = fault.value
  }
  console.log(
    JSON.stringify({
      ok: true,
      view: report.meta.view,
      viewConfidence: report.meta.viewConfidence,
      handedness: report.meta.handedness,
      fps: report.meta.fps,
      poseCoverage: report.meta.quality.poseCoverage,
      downswingFrames: report.meta.quality.downswingFrames,
      metrics,
    }),
  )
} else if (flags.includes('--events')) {
  console.log(JSON.stringify({ ok: true, events: report.events, eventConfidence: report.eventConfidence }))
} else if (flags.includes('--summary')) {
  console.log(`Vue        : ${report.meta.view} (${Math.round(report.meta.viewConfidence * 100)} %)`)
  console.log(`Latéralité : ${report.meta.handedness}`)
  console.log(`Cadence    : ${report.meta.fps.toFixed(1)} i/s sur ${report.meta.frameCount} images`)
  console.log(`Constat    : ${report.summary.outsideRange}/${report.summary.comparable} mesures hors plage pro` +
    (report.summary.medianPercentile !== null ? `, centile médian ${report.summary.medianPercentile}e` : ''))
  console.log(`Couverture : ${report.coverage.evaluated}/${report.coverage.total} règles évaluées`)
  console.log('Phases     :')
  for (const name of SWING_EVENTS) {
    console.log(`  ${name.padEnd(18)} image ${String(report.events[name]).padStart(4)}  (fiabilité ${Math.round(report.eventConfidence[name] * 100)} %)`)
  }
  const detected = report.faults.filter((f) => f.detected)
  console.log(`Défauts détectés (${detected.length}) :`)
  for (const f of detected) {
    console.log(`  [${f.severity}] ${f.label} — ${f.value} ${f.unit} (seuil ${f.threshold})`)
  }
  if (report.notEvaluated.length > 0) {
    console.log(`Non évaluables (${report.notEvaluated.length}) : ${report.notEvaluated.map((x) => x.id).join(', ')}`)
  }
  for (const w of report.meta.warnings) console.log(`Avertissement : ${w}`)
} else {
  // Les séries temporelles sont volumineuses : exclues par défaut.
  const { metrics: _metrics, ...rest } = report
  console.log(JSON.stringify({ ok: true, ...rest }, null, 2))
}
