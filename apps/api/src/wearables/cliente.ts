/**
 * Diálogo con Fitbit y Google Fit — RPM-01.
 *
 * Aquí viven las dos cosas que cambian de un proveedor a otro: cómo se
 * canjea el código por un token, y cómo se piden los datos de un día.
 *
 * **Nada de esto está probado contra los servidores reales.** Hace falta
 * una aplicación registrada en cada portal de desarrollador, y este
 * proyecto todavía no la tiene. Lo que sí está probado es todo lo demás:
 * que sin credenciales la API arranca igual y responde 503 explicando
 * qué falta, que el cifrado va y viene, y que sincronizar dos veces el
 * mismo día no duplica nada.
 */
import { pool } from '../db.js'
import { cifrar, descifrar } from './cifrado.js'
import {
  DEFINICION,
  credenciales,
  esPlausible,
  urlCallback,
  UNIDAD,
  type Lectura,
  type Proveedor,
} from './proveedores.js'

export class ErrorProveedor extends Error {}

interface RespuestaToken {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  /**
   * Solo Withings. Es SU identificador del usuario, y es lo único que
   * traen sus webhooks para decir de quién es el aviso: sin guardarlo,
   * llegaría una notificación de que «alguien» se pesó.
   */
  userid?: number | string
}

/** Cabeceras del endpoint de token. Fitbit exige Basic; Google, no. */
function cabecerasToken(p: Proveedor): Record<string, string> {
  const c = credenciales(p)
  if (!c) throw new ErrorProveedor(`${p} no está configurado`)
  const base: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (DEFINICION[p].autenticaConBasic) {
    const par = Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')
    base['Authorization'] = `Basic ${par}`
  }
  return base
}

/**
 * Withings responde **HTTP 200 aunque falle**.
 *
 * Su formato es `{ status: 0, body: {...} }` y el error va en `status`:
 * un 0 es éxito y cualquier otro número, un fallo. Tratarlo como una API
 * normal —mirar solo el código HTTP— daría por buena una respuesta que
 * no trae token, y el fallo aparecería mucho después, al descifrar un
 * `undefined`.
 */
interface SobreWithings {
  status: number
  body?: RespuestaToken & { userid?: number | string }
  error?: string
}

async function pedirToken(p: Proveedor, cuerpo: URLSearchParams): Promise<RespuestaToken> {
  const c = credenciales(p)
  if (!c) throw new ErrorProveedor(`${p} no está configurado`)

  if (DEFINICION[p].dialecto === 'withings') {
    cuerpo.set('action', 'requesttoken')
    cuerpo.set('client_id', c.clientId)
    cuerpo.set('client_secret', c.clientSecret)

    const r = await fetch(DEFINICION[p].urlToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
    })
    const sobre = (await r.json().catch(() => null)) as SobreWithings | null
    if (!sobre || sobre.status !== 0 || !sobre.body?.access_token) {
      throw new ErrorProveedor(
        `Withings rechazó la petición (status ${sobre?.status ?? '?'}${sobre?.error ? `: ${sobre.error}` : ''})`,
      )
    }
    return sobre.body
  }

  if (!DEFINICION[p].autenticaConBasic) {
    cuerpo.set('client_id', c.clientId)
    cuerpo.set('client_secret', c.clientSecret)
  }

  const r = await fetch(DEFINICION[p].urlToken, {
    method: 'POST',
    headers: cabecerasToken(p),
    body: cuerpo,
  })

  if (!r.ok) {
    // El cuerpo del error puede traer el client_secret reflejado; se
    // recorta y no se propaga hacia el cliente.
    const detalle = (await r.text()).slice(0, 200)
    throw new ErrorProveedor(`El proveedor rechazó la petición (${r.status}): ${detalle}`)
  }
  return (await r.json()) as RespuestaToken
}

export async function canjearCodigo(p: Proveedor, codigo: string): Promise<RespuestaToken> {
  return pedirToken(
    p,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: urlCallback(p),
    }),
  )
}

/**
 * Devuelve un access_token vigente, renovándolo si hace falta.
 *
 * El margen de 60 segundos evita el caso de libro: un token que era
 * válido al empezar la petición y caduca antes de que llegue.
 */
export async function tokenVigente(conexionId: string): Promise<string> {
  const { rows } = await pool.query<{
    proveedor: Proveedor
    access_token: string
    refresh_token: string | null
    caducado: boolean
  }>(
    `select proveedor, access_token, refresh_token,
            (token_expira_en is not null and token_expira_en < now() + interval '60 seconds') as caducado
       from conexion_wearable where id = $1 and activo = true`,
    [conexionId],
  )
  const cx = rows[0]
  if (!cx) throw new ErrorProveedor('La conexión ya no existe')

  if (!cx.caducado) return descifrar(cx.access_token)

  if (!cx.refresh_token) {
    throw new ErrorProveedor('El acceso caducó y el proveedor no dio forma de renovarlo')
  }

  const datos = await pedirToken(
    cx.proveedor,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: descifrar(cx.refresh_token),
    }),
  )

  // Google no siempre devuelve refresh_token al renovar: se conserva el
  // anterior. Sobrescribirlo con null dejaría la conexión muerta en la
  // siguiente caducidad.
  await pool.query(
    `update conexion_wearable
        set access_token = $2,
            refresh_token = coalesce($3, refresh_token),
            token_expira_en = case when $4::int is null then null
                                   else now() + make_interval(secs => $4::int) end,
            ultimo_error = null
      where id = $1`,
    [
      conexionId,
      cifrar(datos.access_token),
      datos.refresh_token ? cifrar(datos.refresh_token) : null,
      datos.expires_in ?? null,
    ],
  )

  return datos.access_token
}

/* ------------------------------------------------------------------ */
/* Lectura de datos                                                    */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number => Number(v)

/**
 * Un día de Fitbit.
 *
 * Tres llamadas porque su API las separa. Si una falla, las otras dos
 * siguen valiendo: se devuelve lo que se pudo leer en vez de perder el
 * día entero.
 */
async function diaFitbit(token: string, dia: string): Promise<Lectura[]> {
  const cab = { Authorization: `Bearer ${token}`, 'Accept-Language': 'es_ES' }
  const salida: Lectura[] = []

  const pedir = async (ruta: string): Promise<unknown | null> => {
    try {
      const r = await fetch(`https://api.fitbit.com${ruta}`, { headers: cab })
      return r.ok ? await r.json() : null
    } catch {
      return null
    }
  }

  const pasos = (await pedir(`/1/user/-/activities/date/${dia}.json`)) as
    | { summary?: { steps?: number } }
    | null
  if (pasos?.summary?.steps !== undefined) {
    salida.push({ tipo: 'pasos', valor: num(pasos.summary.steps), unidad: UNIDAD.pasos, dia })
  }

  const fc = (await pedir(`/1/user/-/activities/heart/date/${dia}/1d.json`)) as
    | { 'activities-heart'?: { value?: { restingHeartRate?: number } }[] }
    | null
  const reposo = fc?.['activities-heart']?.[0]?.value?.restingHeartRate
  if (reposo !== undefined) {
    // Se guarda la de REPOSO, no la media del día: la media sube al
    // subir una escalera y no dice nada. La de reposo sí es una señal.
    salida.push({
      tipo: 'frecuencia_cardiaca',
      valor: num(reposo),
      unidad: UNIDAD.frecuencia_cardiaca,
      dia,
    })
  }

  const sueno = (await pedir(`/1.2/user/-/sleep/date/${dia}.json`)) as
    | { summary?: { totalMinutesAsleep?: number } }
    | null
  const minutos = sueno?.summary?.totalMinutesAsleep
  if (minutos !== undefined) {
    salida.push({
      tipo: 'sueno_horas',
      valor: Math.round((num(minutos) / 60) * 10) / 10,
      unidad: UNIDAD.sueno_horas,
      dia,
    })
  }

  return salida.filter(esPlausible)
}

/**
 * Un día de Google Fit.
 *
 * Su API agrega por ventanas de tiempo en milisegundos. No expone sueño
 * de forma comparable a Fitbit, así que de aquí salen dos métricas y no
 * tres — la pantalla lo dice en vez de dejar un hueco sin explicar.
 */
async function diaGoogleFit(token: string, dia: string): Promise<Lectura[]> {
  const desde = Date.parse(`${dia}T00:00:00Z`)
  const hasta = desde + 24 * 60 * 60 * 1000

  const agregar = async (tipoDato: string, tipoAgregado: string): Promise<number | null> => {
    try {
      const r = await fetch(
        'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aggregateBy: [{ dataTypeName: tipoDato }],
            bucketByTime: { durationMillis: 86_400_000 },
            startTimeMillis: desde,
            endTimeMillis: hasta,
          }),
        },
      )
      if (!r.ok) return null
      const d = (await r.json()) as {
        bucket?: { dataset?: { point?: { value?: { intVal?: number; fpVal?: number }[] }[] }[] }[]
      }
      const p = d.bucket?.[0]?.dataset?.[0]?.point?.[0]?.value?.[0]
      if (!p) return null
      return tipoAgregado === 'int' ? (p.intVal ?? null) : (p.fpVal ?? null)
    } catch {
      return null
    }
  }

  const salida: Lectura[] = []

  const pasos = await agregar('com.google.step_count.delta', 'int')
  if (pasos !== null) salida.push({ tipo: 'pasos', valor: pasos, unidad: UNIDAD.pasos, dia })

  const fc = await agregar('com.google.heart_rate.bpm', 'fp')
  if (fc !== null) {
    salida.push({
      tipo: 'frecuencia_cardiaca',
      valor: Math.round(fc),
      unidad: UNIDAD.frecuencia_cardiaca,
      dia,
    })
  }

  return salida.filter(esPlausible)
}

/**
 * Medidas de Withings.
 *
 * Su API no va por día: se le pide un RANGO y devuelve cada pesada con
 * su instante. Por eso esta función recibe días hacia atrás y no una
 * fecha suelta, y por eso devuelve el día real de cada medida en vez de
 * repartirlas.
 *
 * El formato de los valores es `valor × 10^unidad`: un peso de 77,6 kg
 * llega como `{ value: 776, unit: -1 }`. Multiplicar mal aquí guardaría
 * a alguien con 776 kilos.
 */
const MTYPE: Record<number, Lectura['tipo']> = {
  1: 'peso',
  6: 'grasa_pct',
  8: 'masa_grasa_kg',
  76: 'masa_muscular_kg',
  77: 'masa_osea_kg',
}

export async function medidasWithings(token: string, diasAtras: number): Promise<Lectura[]> {
  const hasta = Math.floor(Date.now() / 1000)
  const desde = hasta - diasAtras * 86_400

  const r = await fetch('https://wbsapi.withings.net/measure', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      action: 'getmeas',
      meastypes: Object.keys(MTYPE).join(','),
      category: '1', // 1 = medidas reales; 2 = objetivos que se puso el usuario
      startdate: String(desde),
      enddate: String(hasta),
    }),
  })

  const sobre = (await r.json().catch(() => null)) as {
    status?: number
    body?: { measuregrps?: { date: number; measures: { value: number; type: number; unit: number }[] }[] }
  } | null

  // Igual que con el token: HTTP 200 no significa que haya ido bien.
  if (!sobre || sobre.status !== 0) {
    throw new ErrorProveedor(`Withings rechazó la consulta (status ${sobre?.status ?? '?'})`)
  }

  const salida: Lectura[] = []
  for (const grupo of sobre.body?.measuregrps ?? []) {
    // `date` es un instante Unix; el día se calcula en la zona de la
    // clínica, no en UTC: una pesada a las 21:00 en Costa Rica es de ese
    // día y no del siguiente.
    const dia = new Date(grupo.date * 1000).toLocaleDateString('en-CA', {
      timeZone: 'America/Costa_Rica',
    })
    for (const m of grupo.measures) {
      const tipo = MTYPE[m.type]
      if (!tipo) continue
      salida.push({
        tipo,
        valor: Math.round(m.value * 10 ** m.unit * 100) / 100,
        unidad: UNIDAD[tipo],
        dia,
      })
    }
  }
  return salida.filter(esPlausible)
}

export function leerDia(p: Proveedor, token: string, dia: string): Promise<Lectura[]> {
  return p === 'fitbit' ? diaFitbit(token, dia) : diaGoogleFit(token, dia)
}
