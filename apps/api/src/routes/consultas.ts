/**
 * Consultas de valoración — EVAL-00, contenedor del ABCD.
 *
 * Una consulta agrupa las secciones de la valoración y su progreso. No
 * sustituye al punto de control (`clinical_snapshot`, Rebanada 3): aquel
 * es la foto de las métricas de un día; esta es el proceso de valorar,
 * con sus cuatro secciones y su conclusión.
 *
 * Visibilidad: doble acotación —clínica del token y alcance del
 * solicitante— y 404 cuando el paciente o la consulta no son visibles.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'

export const SECCIONES = ['antrop', 'bioquim', 'clinico', 'dietetico', 'conclusion'] as const
export type Seccion = (typeof SECCIONES)[number]

/** Sin antropometría no hay valoración: es la sección que la sostiene. */
const SECCIONES_EXIGIDAS: Seccion[] = ['antrop', 'conclusion']

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function noEncontradaConsulta() {
  return { error: 'consulta_no_encontrada', message: 'No se encontró la consulta' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

const CAMPOS = `
  c.id, c.tipo::text as tipo, c.numero_consulta, c.estado::text as estado,
  to_char(c.fecha_consulta, 'YYYY-MM-DD') as fecha_consulta,
  c.secciones_completas, c.paciente_id, c.created_at, c.updated_at
`

export function aConsulta(f: Record<string, unknown>) {
  return {
    id: f['id'] as string,
    pacienteId: f['paciente_id'] as string,
    tipo: f['tipo'] as 'inicial' | 'seguimiento',
    numeroConsulta: Number(f['numero_consulta']),
    estado: f['estado'] as 'borrador' | 'finalizada',
    fechaConsulta: f['fecha_consulta'] as string,
    seccionesCompletas: (f['secciones_completas'] ?? {}) as Record<string, boolean>,
    profesional: (f['profesional_nombre'] as string | undefined) ?? null,
    createdAt: f['created_at'] as Date,
    updatedAt: f['updated_at'] as Date,
  }
}

/** El paciente, si quien pregunta puede verlo. */
export async function pacienteVisible(
  pacienteId: string,
  tenantId: string,
  restringirA: string | null,
): Promise<boolean> {
  if (!esUuid(pacienteId)) return false
  const { rowCount } = await pool.query(
    `select 1 from paciente
      where id = $1 and clinica_id = $2
        and ($3::uuid is null or nutricionista_id = $3)`,
    [pacienteId, tenantId, restringirA],
  )
  return (rowCount ?? 0) > 0
}

export async function registerConsultasRoutes(app: FastifyInstance): Promise<void> {
  async function cargarConsulta(
    consultaId: string,
    pacienteId: string,
    tenantId: string,
    restringirA: string | null,
  ) {
    if (!esUuid(consultaId) || !esUuid(pacienteId)) return null
    const { rows } = await pool.query(
      `select ${CAMPOS}
         from consulta c
         join paciente p on p.id = c.paciente_id
        where c.id = $1 and c.paciente_id = $2 and c.clinica_id = $3
          and ($4::uuid is null or p.nutricionista_id = $4)`,
      [consultaId, pacienteId, tenantId, restringirA],
    )
    return rows[0] ?? null
  }

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/consultas                                 */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/pacientes/:id/consultas',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      /*
       * El ordinal se calcula y se inserta en la MISMA sentencia.
       *
       * Con un `select count(*)` previo, dos consultas creadas a la vez
       * obtendrían el mismo número; la restricción única lo rechazaría y
       * el profesional vería un error incomprensible. Aquí el número
       * sale de una subconsulta dentro del propio insert.
       */
      const { rows } = await pool.query(
        `insert into consulta (clinica_id, paciente_id, profesional_id, numero_consulta, tipo)
         select $1, $2, $3, n.siguiente,
                case when n.siguiente > 1 then 'seguimiento' else 'inicial' end::tipo_consulta
           from (select coalesce(max(numero_consulta), 0) + 1 as siguiente
                   from consulta where clinica_id = $1 and paciente_id = $2) n
         returning ${CAMPOS.replace(/c\./g, '')}`,
        [tenantId, id, alcance.profesionalId],
      )

      return reply.code(201).send(aConsulta(rows[0] as Record<string, unknown>))
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/consultas                                  */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/consultas',
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
        `select ${CAMPOS}, pr.nombre as profesional_nombre
           from consulta c
           join profesional pr on pr.id = c.profesional_id
          where c.clinica_id = $1 and c.paciente_id = $2
          order by c.numero_consulta desc`,
        [tenantId, id],
      )
      return reply.send(rows.map(aConsulta))
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/consultas/:consultaId                      */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/consultas/:consultaId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const consulta = await cargarConsulta(
        request.params.consultaId,
        request.params.id,
        tenantId,
        alcance.restringirA,
      )
      if (!consulta) return reply.code(404).send(noEncontradaConsulta())
      return reply.send(aConsulta(consulta as Record<string, unknown>))
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/pacientes/:id/consultas/:consultaId/seccion              */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/consultas/:consultaId/seccion',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const consulta = await cargarConsulta(
        request.params.consultaId,
        request.params.id,
        tenantId,
        alcance.restringirA,
      )
      if (!consulta) return reply.code(404).send(noEncontradaConsulta())

      if ((consulta as Record<string, unknown>)['estado'] === 'finalizada') {
        return reply.code(409).send({
          error: 'consulta_finalizada',
          message: 'Una consulta finalizada no se edita: es el registro de lo que se valoró',
        })
      }

      const cuerpo = (request.body ?? {}) as { seccion?: unknown; completa?: unknown }
      const seccion = cuerpo.seccion
      if (typeof seccion !== 'string' || !SECCIONES.includes(seccion as Seccion)) {
        return reply.code(400).send({
          error: 'validacion',
          message: `Sección no válida. Debe ser una de: ${SECCIONES.join(', ')}`,
          errores: [{ campo: 'seccion', mensaje: `Una de: ${SECCIONES.join(', ')}` }],
        })
      }
      if (typeof cuerpo.completa !== 'boolean') {
        return reply.code(400).send({
          error: 'validacion',
          message: 'Indica si la sección queda completa',
          errores: [{ campo: 'completa', mensaje: 'Debe ser verdadero o falso' }],
        })
      }

      // jsonb_set con create_if_missing: la primera vez la clave no
      // existe y sin ese flag el UPDATE no haría nada en silencio.
      const { rows } = await pool.query(
        `update consulta
            set secciones_completas = jsonb_set(secciones_completas, $1::text[], $2::jsonb, true)
          where id = $3
        returning ${CAMPOS.replace(/c\./g, '')}`,
        [`{${seccion}}`, JSON.stringify(cuerpo.completa), (consulta as { id: string }).id],
      )
      return reply.send(aConsulta(rows[0] as Record<string, unknown>))
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/pacientes/:id/consultas/:consultaId/finalizar            */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/consultas/:consultaId/finalizar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const consulta = await cargarConsulta(
        request.params.consultaId,
        request.params.id,
        tenantId,
        alcance.restringirA,
      )
      if (!consulta) return reply.code(404).send(noEncontradaConsulta())

      const fila = consulta as Record<string, unknown>
      if (fila['estado'] === 'finalizada') {
        return reply.code(409).send({
          error: 'consulta_finalizada',
          message: 'Esta consulta ya está finalizada',
        })
      }

      // La comprobación se repite aquí aunque el botón esté
      // deshabilitado en pantalla: el botón decide qué se ve, no qué se
      // puede.
      const completas = (fila['secciones_completas'] ?? {}) as Record<string, boolean>
      const faltan = SECCIONES_EXIGIDAS.filter((s) => completas[s] !== true)
      if (faltan.length > 0) {
        return reply.code(409).send({
          error: 'secciones_incompletas',
          message: 'Faltan secciones por completar antes de finalizar',
          faltan,
        })
      }

      const { rows } = await pool.query(
        `update consulta set estado = 'finalizada' where id = $1
         returning ${CAMPOS.replace(/c\./g, '')}`,
        [fila['id']],
      )
      return reply.send(aConsulta(rows[0] as Record<string, unknown>))
    },
  )
}
