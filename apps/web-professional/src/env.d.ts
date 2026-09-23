/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_KEYCLOAK_URL: string
  readonly VITE_KEYCLOAK_REALM: string
  readonly VITE_KEYCLOAK_CLIENT_ID: string
  /** Imagen del panel de la pantalla de acceso. Vacía = color sólido. */
  readonly VITE_LOGIN_IMAGE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
