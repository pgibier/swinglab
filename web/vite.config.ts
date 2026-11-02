import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  /**
   * Chemin de base du site.
   * Sur GitHub Pages, un site de projet est servi depuis /<nom-du-repo>/ :
   * le workflow de déploiement renseigne BASE_PATH. En local, la racine.
   */
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  // Les modèles MediaPipe (.task) et le runtime WASM sont servis depuis /public,
  // jamais depuis un CDN tiers : l'app doit fonctionner hors-ligne (PWA).
  worker: { format: 'es' },
})
