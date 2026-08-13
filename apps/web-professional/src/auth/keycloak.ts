/**
 * Instancia unica de Keycloak.
 *
 * Dos cosas importan aqui:
 *
 * 1. PKCE S256. El cliente nutrismart-web es publico (no tiene secreto,
 *    porque cualquier cosa embebida en un bundle es publica). PKCE es lo
 *    que evita que alguien intercepte el codigo de autorizacion.
 *
 * 2. init() se llama UNA sola vez. React StrictMode ejecuta los efectos
 *    dos veces en desarrollo, y un segundo init() sobre la misma
 *    instancia lanza "A 'Keycloak' instance can only be initialized
 *    once". Guardamos la promesa a nivel de modulo y reutilizamos.
 */
import Keycloak from 'keycloak-js'

function requerida(nombre: keyof ImportMetaEnv): string {
  const valor = import.meta.env[nombre]
  if (!valor) {
    throw new Error(
      `Falta la variable ${nombre} en el .env de la raiz del repo. ` +
        `Recuerda que Vite solo expone las que empiezan por VITE_.`,
    )
  }
  return valor
}

export const keycloak = new Keycloak({
  url: requerida('VITE_KEYCLOAK_URL'),
  realm: requerida('VITE_KEYCLOAK_REALM'),
  clientId: requerida('VITE_KEYCLOAK_CLIENT_ID'),
})

let inicializacion: Promise<boolean> | null = null

export function initKeycloak(): Promise<boolean> {
  inicializacion ??= keycloak.init({
    onLoad: 'login-required',
    pkceMethod: 'S256',
    // El iframe de comprobacion de sesion da problemas con navegadores
    // que bloquean cookies de terceros; el refresco por updateToken()
    // cubre lo que necesitamos.
    checkLoginIframe: false,
  })
  return inicializacion
}

/**
 * Devuelve un token vigente, refrescandolo si le quedan menos de 30s.
 * Si el refresco falla, la sesion murio: se manda al login.
 */
export async function tokenVigente(): Promise<string> {
  try {
    await keycloak.updateToken(30)
  } catch {
    await keycloak.login()
    throw new Error('Sesion expirada, redirigiendo al login')
  }

  if (!keycloak.token) throw new Error('Keycloak no devolvio token')
  return keycloak.token
}
