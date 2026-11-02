import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Les modèles MediaPipe (.task) et le runtime WASM sont servis depuis /public,
  // jamais depuis un CDN tiers : l'app doit fonctionner hors-ligne (PWA).
  worker: { format: 'es' },
})
