import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  // El .env vive en la raiz del repo, como en la app profesional: una
  // sola copia de la configuracion para las dos aplicaciones.
  envDir: resolve(__dirname, '../..'),
  server: {
    port: 5175,
    // Accesible desde la red local para probarla en un movil de verdad,
    // que es donde va a vivir esta aplicacion.
    host: true,
  },
})
