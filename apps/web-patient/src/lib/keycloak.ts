/**
 * Keycloak para la app del paciente.
 *
 * Mismo planteamiento que en la app profesional —cliente público con
 * PKCE S256, init() una sola vez— con una diferencia de fondo:
 *
 * `onLoad` es 'check-sso', no 'login-required'. La pantalla de
 * activación tiene que poder mostrarse a alguien que TODAVÍA no tiene
 * cuenta: con 'login-required', abrir el enlace de invitación mandaría
 * al paciente a un formulario de acceso antes de explicarle qué es esto
 * ni quién le invita.
 */
import Keycloak from 'keycloak-js'

function requerida(nombre: keyof ImportMetaEnv): string {
  const valor = import.meta.env[nombre]
  if (!valor) {
    throw new Error(
      `Falta la variable ${nombre} en el .env de la raíz del repo. ` +
        `Vite solo expone las que empiezan por VITE_.`,
    )
  }
  return valor
}

export const keycloak = new Keycloak({
  url: requerida('VITE_KEYCLOAK_URL'),
  realm: requerida('VITE_KEYCLOAK_REALM'),
  clientId: requerida('VITE_KEYCLOAK_CLIENT_ID_PACIENTE'),
})

let inicializacion: Promise<boolean> | null = null

export function initKeycloak(): Promise<boolean> {
  inicializacion ??= keycloak.init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    checkLoginIframe: false,
  })
  return inicializacion
}

/**
 * Manda a crear cuenta. `action: 'register'` abre el formulario de
 * registro de Keycloak en vez del de acceso; es la misma redirección,
 * con PKCE, y al volver keycloak-js canjea el código por el token.
 *
 * El token NUNCA viaja en la barra de direcciones. La especificación
 * proponía volver con `?jwt=…` y leerlo de la URL: eso deja una
 * credencial en el historial del navegador, en la cabecera Referer de
 * cualquier recurso externo y en los registros de todo lo que haya por
 * el camino. Con el flujo de código de autorización solo viaja un
 * código de un solo uso, inútil sin el verificador que se quedó en el
 * navegador.
 */
export function registrarse(volverA: string): void {
  void keycloak.login({ action: 'register', redirectUri: volverA })
}

export function entrar(volverA: string): void {
  void keycloak.login({ redirectUri: volverA })
}

export function salir(): void {
  void keycloak.logout({ redirectUri: `${window.location.origin}/activar` })
}

/** Token vigente, refrescado si le quedan menos de 30 s. */
export async function tokenVigente(): Promise<string> {
  await keycloak.updateToken(30)
  if (!keycloak.token) throw new Error('Keycloak no devolvió token')
  return keycloak.token
}
