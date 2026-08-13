import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El cliente nutrismart-web de Keycloak tiene registrado
    // http://localhost:5173/* como redirectUri. Si Vite cambia de puerto
    // al estar ocupado, el login falla con "Invalid redirect_uri", asi
    // que preferimos que avise en vez de moverse solo.
    strictPort: true,
  },
  // El .env vive en la raiz del repo, no en apps/web-professional.
  // Vite solo expone al navegador las variables con prefijo VITE_.
  envDir: resolve(__dirname, '../..'),
})
