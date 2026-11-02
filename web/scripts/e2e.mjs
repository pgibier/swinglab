#!/usr/bin/env node
/**
 * Test de bout en bout dans un vrai navigateur.
 *
 * Vérifie ce que les tests Node ne peuvent pas couvrir :
 *   1. l'écran d'accueil s'affiche ;
 *   2. le moteur donne le même résultat dans le navigateur que dans Node
 *      (importé depuis le serveur de dev, sur un swing synthétique) ;
 *   3. la chaîne réelle tourne : runtime WASM chargé, modèle chargé, vidéo
 *      décodée, parcours par seek, inférence MediaPipe exécutée ;
 *   4. le chemin d'erreur s'affiche correctement quand aucun joueur n'est
 *      détecté dans la vidéo.
 *
 * Prérequis (volontairement hors dépendances du projet, pour ne pas imposer
 * ~300 Mo à l'installation) :
 *     npm i -D playwright && npx playwright install chromium
 *
 * Usage :  node scripts/e2e.mjs <chemin-video.mp4>
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { argv, exit } from 'node:process'

const require = createRequire(import.meta.url)
let chromium
try {
  ;({ chromium } = require('playwright'))
} catch {
  console.error('Playwright absent. Installe-le : npm i -D playwright && npx playwright install chromium')
  exit(2)
}

const videoPath = argv[2]
if (!videoPath) {
  console.error('Usage : node scripts/e2e.mjs <chemin-video.mp4>')
  exit(2)
}

const PORT = 5179
let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
const stop = () => {
  try {
    server.kill('SIGTERM')
  } catch {
    /* déjà arrêté */
  }
}
process.on('exit', stop)

// Attend que le serveur de dev réponde.
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('serveur de dev trop lent')), 60_000)
  const onData = (buf) => {
    if (buf.toString().includes('ready in') || buf.toString().includes('Local:')) {
      clearTimeout(timer)
      resolve()
    }
  }
  server.stdout.on('data', onData)
  server.stderr.on('data', onData)
})
await new Promise((r) => setTimeout(r, 1200))

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--headless', '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 420, height: 900 } })

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))

console.log('\n[1] Écran d’accueil')
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
check('titre affiché', (await page.textContent('h1'))?.includes('Filme ton swing'))
check('bouton d’import présent', await page.isVisible('text=Choisir une vidéo'))

console.log('\n[2] Moteur exécuté dans le navigateur (swing synthétique)')
const engineResult = await page.evaluate(async () => {
  const [{ analyzeSequence }, { synthSwing }] = await Promise.all([
    import('/src/core/index.ts'),
    import('/scripts/synth.ts'),
  ])
  const clean = analyzeSequence(synthSwing({ view: 'face_on' }))
  const swayed = analyzeSequence(synthSwing({ view: 'face_on', swayU: 0.3 }))
  if (!clean.ok || !swayed.ok) return { error: 'analyse refusée' }
  return {
    view: clean.report.meta.view,
    handedness: clean.report.meta.handedness,
    events: clean.report.events,
    cleanScore: clean.report.score,
    swaySeverity: swayed.report.faults.find((f) => f.id === 'sway')?.severity,
  }
})
check('moteur importable et exécutable dans le navigateur', !engineResult.error, engineResult.error)
check('même vue détectée que dans Node', engineResult.view === 'face_on', engineResult.view)
check('même latéralité détectée', engineResult.handedness === 'right', engineResult.handedness)
check('mêmes frames de sommet/impact', engineResult.events?.top === 74 && engineResult.events?.impact === 90,
  JSON.stringify(engineResult.events))
check('swing propre noté 100', engineResult.cleanScore === 100, String(engineResult.cleanScore))
check('sway détecté comme important', engineResult.swaySeverity === 'major', engineResult.swaySeverity)

console.log('\n[3] Chaîne réelle : WASM, modèle, décodage, seek, inférence')
const requests = []
page.on('response', (r) => {
  const u = r.url()
  if (u.includes('.wasm') || u.includes('.task')) requests.push(`${r.status()} ${u.split('/').pop()}`)
})
await page.setInputFiles('input[type=file]', videoPath)
await page.waitForSelector('text=Détection des points du corps', { timeout: 60_000 })
check('progression affichée pendant l’extraction', true)

// Fin de traitement : rapport, ou message d'erreur attendu sur une vidéo sans joueur.
const outcome = await Promise.race([
  page.waitForSelector('text=À travailler en priorité', { timeout: 180_000 }).then(() => 'report'),
  page.waitForSelector('text=Réessayer', { timeout: 180_000 }).then(() => 'error'),
])
const bodyText = await page.textContent('body')

check('runtime WASM chargé localement', requests.some((r) => r.startsWith('200') && r.includes('wasm')),
  requests.join(' | '))
check('modèle de pose chargé', requests.some((r) => r.includes('.task')), requests.join(' | '))

if (outcome === 'error') {
  check('chemin d’erreur explicite quand aucun joueur n’est détecté',
    /n’est détecté que sur|pas lisible|trop courte/.test(bodyText), bodyText.slice(0, 200))
  console.log('     (attendu : la vidéo de test ne contient aucune personne)')
} else {
  check('rapport affiché', /Score indicatif|À travailler/.test(bodyText))
}

await page.screenshot({ path: 'scripts/.e2e-last.png', fullPage: true })

console.log('\n[4] Console navigateur')
const realErrors = consoleErrors.filter(
  (e) => !/favicon|Failed to load resource.*favicon/i.test(e),
)
check('aucune erreur JavaScript', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await browser.close()
stop()
console.log(`\n${failures === 0 ? '✓ E2E OK' : '✗ E2E ÉCHECS'} — ${failures} échec(s)\n`)
exit(failures === 0 ? 0 : 1)
