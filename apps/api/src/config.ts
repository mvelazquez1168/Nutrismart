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
const issuer = required('KEYCLOAK_ISSUER')
const jwksUrl = required('KEYCLOAK_JWKS_URL')
const audience = required('KEYCLOAK_AUDIENCE')
const apiPort = optionalPort('API_PORT', 4000)
const nodeEnv = process.env['NODE_ENV']?.trim() || 'development'
const frontendProUrl = optional('FRONTEND_PRO_URL') ?? 'http://localhost:5173'

// Se acumulan TODAS las que faltan y se reportan juntas: descubrirlas de
// una en una, reiniciando el proceso cada vez, es tiempo perdido.
if (missing.length > 0) {
  const lista = missing.map((m) => `  - ${m}`).join('\n')
  throw new Error(
    `Configuracion incompleta. Falta(n) ${missing.length} variable(s) de entorno:\n${lista}\n\n` +
      `Copia .env.example a .env en la raiz del repo y completalo.`,
  )
}

export const config = {
  nodeEnv,
  isDev: nodeEnv !== 'production',
  apiPort,
  databaseUrl,
  /**
   * Origen del front profesional. La API lo usa como unico origen
   * permitido en CORS: un '*' seria inaceptable en una API que responde
   * datos clinicos con credenciales.
   */
  frontendProUrl,
  keycloak: {
    /**
     * Issuer LITERAL esperado en el claim 'iss'. NO cambia entre ejecutar
     * en el host o dentro de Docker: el token lo emite el navegador contra
     * localhost, asi que 'iss' siempre es localhost. Compararlo con el
     * hostname interno de Docker es el error que devuelve 401 en todo.
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
