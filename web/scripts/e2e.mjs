#!/usr/bin/env node
/**
 * Test de bout en bout dans un vrai navigateur.
 *
 * Vérifie ce que les tests Node ne peuvent pas couvrir :
 *   1. l'écran d'accueil s'affiche ;
 *   2. le moteur donne le même résultat dans le navigateur que dans Node
 *      (importé depuis le serveur de dev, sur un swing synthétique) ;
 *   3. la chaîne réelle tourne : runtime WASM chargé, modèle chargé, vidéo
 *      décodée, parcourue image par image, inférence MediaPipe exécutée ;
 *   4. selon la vidéo fournie : soit le rapport complet s'affiche (vidéo avec
 *      un joueur), soit le chemin d'erreur est explicite (vidéo sans joueur).
 *      Passe une vidéo contenant réellement quelqu'un, filmée de face ou dans
 *      l'axe, pour couvrir le premier cas : une mire de test ne vérifie que le
 *      second, et un angle non identifiable fait sauter les règles propres à
 *      une vue, donc la comparaison au corpus.
 *
 * Prérequis (volontairement hors dépendances du projet, pour ne pas imposer
 * ~300 Mo à l'installation) :
 *     npm i -D playwright && npx playwright install chromium
 *
 * Usage :  node scripts/e2e.mjs <chemin-video.mp4>
 */

import { spawn, execFileSync } from 'node:child_process'
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

// Référence calculée par Node à l'instant : le test compare les deux
// environnements entre eux, plutôt que des valeurs figées qui se périment à
// chaque évolution du détecteur.
const nodeReference = JSON.parse(
  execFileSync(
    'npx',
    ['tsx', '-e', `
      import { analyzeSequence } from './src/core/report'
      import { synthSwing } from './scripts/synth'
      const clean = analyzeSequence(synthSwing({ view: 'face_on' }))
      const swayed = analyzeSequence(synthSwing({ view: 'face_on', swayU: 0.3 }))
      if (!clean.ok || !swayed.ok) throw new Error('analyse refusée côté Node')
      console.log(JSON.stringify({
        view: clean.report.meta.view,
        handedness: clean.report.meta.handedness,
        events: clean.report.events,
        summary: clean.report.summary,
        values: clean.report.faults.map((f) => [f.id, Math.round(f.value * 1000)]),
        swaySeverity: swayed.report.faults.find((f) => f.id === 'sway')?.severity,
      }))
    `],
    { cwd: process.cwd(), encoding: 'utf8' },
  ).trim().split('\n').pop(),
)

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
    summary: clean.report.summary,
    values: clean.report.faults.map((f) => [f.id, Math.round(f.value * 1000)]),
    swaySeverity: swayed.report.faults.find((f) => f.id === 'sway')?.severity,
    hasScore: 'score' in clean.report,
  }
})
check('moteur importable et exécutable dans le navigateur', !engineResult.error, engineResult.error)
check('même vue détectée que dans Node', engineResult.view === nodeReference.view, engineResult.view)
check('même latéralité détectée', engineResult.handedness === nodeReference.handedness, engineResult.handedness)
check(
  'mêmes frames pour les 8 phases que dans Node',
  JSON.stringify(engineResult.events) === JSON.stringify(nodeReference.events),
  `navigateur ${JSON.stringify(engineResult.events)} vs node ${JSON.stringify(nodeReference.events)}`,
)
check(
  'mêmes valeurs mesurées que dans Node',
  JSON.stringify(engineResult.values) === JSON.stringify(nodeReference.values),
  `navigateur ${JSON.stringify(engineResult.values)} vs node ${JSON.stringify(nodeReference.values)}`,
)
check(
  'même constat que dans Node',
  JSON.stringify(engineResult.summary) === JSON.stringify(nodeReference.summary),
  `${JSON.stringify(engineResult.summary)} vs ${JSON.stringify(nodeReference.summary)}`,
)
// Garde-fou : la note a été retirée parce qu'elle ne séparait pas un débutant
// d'un professionnel. Si un `score` réapparaît, ce test doit le signaler plutôt
// que de comparer silencieusement undefined à undefined, comme il le faisait.
check('le rapport ne porte pas de note', engineResult.hasScore === false)
check('sway détecté comme important', engineResult.swaySeverity === 'major', engineResult.swaySeverity)
check('sway jugé pareil que dans Node', engineResult.swaySeverity === nodeReference.swaySeverity)

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
const REPORT_MARKER = 'text=Ce que cette analyse ne mesure pas'
/*
 * Délai large et assumé. Quand l'appareil ne suit pas, la capture par lecture
 * descend jusqu'à 1/16 de la vitesse réelle : une vidéo de dix secondes prend
 * alors plus de deux minutes. Un navigateur sans accélération matérielle, dans
 * un conteneur, y descend systématiquement. Un délai trop court ferait passer
 * cette lenteur pour une panne.
 */
const ANALYSIS_TIMEOUT = 420_000
const outcome = await Promise.race([
  page.waitForSelector(REPORT_MARKER, { timeout: ANALYSIS_TIMEOUT }).then(() => 'report'),
  page.waitForSelector('text=Réessayer', { timeout: ANALYSIS_TIMEOUT }).then(() => 'error'),
]).catch(() => 'timeout')
check('analyse terminée dans le délai imparti', outcome !== 'timeout',
  `aucun rapport ni message d'erreur après ${ANALYSIS_TIMEOUT / 1000} s`)
const bodyText = await page.textContent('body')

check('runtime WASM chargé localement', requests.some((r) => r.startsWith('200') && r.includes('wasm')),
  requests.join(' | '))
check('modèle de pose chargé', requests.some((r) => r.includes('.task')), requests.join(' | '))

if (outcome === 'error') {
  check('chemin d’erreur explicite quand aucun joueur n’est détecté',
    /n’est détecté que sur|pas lisible|trop courte/.test(bodyText), bodyText.slice(0, 200))
  console.log('     (attendu : la vidéo de test ne contient aucune personne)')
} else {
  check('rapport affiché sur une vraie vidéo', /Ce que cette analyse ne mesure pas/.test(bodyText))
  check('phases datées et affichées', /Adresse/.test(bodyText) && /Impact/.test(bodyText))
  check('aucune note affichée', !/Score indicatif|\/ ?100\b/.test(bodyText),
    bodyText.slice(0, 200))
  // Exige que la vidéo fournie ait un angle de prise de vue identifiable :
  // sans cela le moteur refuse — à raison — d'appliquer les règles propres à
  // une vue, et il n'y a plus rien à comparer au corpus.
  check(
    'constat chiffré contre le corpus de pros',
    /hors de la plage des pros|Aucune mesure hors de la plage/.test(bodyText),
    bodyText.replace(/\s+/g, ' ').slice(0, 400),
  )
}

await page.screenshot({ path: 'scripts/.e2e-last.png', fullPage: true })

console.log('\n[4] Deuxième vidéo dans la même session')
// Régression : MediaPipe refuse en mode VIDEO tout horodatage inférieur au
// précédent sur la durée de vie du détecteur. Réutiliser l'instance d'une
// vidéo à l'autre cassait silencieusement la seconde analyse — invisible
// pour un test qui n'en charge qu'une.
const errorsBeforeSecond = consoleErrors.length
await page.click('text=Réessayer').catch(() => page.click('text=Nouvelle vidéo'))
// L'input est volontairement masqué (le bouton le déclenche) : on attend
// qu'il soit présent dans le DOM, pas visible.
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 15_000 })
await page.setInputFiles('input[type=file]', videoPath)
await page.waitForSelector('text=Détection des points du corps', { timeout: 60_000 })
const secondOutcome = await Promise.race([
  page.waitForSelector(REPORT_MARKER, { timeout: ANALYSIS_TIMEOUT }).then(() => 'report'),
  page.waitForSelector('text=Réessayer', { timeout: ANALYSIS_TIMEOUT }).then(() => 'error'),
]).catch(() => 'timeout')
check('la deuxième analyse aboutit comme la première', secondOutcome === outcome,
  `${secondOutcome} vs ${outcome}`)
const newErrors = consoleErrors.slice(errorsBeforeSecond)
check('aucune erreur MediaPipe au second passage',
  !newErrors.some((e) => /timestamp|INVALID_ARGUMENT|Graph has errors/i.test(e)),
  newErrors.slice(0, 2).join(' | '))

console.log('\n[5] Console navigateur')
const realErrors = consoleErrors.filter(
  (e) => !/favicon|Failed to load resource.*favicon/i.test(e),
)
check('aucune erreur JavaScript', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await browser.close()
stop()
console.log(`\n${failures === 0 ? '✓ E2E OK' : '✗ E2E ÉCHECS'} — ${failures} échec(s)\n`)
exit(failures === 0 ? 0 : 1)
