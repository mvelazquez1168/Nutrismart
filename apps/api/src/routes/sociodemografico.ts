/**
 * Sociodemografía del paciente — CLI-07.
 *
 * El bloque entero está detrás de un consentimiento explícito. La
 * regla que gobierna estas dos rutas: **sin consentimiento vigente, la
 * API no devuelve los datos**, aunque estén en la base. Filtrar en el
 * frontend no valdría — cualquiera que mire la respuesta los vería.
 *
 * Revocar no borra: la trazabilidad clínica del proyecto dice que nada
 * se elimina físicamente. Lo que se borra es el rastro de QUIÉN y
 * CUÁNDO autorizó, que es lo que revocar debe deshacer, y los datos
 * dejan de exponerse.
 *
 * Visibilidad: misma doble acotación que el resto —clínica del token y
 * alcance del solicitante— y **404** cuando el paciente no es visible.
 * Nunca 403: distinguir "no existe" de "existe pero no es tuyo" es
 * confirmarle a un profesional que cierto paciente está en la clínica.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'

/* ------------------------------------------------------------------ */
/* Dominio                                                             */
/* ------------------------------------------------------------------ */

const NIVELES_ACTIVIDAD = ['sedentario', 'leve', 'moderada', 'intensa'] as const
const FRECUENCIAS_ALCOHOL = ['nunca', 'ocasional', 'frecuente'] as const
const ESCOLARIDADES = [
  'ninguna',
  'primaria',
  'secundaria',
  'tecnica',
  'universitaria',
  'posgrado',
] as const
const TIPOS_HOGAR = [
  'solo',
  'pareja',
  'familia_nuclear',
  'familia_extendida',
  'companeros',
] as const

interface DatosSocio {
  nivelActividad: string | null
  horasSueno: number | null
  tabaco: boolean | null
  alcohol: string | null
  ocupacion: string | null
  escolaridad: string | null
  personasEnHogar: number | null
  tipoHogar: string | null
}

interface Fila extends Record<string, unknown> {
  paciente_id: string | null
  nivel_actividad: string | null
  horas_sueno: number | null
  tabaco: boolean | null
  alcohol: string | null
  ocupacion: string | null
  escolaridad: string | null
  personas_en_hogar: number | null
  tipo_hogar: string | null
  consentimiento_otorgado: boolean | null
  consentimiento_fecha: Date | null
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

interface Entrada extends DatosSocio {
  consentimientoOtorgado: boolean
  /**
   * true si el cuerpo trae AL MENOS un campo de contenido.
   *
   * Distingue las dos intenciones que caben en el mismo PUT:
   *   · con contenido  -> reemplaza el bloque (omitir un campo lo borra,
   *                       que es lo que el formulario necesita para que
   *                       vaciar una casilla surta efecto)
   *   · sin contenido  -> es una operación de CONSENTIMIENTO y no toca
   *                       los datos
   *
   * Sin esta distinción, `{"consentimientoOtorgado": false}` —lo natural
   * para revocar— borraría el expediente social entero, y volver a
   * otorgarlo con un cuerpo igual de escueto lo borraría también.
   */
  traeContenido: boolean
}

const CAMPOS_CONTENIDO = [
  'nivelActividad',
  'horasSueno',
  'tabaco',
  'alcohol',
  'ocupacion',
  'escolaridad',
  'personasEnHogar',
  'tipoHogar',
] as const

type Validacion = { ok: true; datos: Entrada } | { ok: false; errores: ErrorCampo[] }

function validar(cuerpo: unknown): Validacion {
  const errores: ErrorCampo[] = []
  const c = (cuerpo ?? {}) as Record<string, unknown>

  // El consentimiento es lo único obligatorio: es la puerta de todo el
  // bloque, y omitirlo no puede interpretarse como un "sí".
  let consentimientoOtorgado = false
  if (typeof c['consentimientoOtorgado'] !== 'boolean') {
    errores.push({
      campo: 'consentimientoOtorgado',
      mensaje: 'Es obligatorio e indica si el paciente autorizó la recolección',
    })
  } else {
    consentimientoOtorgado = c['consentimientoOtorgado']
  }

  /** null explícito y ausente significan lo mismo: sin dato. */
  function opcional(campo: string): unknown {
    const v = c[campo]
    return v === undefined || v === null || v === '' ? null : v
  }

  function enumerado(campo: string, permitidos: readonly string[]): string | null {
    const v = opcional(campo)
    if (v === null) return null
    if (typeof v !== 'string' || !permitidos.includes(v)) {
      errores.push({ campo, mensaje: `Debe ser uno de: ${permitidos.join(', ')}` })
      return null
    }
    return v
  }

  function entero(campo: string, min: number, max: number): number | null {
    const v = opcional(campo)
    if (v === null) return null
    // Se rechaza el decimal en vez de redondearlo: 7.5 horas de sueño
    // es un dato que alguien quiso dar, y guardar 8 en silencio es
    // inventarse una respuesta distinta de la que dieron.
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      errores.push({ campo, mensaje: `Debe ser un número entero entre ${min} y ${max}` })
      return null
    }
    return v
  }

  function booleano(campo: string): boolean | null {
    const v = opcional(campo)
    if (v === null) return null
    if (typeof v !== 'boolean') {
      errores.push({ campo, mensaje: 'Debe ser verdadero o falso' })
      return null
    }
    return v
  }

  function texto(campo: string, maximo: number): string | null {
    const v = opcional(campo)
    if (v === null) return null
    if (typeof v !== 'string') {
      errores.push({ campo, mensaje: 'Debe ser texto' })
      return null
    }
    const limpio = v.trim()
    if (limpio.length === 0) return null
    if (limpio.length > maximo) {
      errores.push({ campo, mensaje: `No puede superar ${maximo} caracteres` })
      return null
    }
    return limpio
  }

  const datos: Entrada = {
    consentimientoOtorgado,
    traeContenido: CAMPOS_CONTENIDO.some((k) => c[k] !== undefined),
    nivelActividad: enumerado('nivelActividad', NIVELES_ACTIVIDAD),
    horasSueno: entero('horasSueno', 1, 24),
    tabaco: booleano('tabaco'),
    alcohol: enumerado('alcohol', FRECUENCIAS_ALCOHOL),
    ocupacion: texto('ocupacion', 80),
    escolaridad: enumerado('escolaridad', ESCOLARIDADES),
    personasEnHogar: entero('personasEnHogar', 1, 20),
    tipoHogar: enumerado('tipoHogar', TIPOS_HOGAR),
  }

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, datos }
}

/* ------------------------------------------------------------------ */
/* Consultas                                                           */
/* ------------------------------------------------------------------ */

/**
 * La visibilidad se resuelve DENTRO de la consulta, no antes.
 *
 * El LEFT JOIN distingue los dos casos que se ven iguales desde fuera:
 * sin filas = el paciente no existe o no es visible (404); una fila con
 * `consentimiento_otorgado` nulo = el paciente es visible y todavía no
 * se ha recolectado nada.
 */
const SQL_LEER = `
  select
    s.paciente_id,
    s.nivel_actividad::text,
    s.horas_sueno,
    s.tabaco,
    s.alcohol::text,
    s.ocupacion,
    s.escolaridad::text,
    s.personas_en_hogar,
    s.tipo_hogar::text,
    s.consentimiento_otorgado,
    s.consentimiento_fecha
  from paciente p
  left join paciente_sociodemografico s on s.paciente_id = p.id
  where p.id = $1
    and p.clinica_id = $2
    and ($3::uuid is null or p.nutricionista_id = $3)
`

const SQL_GUARDAR = `
  insert into paciente_sociodemografico (
    paciente_id, clinica_id,
    nivel_actividad, horas_sueno, tabaco, alcohol,
    ocupacion, escolaridad, personas_en_hogar, tipo_hogar,
    consentimiento_otorgado, consentimiento_profesional_id
  ) values (
    $1, $2,
    $3::nivel_actividad_fisica, $4, $5, $6::frecuencia_alcohol,
    $7, $8::nivel_escolaridad, $9, $10::tipo_hogar,
    $11, case when $11 then $12::uuid else null end
  )
  on conflict (paciente_id) do update set
    -- $13 = el cuerpo trae al menos un campo de contenido.
    --
    -- Si no lo trae, esto es una operación de consentimiento y los datos
    -- no se tocan. Sin esa distinción, revocar con
    -- {"consentimientoOtorgado": false} —lo natural— borraría el
    -- expediente social entero, y volver a otorgarlo con un cuerpo
    -- igual de escueto lo borraría también. Borrar físicamente va
    -- contra la trazabilidad clínica del proyecto.
    --
    -- Cuando SÍ trae contenido, se reemplaza el bloque completo: omitir
    -- un campo lo deja nulo, que es como el formulario vacía una casilla.
    nivel_actividad   = case when $13::boolean
                             then excluded.nivel_actividad
                             else paciente_sociodemografico.nivel_actividad end,
    horas_sueno       = case when $13::boolean
                             then excluded.horas_sueno
                             else paciente_sociodemografico.horas_sueno end,
    tabaco            = case when $13::boolean
                             then excluded.tabaco
                             else paciente_sociodemografico.tabaco end,
    alcohol           = case when $13::boolean
                             then excluded.alcohol
                             else paciente_sociodemografico.alcohol end,
    ocupacion         = case when $13::boolean
                             then excluded.ocupacion
                             else paciente_sociodemografico.ocupacion end,
    escolaridad       = case when $13::boolean
                             then excluded.escolaridad
                             else paciente_sociodemografico.escolaridad end,
    personas_en_hogar = case when $13::boolean
                             then excluded.personas_en_hogar
                             else paciente_sociodemografico.personas_en_hogar end,
    tipo_hogar        = case when $13::boolean
                             then excluded.tipo_hogar
                             else paciente_sociodemografico.tipo_hogar end,
    consentimiento_otorgado = excluded.consentimiento_otorgado,
    -- Solo se reasigna cuando se está otorgando. Si ya estaba otorgado,
    -- el registro debe seguir apuntando a quien lo recogió, no a quien
    -- editó un campo tres meses después.
    consentimiento_profesional_id = case
      when excluded.consentimiento_otorgado and not paciente_sociodemografico.consentimiento_otorgado
        then excluded.consentimiento_profesional_id
      when excluded.consentimiento_otorgado
        then paciente_sociodemografico.consentimiento_profesional_id
      else null
    end
  returning
    paciente_id,
    nivel_actividad::text, horas_sueno, tabaco, alcohol::text,
    ocupacion, escolaridad::text, personas_en_hogar, tipo_hogar::text,
    consentimiento_otorgado, consentimiento_fecha
`

/**
 * Da forma a la respuesta.
 *
 * `datos` viaja a null si no hay consentimiento vigente. Es el punto
 * donde se cumple la promesa hecha al paciente, y por eso vive en una
 * sola función: repartir esta decisión por varios sitios es cómo se
 * acaba filtrando por el endpoint que alguien olvidó.
 */
function aRespuesta(fila: Fila | undefined) {
  const otorgado = fila?.consentimiento_otorgado === true

  return {
    consentimientoOtorgado: otorgado,
    consentimientoFecha: fila?.consentimiento_fecha ?? null,
    /** true cuando existe fila, aunque el consentimiento esté revocado. */
    recolectado: !!fila?.paciente_id,
    datos: otorgado
      ? ({
          nivelActividad: fila?.nivel_actividad ?? null,
          horasSueno: fila?.horas_sueno ?? null,
          tabaco: fila?.tabaco ?? null,
          alcohol: fila?.alcohol ?? null,
          ocupacion: fila?.ocupacion ?? null,
          escolaridad: fila?.escolaridad ?? null,
          personasEnHogar: fila?.personas_en_hogar ?? null,
          tipoHogar: fila?.tipo_hogar ?? null,
        } satisfies DatosSocio)
      : null,
  }
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

interface ParamsId {
  id: string
}

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

export async function registerSociodemograficoRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/sociodemografico                           */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/pacientes/:id/sociodemografico',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { rows } = await pool.query<Fila>(SQL_LEER, [id, tenantId, alcance.restringirA])
      if (rows.length === 0) return reply.code(404).send(noEncontradoPaciente())

      return reply.send(aRespuesta(rows[0]))
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/pacientes/:id/sociodemografico                           */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: ParamsId }>(
    '/api/pacientes/:id/sociodemografico',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      // La visibilidad se comprueba ANTES de validar el cuerpo: si el
      // paciente no es visible, los mensajes de validación ya serían
      // información sobre un recurso ajeno.
      const previo = await pool.query<Fila>(SQL_LEER, [id, tenantId, alcance.restringirA])
      if (previo.rows.length === 0) return reply.code(404).send(noEncontradoPaciente())

      const validacion = validar(request.body)
      if (!validacion.ok) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'Revisa los datos del contexto social',
          errores: validacion.errores,
        })
      }

      const d = validacion.datos
      const { rows } = await pool.query<Fila>(SQL_GUARDAR, [
        id,
        tenantId,
        d.nivelActividad,
        d.horasSueno,
        d.tabaco,
        d.alcohol,
        d.ocupacion,
        d.escolaridad,
        d.personasEnHogar,
        d.tipoHogar,
        d.consentimientoOtorgado,
        // El profesional que consta como receptor del consentimiento es
        // el de ESTA clínica, resuelto por resolverAlcance. No el 'sub'
        // del token: ese es el id de usuario de Keycloak y no existe en
        // la tabla profesional — la clave foránea lo rechazaría.
        alcance.profesionalId,
        d.traeContenido,
      ])

      return reply.send(aRespuesta(rows[0]))
    },
  )
}
