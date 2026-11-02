#!/usr/bin/env node
/**
 * Prépare les fichiers statiques de MediaPipe dans public/.
 *
 *   node scripts/setup-assets.mjs            → copie le runtime WASM
 *   node scripts/setup-assets.mjs --models   → télécharge aussi les modèles
 *
 * Objectif : faire fonctionner l'app hors-ligne (PWA) et ne dépendre d'aucun
 * CDN tiers en production. Les modèles .task ne sont pas versionnés (cf.
 * .gitignore) car ils pèsent de 5 à 29 Mo.
 */

import { cp, mkdir, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const publicDir = join(root, 'public')

const VARIANTS = {
  lite: 'pose_landmarker_lite',
  full: 'pose_landmarker_full',
  heavy: 'pose_landmarker_heavy',
}

/**
 * Le paquet n'exporte pas son package.json : on passe par l'entrée principale
 * et on remonte, avec le chemin node_modules en secours.
 */
function tasksVisionDir() {
  try {
    return dirname(require.resolve('@mediapipe/tasks-vision'))
  } catch {
    return join(root, 'node_modules', '@mediapipe', 'tasks-vision')
  }
}

async function copyWasm() {
  const src = join(tasksVisionDir(), 'wasm')
  const dest = join(publicDir, 'wasm')
  await mkdir(dest, { recursive: true })
  await cp(src, dest, { recursive: true })
  console.log(`✓ runtime WASM copié → public/wasm`)
}

async function downloadModel(variant) {
  const name = VARIANTS[variant]
  const url = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${name}/float16/latest/${name}.task`
  const dest = join(publicDir, 'models', `${name}.task`)
  await mkdir(join(publicDir, 'models'), { recursive: true })
  try {
    const existing = await stat(dest)
    if (existing.size > 1_000_000) {
      console.log(`· ${name} déjà présent (${(existing.size / 1e6).toFixed(1)} Mo)`)
      return
    }
  } catch {
    // absent : on télécharge
  }
  console.log(`↓ ${name}…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${name} : HTTP ${res.status}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
  const s = await stat(dest)
  console.log(`✓ ${name} (${(s.size / 1e6).toFixed(1)} Mo)`)
}

const args = process.argv.slice(2)
await copyWasm()
if (args.includes('--models')) {
  const requested = args.filter((a) => a in VARIANTS)
  for (const v of requested.length ? requested : ['lite', 'full']) {
    await downloadModel(v)
  }
} else {
  console.log('· modèles non téléchargés (chargés depuis le CDN Google au runtime).')
  console.log('  Pour le mode hors-ligne : npm run setup:assets -- --models')
}
