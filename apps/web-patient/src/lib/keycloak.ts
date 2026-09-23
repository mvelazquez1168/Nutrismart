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

/**
 * URL de Keycloak.
 *
 * Si `VITE_KEYCLOAK_URL` viene vacia se usa el ORIGEN de la propia
 * aplicacion, contando con que el servidor de desarrollo reenvia
 * `/realms` a Keycloak (ver el proxy en vite.config.ts). Es lo que
 * permite probar en un movil sin abrir el puerto 8080 ni pelearse con
 * quien mas lo ocupe en la maquina.
 *
 * En el contenedor la variable si trae valor, y manda ese.
 */
function urlKeycloak(): string {
  const v = import.meta.env.VITE_KEYCLOAK_URL
  return v && v.trim() !== '' ? v : window.location.origin
}

export const keycloak = new Keycloak({
  url: urlKeycloak(),
  realm: requerida('VITE_KEYCLOAK_REALM'),
  clientId: requerida('VITE_KEYCLOAK_CLIENT_ID_PACIENTE'),
})

let inicializacion: Promise<boolean> | null = null

/**
 * A donde vuelve Keycloak: la ruta actual, SIN query ni fragmento.
 *
 * Por defecto keycloak-js usa `window.location.href` entero. Al volver
 * del login la URL trae `#state=…&code=…`; si esa vuelta no se completa
 * y se pide login otra vez, el nuevo `redirect_uri` lleva ese fragmento
 * pegado, y el siguiente otro. La direccion crece en cada ciclo hasta
 * pasar de 4000 caracteres, y entonces Keycloak la descarta y responde
 * `invalid_redirect_uri`.
 *
 * Aqui `onLoad` es 'check-sso' y no 'login-required', asi que el ciclo
 * es menos probable — pero `entrar()` y `registrarse()` reciben la URL
 * desde cada pantalla, y esas si pueden traer fragmento.
 */
function limpia(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return `${window.location.origin}${window.location.pathname}`
  }
}

export function initKeycloak(): Promise<boolean> {
  inicializacion ??= keycloak.init({
    onLoad: 'check-sso',
    // Comprobacion en iframe oculto: sin esto, `check-sso` hace una
    // redireccion completa a Keycloak y se ve el parpadeo. Con ella, la
    // pantalla de activacion se pinta directamente.
    //
    // Aviso: usa cookies de terceros, que Safari bloquea. Ahi el iframe
    // acaba sin sesion aunque exista, y el paciente vera el boton de
    // entrar; pulsarlo lo resuelve sin pedirle la contrasena otra vez.
    silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    pkceMethod: 'S256',
    redirectUri: limpia(window.location.href),
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
  void keycloak.login({ action: 'register', redirectUri: limpia(volverA) })
}

export function entrar(volverA: string): void {
  void keycloak.login({ redirectUri: limpia(volverA) })
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
