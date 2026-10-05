/**
 * Configuracion de la API.
 *
 * Se valida AL ARRANCAR, no al usarla. Con auth multi-tenant una variable
 * vacia no produce un error legible: produce un 401 inexplicable o, peor,
 * una query sin filtro de tenant. Preferimos que el proceso no levante.
 */
import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// El .env vive en la raiz del repo, pero el proceso arranca en apps/api.
// Dentro de Docker no existe ese archivo y no pasa nada: las variables
// llegan por env_file/environment y dotenv nunca pisa lo ya definido.
const here = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(here, '../../../.env') })

const missing: string[] = []

function required(name: string): string {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') {
    missing.push(name)
    return ''
  }
  return raw.trim()
}

function optional(name: string): string | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  return raw.trim()
}

function optionalPort(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    missing.push(`${name} (debe ser un puerto valido, llego "${raw}")`)
    return fallback
  }
  return n
}

const databaseUrl = required('DATABASE_URL')

// Service account para el Keycloak Admin API.
// KEYCLOAK_ADMIN_URL es la URL interna de Keycloak (http://keycloak:8080).
// KEYCLOAK_REALM es el realm donde viven los usuarios (nutrismart).
// El service account debe tener el rol manage-users de realm-management.
const keycloakAdminUrl = optional('KEYCLOAK_ADMIN_URL') ?? 'http://keycloak:8080'
const keycloakRealm = optional('KEYCLOAK_REALM') ?? 'nutrismart'
const keycloakSvcClientId = optional('KEYCLOAK_SVC_CLIENT') ?? ''
const keycloakSvcClientSecret = optional('KEYCLOAK_SVC_SECRET') ?? ''
/** true cuando el service account está configurado y la API puede crear usuarios en Keycloak. */
const keycloakAdminEnabled = keycloakSvcClientId !== '' && keycloakSvcClientSecret !== ''
/**
 * Issuer(s) aceptados en el claim 'iss'.
 *
 * Admite una LISTA separada por comas, y no una sola cadena, por un caso
 * concreto: al probar en un movil de la red local, el telefono se
 * autentica contra `http://192.168.x.x:8080` y Keycloak firma el token
 * con ESE issuer. Con un unico valor esperado, todas las peticiones del
 * telefono devolverian 401 — y el motivo no aparece en ninguna pantalla.
 *
 * `jose` acepta un array y exige coincidencia exacta con alguno de los
 * valores. Sigue siendo una comparacion literal: no se relaja nada, solo
 * se admite mas de un origen legitimo.
 */
const issuer = required('KEYCLOAK_ISSUER')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s !== '')
const jwksUrl = required('KEYCLOAK_JWKS_URL')
const audience = required('KEYCLOAK_AUDIENCE')
const apiPort = optionalPort('API_PORT', 4000)
const nodeEnv = process.env['NODE_ENV']?.trim() || 'development'
const frontendProUrl = optional('FRONTEND_PRO_URL') ?? 'http://localhost:5173'
// La app del paciente vive en OTRO puerto (5174 lo ocupa vetplatform).
// Sin este origen el navegador bloquea todas sus peticiones y la app
// dice "no hay conexion con el servidor" teniendo la API delante.
const frontendPacUrl = optional('FRONTEND_PAC_URL') ?? 'http://localhost:5175'
// Los binarios no viven en Postgres: guardarlos como bytea infla cada
// copia de seguridad y cada replica. En Docker es un volumen montado.
const archivosDir = optional('ARCHIVOS_DIR') ?? resolve(here, '../../../datos/archivos')

// La IA es OPCIONAL a proposito. Si falta la clave, la plataforma
// arranca igual y solo las funciones de IA responden 503: la regla de
// oro dice que nunca se bloquea el acceso clinico por el estado del
// credito de IA, y arrancar sin clave es el mismo caso.
// App del paciente y correo saliente. Ambos opcionales: sin SMTP la
// invitacion se crea igual y el enlace sale por consola.
const pacAppUrl = optional('PAC_APP_URL') ?? 'http://localhost:5174'
// Resend para el correo saliente. Sin clave, la invitacion se crea
// igual y el enlace sale por consola.
//
// El remitente por defecto es el sandbox de Resend, que SOLO entrega a
// direcciones verificadas en la cuenta: sirve para probar entre nosotros
// y no para invitar a un paciente real. Para eso hace falta un dominio
// propio verificado — NutriSmart no puede usar el de Vetline.
const resendApiKey = optional('RESEND_API_KEY')
const resend = resendApiKey
  ? {
      apiKey: resendApiKey,
      from: optional('RESEND_FROM') ?? 'NutriSmart <onboarding@resend.dev>',
    }
  : undefined

/**
 * Integracion con pulseras y relojes (RPM-01). OPCIONAL, como la IA y el
 * correo.
 *
 * Las tres piezas tienen que estar para que funcione: sin cualquiera de
 * ellas la seccion responde 503 y explica que falta, pero **la API
 * arranca igual**. El encargo lanzaba una excepcion al cargar el modulo
 * de cifrado si faltaba la clave: eso tumba la API entera, y con ella el
 * acceso a expedientes y agenda, por una integracion accesoria.
 *
 * La clave son 32 bytes en hexadecimal (64 caracteres). Se genera con:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
const wearableKey = optional('WEARABLE_ENCRYPTION_KEY')
const fitbitId = optional('FITBIT_CLIENT_ID')
const fitbitSecret = optional('FITBIT_CLIENT_SECRET')
const googleFitId = optional('GOOGLE_FIT_CLIENT_ID')
const googleFitSecret = optional('GOOGLE_FIT_CLIENT_SECRET')
const withingsId = optional('WITHINGS_CLIENT_ID')
const withingsSecret = optional('WITHINGS_CLIENT_SECRET')
const appPublicUrl = optional('APP_PUBLIC_URL')

// Una clave mal copiada es peor que ninguna: cifraria y descifraria mal
// solo a veces. Se comprueba aqui, al arrancar, no al primer uso.
if (wearableKey !== undefined && !/^[0-9a-f]{64}$/i.test(wearableKey)) {
  throw new Error(
    'WEARABLE_ENCRYPTION_KEY debe ser 32 bytes en hexadecimal (64 caracteres). ' +
      'Generala con: node -e "console.log(require(`crypto`).randomBytes(32).toString(`hex`))"',
  )
}

const anthropicApiKey = optional('ANTHROPIC_API_KEY')
const anthropicModelo = optional('ANTHROPIC_MODELO') ?? 'claude-haiku-4-5'

// Se acumulan TODAS las que faltan y se reportan juntas: descubrirlas de
// una en una, reiniciando el proceso cada vez, es tiempo perdido.
if (missing.length > 0) {
  const lista = missing.map((m) => `  - ${m}`).join('\n')
  throw new Error(
    `Configuracion incompleta. Falta(n) ${missing.length} variable(s) de entorno:\n${lista}\n\n` +
      `Copia .env.example a .env en la raiz del repo y completalo.`,
  )
}

/** Un proveedor solo esta disponible si tiene sus dos credenciales. */
function proveedor(id: string | undefined, secreto: string | undefined) {
  return id && secreto ? { clientId: id, clientSecret: secreto } : null
}

export const config = {
  nodeEnv,
  isDev: nodeEnv !== 'production',
  pacAppUrl,
  resend,
  anthropicApiKey,
  anthropicModelo,
  iaHabilitada: anthropicApiKey !== undefined,
  apiPort,
  databaseUrl,
  /**
   * Origen del front profesional. Junto con `frontendPacUrl` forma la
   * lista CERRADA de origenes permitidos en CORS: un '*' seria
   * inaceptable en una API que responde datos clinicos con credenciales.
   */
  frontendProUrl,
  /** Origen del front del paciente. Va en la MISMA lista de CORS. */
  frontendPacUrl,
  /**
   * Wearables. `null` en cualquiera de sus partes = esa parte no esta
   * configurada, y las rutas responden 503 diciendo cual falta.
   */
  wearables: {
    claveCifrado: wearableKey ?? null,
    fitbit: proveedor(fitbitId, fitbitSecret),
    googleFit: proveedor(googleFitId, googleFitSecret),
    withings: proveedor(withingsId, withingsSecret),
    /** Base publica para el callback de OAuth. */
    urlPublica: appPublicUrl ?? null,
  },
  /** Raíz del almacén de archivos clínicos. */
  archivosDir,
  keycloak: {
    /**
     * Issuer(s) LITERALES aceptados en el claim 'iss'. NO cambian entre
     * ejecutar en el host o dentro de Docker: el token lo emite el
     * navegador, asi que 'iss' es la direccion por la que ese navegador
     * llego a Keycloak. Compararlo con el hostname interno de Docker es
     * el error que devuelve 401 en todo.
     *
     * Es una lista para admitir tambien la IP de la red local cuando se
     * prueba en un movil. Ver la nota de arriba.
     */
    issuer,
    /**
     * Ruta de RED para descargar las llaves publicas. Esta SI cambia entre
     * host (localhost:8080) y Docker (keycloak:8080). Por eso va separada
     * del issuer.
     */
    jwksUrl,
    /** El token debe nombrar a la API en su claim 'aud'. Tampoco cambia. */
    audience,
    /** URL interna de Keycloak para llamadas server-to-server. */
    adminUrl: keycloakAdminUrl,
    /** Realm de la aplicación. */
    realm: keycloakRealm,
    /** Client ID del service account con manage-users. */
    svcClientId: keycloakSvcClientId,
    /** Client secret del service account. */
    svcClientSecret: keycloakSvcClientSecret,
    /** true cuando el service account está configurado. */
    adminEnabled: keycloakAdminEnabled,
  },
  /**
   * Solo desarrollo: 'sub' del usuario de prueba del realm. Lo usa el
   * comando de seed para rellenar profesional.keycloak_user_id. No es
   * obligatoria porque la API no la necesita para funcionar.
   */
  devKeycloakSub: optional('DEV_KEYCLOAK_SUB'),
  /** Segundo usuario de prueba, con rol 'nutricionista'. */
  devKeycloakSubNutri: optional('DEV_KEYCLOAK_SUB_NUTRI'),
} as const

export type Config = typeof config
