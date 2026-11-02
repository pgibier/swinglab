#!/usr/bin/env tsx
/**
 * Exécute le moteur d'analyse sur un fichier de points clés, en ligne de commande.
 *
 * C'est le pont entre l'atelier Python (../research) et le moteur TypeScript :
 * une seule implémentation des règles, utilisée aussi bien par l'application
 * que par les scripts de validation. Dupliquer le moteur en Python serait le
 * meilleur moyen de valider une version et d'en livrer une autre.
 *
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

import { readFileSync } from 'node:fs'
import { analyzeSequence } from '../src/core/report'
import { SWING_EVENTS, type PoseSequence } from '../src/core/types'

const [path, ...flags] = process.argv.slice(2)
if (!path) {
  console.error('Usage : npx tsx scripts/analyze.ts <points.json> [--events|--summary]')
  process.exit(2)
}

const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<PoseSequence>
if (!Array.isArray(raw.frames) || typeof raw.fps !== 'number') {
  console.error('Fichier invalide : « frames » (tableau) et « fps » (nombre) sont requis.')
  process.exit(2)
}

const sequence: PoseSequence = {
  frames: raw.frames,
  fps: raw.fps,
  timestamps: raw.timestamps ?? raw.frames.map((_, i) => i / raw.fps!),
  videoWidth: raw.videoWidth ?? 1080,
  videoHeight: raw.videoHeight ?? 1920,
}

const outcome = analyzeSequence(sequence)
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
  console.log(`Score      : ${report.score}/100`)
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
