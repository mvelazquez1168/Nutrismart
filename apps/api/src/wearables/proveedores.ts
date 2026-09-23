/**
 * Los proveedores que se pueden conectar — RPM-01 y RPM-02.
 *
 * ── Por qué estos tres ──────────────────────────────────────────────
 *
 * Apple HealthKit y Google Health Connect son SDK nativos: no tienen API
 * que un servidor pueda llamar. Fitbit y Google Fit sí.
 *
 * Para quien lleva Apple Watch la vía es Fitbit: su aplicación de iPhone
 * sincroniza con Apple Salud sola, así que los datos del reloj acaban
 * llegando aquí sin que el paciente haga nada más. La pantalla lo dice,
 * porque no es evidente.
 *
 * Withings es aparte: son básculas. Trae peso y composición corporal, y
 * avisa por webhook cada vez que alguien se pesa en lugar de haber que
 * preguntárselo. Cubre además las básculas de otras marcas que
 * sincronizan con su nube.
 *
 * Este archivo solo describe QUÉ se pide a cada proveedor y cómo se
 * traduce lo que devuelve. Las rutas no saben de Fitbit ni de Withings.
 */
import { config } from '../config.js'

export const PROVEEDORES = ['fitbit', 'google_fit', 'withings'] as const
export type Proveedor = (typeof PROVEEDORES)[number]

export const ES_PROVEEDOR = (v: string): v is Proveedor =>
  (PROVEEDORES as readonly string[]).includes(v)

export const ETIQUETA: Record<Proveedor, string> = {
  fitbit: 'Fitbit',
  google_fit: 'Google Fit',
  withings: 'Withings',
}

/** Qué aporta cada uno, para que la pantalla no obligue a adivinarlo. */
export const QUE_TRAE: Record<Proveedor, string> = {
  fitbit: 'Pasos, pulso en reposo y horas de sueño',
  google_fit: 'Pasos y pulso',
  withings: 'Peso y composición corporal cada vez que te peses',
}

interface Definicion {
  urlAutorizacion: string
  urlToken: string
  scope: string
  /** Fitbit exige autenticación básica en el endpoint de token. */
  autenticaConBasic: boolean
  /**
   * Withings no habla OAuth estándar en el endpoint de token: exige un
   * parámetro `action=requesttoken` y responde `{status, body:{…}}` con
   * HTTP 200 incluso cuando falla. Se trata aparte en `cliente.ts`.
   */
  dialecto: 'estandar' | 'withings'
}

export const DEFINICION: Record<Proveedor, Definicion> = {
  fitbit: {
    urlAutorizacion: 'https://www.fitbit.com/oauth2/authorize',
    urlToken: 'https://api.fitbit.com/oauth2/token',
    // Lo MÍNIMO para lo que se muestra. Pedir 'profile' o 'weight'
    // porque «puede que algún día haga falta» es pedirle a alguien
    // acceso a datos que no se van a usar.
    scope: 'activity heartrate sleep',
    autenticaConBasic: true,
    dialecto: 'estandar',
  },
  google_fit: {
    urlAutorizacion: 'https://accounts.google.com/o/oauth2/v2/auth',
    urlToken: 'https://oauth2.googleapis.com/token',
    scope: [
      'https://www.googleapis.com/auth/fitness.activity.read',
      'https://www.googleapis.com/auth/fitness.heart_rate.read',
    ].join(' '),
    autenticaConBasic: false,
    dialecto: 'estandar',
  },
  withings: {
    urlAutorizacion: 'https://account.withings.com/oauth2_user/authorize2',
    urlToken: 'https://wbsapi.withings.net/v2/oauth2',
    // Solo las medidas. Withings ofrece además actividad y sueño; no se
    // piden porque para eso ya está Fitbit y no se van a mostrar.
    scope: 'user.metrics',
    autenticaConBasic: false,
    dialecto: 'withings',
  },
}

/** Credenciales del proveedor, o `null` si no está configurado. */
export function credenciales(p: Proveedor): { clientId: string; clientSecret: string } | null {
  if (p === 'fitbit') return config.wearables.fitbit
  if (p === 'google_fit') return config.wearables.googleFit
  return config.wearables.withings
}

/**
 * Qué falta para poder usar la integración.
 *
 * Devuelve `null` si está todo. Se comprueba en cada ruta para poder
 * decir exactamente qué falta en vez de un 503 mudo.
 */
export function loQueFalta(p: Proveedor): string | null {
  if (!config.wearables.claveCifrado) {
    return 'Falta WEARABLE_ENCRYPTION_KEY en la configuración del servidor'
  }
  if (!config.wearables.urlPublica) {
    return 'Falta APP_PUBLIC_URL: sin ella no se puede construir la dirección de vuelta'
  }
  if (!credenciales(p)) {
    return `${ETIQUETA[p]} no está configurado en este servidor`
  }
  return null
}

/**
 * Dirección de vuelta. Tiene que coincidir EXACTAMENTE con la ruta
 * registrada en `routes/wearables.ts` y con la que se dé de alta en el
 * portal del proveedor: los tres sitios o falla, y falla al final del
 * flujo, cuando el usuario ya autorizó.
 */
export function urlCallback(p: Proveedor): string {
  return `${config.wearables.urlPublica}/api/paciente/wearables/${p}/callback`
}

/* ------------------------------------------------------------------ */
/* Lo que se sincroniza                                                */
/* ------------------------------------------------------------------ */

export type TipoLectura =
  | 'pasos'
  | 'frecuencia_cardiaca'
  | 'sueno_horas'
  | 'peso'
  | 'grasa_pct'
  | 'masa_grasa_kg'
  | 'masa_muscular_kg'
  | 'masa_osea_kg'

export interface Lectura {
  tipo: TipoLectura
  valor: number
  unidad: string
  /** Día al que corresponde, en formato YYYY-MM-DD. */
  dia: string
}

export const UNIDAD: Record<TipoLectura, string> = {
  pasos: 'pasos',
  frecuencia_cardiaca: 'lpm',
  sueno_horas: 'h',
  peso: 'kg',
  grasa_pct: '%',
  masa_grasa_kg: 'kg',
  masa_muscular_kg: 'kg',
  masa_osea_kg: 'kg',
}

/**
 * Rangos plausibles. Lo que caiga fuera se descarta.
 *
 * Un dispositivo puede devolver ceros por un día que no se llevó puesto,
 * o cifras absurdas por un fallo de sincronización. Guardarlas
 * hundiría cualquier media y le diría al profesional que su paciente
 * durmió 47 horas.
 */
export const RANGO: Record<TipoLectura, { min: number; max: number }> = {
  pasos: { min: 1, max: 100_000 },
  frecuencia_cardiaca: { min: 25, max: 220 },
  sueno_horas: { min: 0.5, max: 20 },
  peso: { min: 20, max: 400 },
  grasa_pct: { min: 2, max: 75 },
  masa_grasa_kg: { min: 1, max: 200 },
  masa_muscular_kg: { min: 5, max: 150 },
  masa_osea_kg: { min: 0.5, max: 10 },
}

export function esPlausible(l: Lectura): boolean {
  const r = RANGO[l.tipo]
  return Number.isFinite(l.valor) && l.valor >= r.min && l.valor <= r.max
}
