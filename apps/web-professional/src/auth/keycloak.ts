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
  clientId: requerida('VITE_KEYCLOAK_CLIENT_ID'),
})

let inicializacion: Promise<boolean> | null = null

/**
 * A donde vuelve Keycloak: la ruta actual, SIN query ni fragmento.
 *
 * Por defecto keycloak-js usa `window.location.href` entero. Al volver
 * del login la URL trae `#state=…&code=…&session_state=…`; si esa vuelta
 * no se completa y se pide login otra vez, el nuevo `redirect_uri` es la
 * URL con ese fragmento pegado, y la siguiente le pega otro. La direccion
 * crece en cada ciclo.
 *
 * Cuando pasa de 4000 caracteres Keycloak la descarta —"the size of OIDC
 * parameter 'redirect_uri' is longer than allowed"— y responde
 * `invalid_redirect_uri`. Lo que se ve es la pantalla parpadeando y, al
 * final, "Invalid parameter: redirect_uri".
 *
 * Recortandola a origen + ruta, no puede crecer: cada intento manda
 * exactamente lo mismo.
 */
function destinoLimpio(): string {
  const ruta = window.location.pathname
  // Tope de seguridad. Si la ruta viene desmesurada —una URL heredada de
  // un ciclo anterior, una sesion restaurada por el navegador— se vuelve
  // a la raiz. Mas vale perder el enlace profundo que mandar una
  // direccion que Keycloak va a descartar por larga.
  const segura = ruta.length > 200 || ruta.includes('#') ? '/' : ruta
  return `${window.location.origin}${segura}`
}

// NO limpiar aqui sessionStorage ni reescribir la URL antes de init().
//
// Se intento y provoco un bucle: keycloak-js usa `response_mode=query`,
// asi que la vuelta del login llega como `?state=…&code=…` y NO en el
// fragmento. Una limpieza que solo mire el fragmento borra el
// `kc-callback-…` y quita los parametros justo antes de que keycloak-js
// los lea; init() no encuentra la respuesta, se cree no autenticado,
// vuelve a pedir login, y asi indefinidamente.
//
// Quien tiene que consumir esa vuelta es keycloak-js, y ya la limpia el
// solo cuando termina.

/**
 * `check-sso` y no `login-required` (LOGIN-01).
 *
 * Con `login-required`, Keycloak se lleva al usuario a su propia
 * pantalla antes de que el navegador pinte nada: no hay ocasion de
 * ensenar una pantalla propia con la marca de la clinica.
 *
 * Con `check-sso` la aplicacion arranca, comprueba en un iframe oculto
 * —`silent-check-sso.html`— si ya hay sesion, y solo si no la hay pinta
 * su pantalla de acceso.
 *
 * ── El caso que hay que tener presente ──────────────────────────────
 *
 * Esa comprobacion silenciosa usa cookies de terceros. Safari las
 * bloquea por defecto y algunos navegadores tambien: ahi el iframe
 * termina sin sesion aunque el usuario la tenga, y vera la pantalla de
 * acceso otra vez. Pulsar el boton lo resuelve —Keycloak reconoce su
 * sesion y vuelve sin pedir contrasena— pero conviene saberlo antes de
 * que alguien lo reporte como fallo.
 */
export function initKeycloak(): Promise<boolean> {
  inicializacion ??= keycloak.init({
    onLoad: 'check-sso',
    silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    pkceMethod: 'S256',
    redirectUri: destinoLimpio(),
    // El iframe de comprobacion de sesion da problemas con navegadores
    // que bloquean cookies de terceros; el refresco por updateToken()
    // cubre lo que necesitamos. Es OTRO iframe distinto del de arriba:
    // este vigila la sesion en segundo plano, aquel solo se usa una vez
    // al arrancar.
    checkLoginIframe: false,
  })
  return inicializacion
}

/** Manda a la pantalla de Keycloak. Lo llama el boton de la pantalla propia. */
export function entrar(): void {
  void keycloak.login({ redirectUri: destinoLimpio() })
}

/**
 * Devuelve un token vigente, refrescandolo si le quedan menos de 30s.
 * Si el refresco falla, la sesion murio: se manda al login.
 *
 * ── Por que la primera comprobacion ─────────────────────────────────
 *
 * Si alguien llama a la API antes de que Keycloak este inicializado,
 * `updateToken` falla — y mandar al login desde ahi convierte un error
 * de orden en un BUCLE: se pide un dato, la peticion redirige al login,
 * Keycloak devuelve al usuario, la pagina monta, se vuelve a pedir el
 * dato. Varias vueltas por segundo, y ni un error en los registros
 * porque cada login es correcto.
 *
 * Paso de verdad al anadir `useYo()` en la Rebanada 28 sin esperar a que
 * hubiera sesion. Con esta guarda, el mismo descuido produce un error
 * visible en vez de una aplicacion que parpadea.
 */
export async function tokenVigente(): Promise<string> {
  if (!keycloak.authenticated) {
    throw new Error(
      'Se pidio un dato a la API antes de que la sesion estuviera lista. ' +
        'Espera a que el estado de autenticacion sea "autenticado".',
    )
  }
  try {
    await keycloak.updateToken(30)
  } catch {
    // Mismo destino limpio que en init: si la sesion muere estando en
    // una URL que ya trae fragmento, sin esto se vuelve a arrancar el
    // ciclo que hace crecer la direccion.
    await keycloak.login({ redirectUri: destinoLimpio() })
    throw new Error('Sesion expirada, redirigiendo al login')
  }

  if (!keycloak.token) throw new Error('Keycloak no devolvio token')
  return keycloak.token
}
