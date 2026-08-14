/**
 * Historial clínico y farmacología — EVAL-03.
 *
 * El historial es UNO por paciente y se actualiza consulta a consulta:
 * "el padre tiene diabetes" no deja de ser cierto en la siguiente. Por
 * eso es un UPSERT y no una fila nueva cada vez, al revés que la
 * antropometría, donde cada peso es de un día concreto.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { pacienteVisible } from './consultas.js'
import { revisarInteracciones } from '../clinico/interacciones.js'

/**
 * Factores de actividad física. Se guardan calculados para que el
 * histórico conserve el valor que se usó aunque la tabla cambie.
 */
export const FACTOR_ACTIVIDAD: Record<string, number> = {
  sedentario: 1.2,
  leve: 1.375,
  moderado: 1.55,
  intenso: 1.725,
  muy_intenso: 1.9,
}

const LIKERT = [
  'alimentacionEmocional',
  'salteoComidas',
  'atracones',
  'culpaAlComer',
  'dietasFrecuentes',
] as const

const COLUMNA_LIKERT: Record<string, string> = {
  alimentacionEmocional: 'alimentacion_emocional',
  salteoComidas: 'salteo_comidas',
  atracones: 'atracones',
  culpaAlComer: 'culpa_al_comer',
  dietasFrecuentes: 'dietas_frecuentes',
}

const CAMPOS = `
  id, consulta_id, apf, app, tipo_actividad, sesiones_semana, duracion_min, faf,
  actividad_detalle, fuma, alcohol, otras_sustancias, sintomas_gi, gi_detalle,
  alimentacion_emocional, salteo_comidas, atracones, culpa_al_comer, dietas_frecuentes,
  notas_adicionales, updated_at
`

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}
function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function aHistorial(f: Record<string, unknown>) {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    id: f['id'] as string,
    consultaId: (f['consulta_id'] as string | null) ?? null,
    apf: f['apf'] ?? [],
    app: f['app'] ?? [],
    tipoActividad: (f['tipo_actividad'] as string | null) ?? null,
    sesionesSemana: num(f['sesiones_semana']),
    duracionMin: num(f['duracion_min']),
    faf: num(f['faf']),
    actividadDetalle: (f['actividad_detalle'] as string | null) ?? null,
    fuma: (f['fuma'] as boolean | null) ?? null,
    alcohol: (f['alcohol'] as boolean | null) ?? null,
    otrasSustancias: (f['otras_sustancias'] as string | null) ?? null,
    sintomasGi: f['sintomas_gi'] ?? [],
    giDetalle: (f['gi_detalle'] as string | null) ?? null,
    alimentacionEmocional: num(f['alimentacion_emocional']),
    salteoComidas: num(f['salteo_comidas']),
    atracones: num(f['atracones']),
    culpaAlComer: num(f['culpa_al_comer']),
    dietasFrecuentes: num(f['dietas_frecuentes']),
    notasAdicionales: (f['notas_adicionales'] as string | null) ?? null,
    updatedAt: f['updated_at'] as Date,
  }
}

function aMedicamento(f: Record<string, unknown>) {
  return {
    id: f['id'] as string,
    nombre: f['nombre'] as string,
    dosis: (f['dosis'] as string | null) ?? null,
    frecuencia: (f['frecuencia'] as string | null) ?? null,
    desde: (f['desde'] as string | null) ?? null,
    activo: f['activo'] as boolean,
  }
}

export async function registerHistorialRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/historial                                  */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/historial',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const { rows } = await pool.query(
        `select ${CAMPOS} from historial_clinico where clinica_id = $1 and paciente_id = $2`,
        [tenantId, id],
      )
      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: 'sin_historial', message: 'Este paciente aún no tiene historial' })
      }
      return reply.send(aHistorial(rows[0] as Record<string, unknown>))
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/pacientes/:id/historial                                  */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { id: string } }>(
    '/api/pacientes/:id/historial',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const c = (request.body ?? {}) as Record<string, unknown>
      const errores: ErrorCampo[] = []

      const consultaId = typeof c['consultaId'] === 'string' ? c['consultaId'] : null
      if (consultaId !== null && !esUuid(consultaId)) {
        errores.push({ campo: 'consultaId', mensaje: 'No es un identificador válido' })
      }

      const tipoActividad =
        typeof c['tipoActividad'] === 'string' && c['tipoActividad'] !== ''
          ? c['tipoActividad']
          : null
      if (tipoActividad !== null && !(tipoActividad in FACTOR_ACTIVIDAD)) {
        errores.push({
          campo: 'tipoActividad',
          mensaje: `Debe ser uno de: ${Object.keys(FACTOR_ACTIVIDAD).join(', ')}`,
        })
      }

      function entero(campo: string, min: number, max: number): number | null {
        const v = c[campo]
        if (v === undefined || v === null || v === '') return null
        const n = Number(v)
        if (!Number.isInteger(n) || n < min || n > max) {
          errores.push({ campo, mensaje: `Debe ser un entero entre ${min} y ${max}` })
          return null
        }
        return n
      }

      for (const clave of LIKERT) {
        const v = c[clave]
        if (v === undefined || v === null || v === '') continue
        const n = Number(v)
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          errores.push({ campo: clave, mensaje: 'Debe ser un valor de 1 a 5' })
        }
      }

      if (errores.length > 0) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa el historial', errores })
      }

      // El FAF lo calcula el servidor a partir del tipo elegido: si lo
      // enviara el cliente, podría no corresponder con la etiqueta que
      // el profesional ve en pantalla.
      const faf = tipoActividad !== null ? (FACTOR_ACTIVIDAD[tipoActividad] ?? null) : null

      const json = (v: unknown, porDefecto: string) =>
        v === undefined ? porDefecto : JSON.stringify(v)
      const texto = (campo: string) =>
        typeof c[campo] === 'string' && (c[campo] as string).trim() !== ''
          ? (c[campo] as string).trim()
          : null
      const booleano = (campo: string) =>
        typeof c[campo] === 'boolean' ? (c[campo] as boolean) : null
      const likert = (campo: string) => {
        const v = c[campo]
        if (v === undefined || v === null || v === '') return null
        return Number(v)
      }

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        const { rows } = await cliente.query(
          `insert into historial_clinico (
             clinica_id, paciente_id, consulta_id, profesional_id,
             apf, app, tipo_actividad, sesiones_semana, duracion_min, faf, actividad_detalle,
             fuma, alcohol, otras_sustancias, sintomas_gi, gi_detalle,
             ${LIKERT.map((k) => COLUMNA_LIKERT[k]).join(', ')}, notas_adicionales
           ) values (
             $1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,
             $12,$13,$14,$15::jsonb,$16,$17,$18,$19,$20,$21,$22
           )
           on conflict (clinica_id, paciente_id) do update set
             consulta_id = coalesce(excluded.consulta_id, historial_clinico.consulta_id),
             profesional_id = excluded.profesional_id,
             apf = excluded.apf, app = excluded.app,
             tipo_actividad = excluded.tipo_actividad,
             sesiones_semana = excluded.sesiones_semana,
             duracion_min = excluded.duracion_min,
             faf = excluded.faf,
             actividad_detalle = excluded.actividad_detalle,
             fuma = excluded.fuma, alcohol = excluded.alcohol,
             otras_sustancias = excluded.otras_sustancias,
             sintomas_gi = excluded.sintomas_gi, gi_detalle = excluded.gi_detalle,
             alimentacion_emocional = excluded.alimentacion_emocional,
             salteo_comidas = excluded.salteo_comidas,
             atracones = excluded.atracones,
             culpa_al_comer = excluded.culpa_al_comer,
             dietas_frecuentes = excluded.dietas_frecuentes,
             notas_adicionales = excluded.notas_adicionales
           returning ${CAMPOS}`,
          [
            tenantId, id, consultaId, alcance.profesionalId,
            json(c['apf'], '[]'), json(c['app'], '[]'),
            tipoActividad, entero('sesionesSemana', 0, 21), entero('duracionMin', 0, 600),
            faf, texto('actividadDetalle'),
            booleano('fuma'), booleano('alcohol'), texto('otrasSustancias'),
            json(c['sintomasGi'], '[]'), texto('giDetalle'),
            likert('alimentacionEmocional'), likert('salteoComidas'), likert('atracones'),
            likert('culpaAlComer'), likert('dietasFrecuentes'),
            texto('notasAdicionales'),
          ],
        )

        // Guardar el historial dentro de una consulta ES completar su
        // sección, igual que en antropometría.
        if (consultaId) {
          await cliente.query(
            `update consulta
                set secciones_completas = jsonb_set(secciones_completas, '{clinico}', 'true', true)
              where id = $1 and clinica_id = $2 and paciente_id = $3 and estado = 'borrador'`,
            [consultaId, tenantId, id],
          )
        }

        await cliente.query('commit')
        return reply.send(aHistorial(rows[0] as Record<string, unknown>))
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }
    },
  )

  /* ================================================================ */
  /* Farmacología                                                      */
  /* ================================================================ */

  app.get<{ Params: { id: string }; Querystring: { incluirInactivos?: string } }>(
    '/api/pacientes/:id/farmacologia',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const todos = request.query.incluirInactivos === 'true'
      const { rows } = await pool.query(
        `select id, nombre, dosis, frecuencia, to_char(desde,'YYYY-MM-DD') as desde, activo
           from farmacologia
          where clinica_id = $1 and paciente_id = $2 ${todos ? '' : 'and activo = true'}
          order by activo desc, created_at desc`,
        [tenantId, id],
      )
      return reply.send(rows.map(aMedicamento))
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/pacientes/:id/farmacologia',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const c = (request.body ?? {}) as Record<string, unknown>
      const nombre = typeof c['nombre'] === 'string' ? c['nombre'].trim() : ''
      if (nombre === '' || nombre.length > 200) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'El nombre del medicamento es obligatorio',
          errores: [{ campo: 'nombre', mensaje: 'Entre 1 y 200 caracteres' }],
        })
      }

      const desde = typeof c['desde'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c['desde'])
        ? c['desde']
        : null

      const { rows } = await pool.query(
        `insert into farmacologia (clinica_id, paciente_id, nombre, dosis, frecuencia, desde)
              values ($1,$2,$3,$4,$5,$6::date)
         returning id, nombre, dosis, frecuencia, to_char(desde,'YYYY-MM-DD') as desde, activo`,
        [
          tenantId, id, nombre,
          typeof c['dosis'] === 'string' && c['dosis'].trim() !== '' ? c['dosis'].trim() : null,
          typeof c['frecuencia'] === 'string' && c['frecuencia'].trim() !== ''
            ? c['frecuencia'].trim()
            : null,
          desde,
        ],
      )
      return reply.code(201).send(aMedicamento(rows[0] as Record<string, unknown>))
    },
  )

  app.put<{ Params: { id: string; medId: string } }>(
    '/api/pacientes/:id/farmacologia/:medId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, medId } = request.params
      if (!esUuid(medId) || !(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send({ error: 'medicamento_no_encontrado', message: 'No existe' })
      }

      const c = (request.body ?? {}) as Record<string, unknown>
      const sets: string[] = []
      const params: unknown[] = []

      for (const [campo, columna] of [
        ['nombre', 'nombre'],
        ['dosis', 'dosis'],
        ['frecuencia', 'frecuencia'],
        ['desde', 'desde'],
      ] as const) {
        if (c[campo] === undefined) continue
        const v = c[campo]
        const valor = typeof v === 'string' && v.trim() !== '' ? v.trim() : null
        if (campo === 'nombre' && valor === null) {
          return reply.code(400).send({
            error: 'validacion',
            message: 'El nombre no puede quedar vacío',
            errores: [{ campo: 'nombre', mensaje: 'Obligatorio' }],
          })
        }
        params.push(valor)
        sets.push(`${columna} = $${params.length}${campo === 'desde' ? '::date' : ''}`)
      }

      if (sets.length === 0) {
        return reply.code(400).send({ error: 'sin_cambios', message: 'No hay nada que actualizar' })
      }

      params.push(medId, tenantId, id)
      const { rows } = await pool.query(
        `update farmacologia set ${sets.join(', ')}
          where id = $${params.length - 2} and clinica_id = $${params.length - 1}
            and paciente_id = $${params.length}
        returning id, nombre, dosis, frecuencia, to_char(desde,'YYYY-MM-DD') as desde, activo`,
        params,
      )
      if (!rows[0]) {
        return reply.code(404).send({ error: 'medicamento_no_encontrado', message: 'No existe' })
      }
      return reply.send(aMedicamento(rows[0] as Record<string, unknown>))
    },
  )

  app.delete<{ Params: { id: string; medId: string } }>(
    '/api/pacientes/:id/farmacologia/:medId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, medId } = request.params
      if (!esUuid(medId) || !(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send({ error: 'medicamento_no_encontrado', message: 'No existe' })
      }

      // Baja lógica: un medicamento suspendido explica hallazgos de
      // laboratorio pasados y no puede desaparecer del expediente.
      const { rowCount } = await pool.query(
        'update farmacologia set activo = false where id = $1 and clinica_id = $2 and paciente_id = $3',
        [medId, tenantId, id],
      )
      if ((rowCount ?? 0) === 0) {
        return reply.code(404).send({ error: 'medicamento_no_encontrado', message: 'No existe' })
      }
      return reply.code(204).send()
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/farmacologia/interacciones                 */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/farmacologia/interacciones',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const { rows } = await pool.query<{ nombre: string }>(
        `select nombre from farmacologia
          where clinica_id = $1 and paciente_id = $2 and activo = true`,
        [tenantId, id],
      )

      // La respuesta incluye los NO reconocidos a propósito: sin ellos,
      // "sin interacciones" sonaría a comprobación completa cuando puede
      // significar que la lista no conoce ninguno de sus fármacos.
      return reply.send(revisarInteracciones(rows.map((r) => r.nombre)))
    },
  )
}
