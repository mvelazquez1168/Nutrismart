/**
 * Rutas de agenda — Rebanada 4 (CLI-03).
 *
 * Doble acotación en todas: por `clinica_id` del token y por el alcance
 * del solicitante. Un `nutricionista` solo ve sus citas; un
 * `admin_clinica`, las de toda la clínica.
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { validarCita, validarEstado, CITA_ESTADOS, type CitaEstado } from '../agenda/validacion.js'
import {
  listarCitas,
  obtenerCita,
  crearCita,
  actualizarCita,
  cambiarEstado,
  registrarControl,
  CitaSolapadaError,
  CitaNoEditableError,
  TransicionInvalidaError,
  PacienteNoVisibleError,
  ControlYaRegistradoError,
  CitaNoCompletadaError,
  BorradorAbiertoError,
} from '../agenda/repositorio.js'

interface ParamsId {
  id: string
}

interface QueryAgenda {
  desde?: string
  hasta?: string
  estado?: string
  pacienteId?: string
}

function noEncontrada() {
  return { error: 'cita_no_encontrada', message: 'No se encontró la cita' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

/**
 * El mensaje NO incluye la hora del choque, y `choque` viaja aparte con
 * los timestamps en crudo.
 *
 * Formatear la hora aquí obligaría al servidor a elegir un huso: como
 * la base trabaja en UTC, el usuario leería "21:00" para una cita que
 * en su agenda son las 15:00. Quien conoce el huso del profesional es
 * el navegador.
 */
function respuestaSolape(error: CitaSolapadaError) {
  return {
    error: 'cita_solapada',
    message: 'Ya tienes otra cita en esa franja.',
    choque: error.choque,
  }
}

/** Por defecto, los próximos 7 días: es lo que el profesional mira al abrir. */
function rangoPorDefecto(): { desde: string; hasta: string } {
  const ahora = new Date()
  const desde = new Date(ahora)
  desde.setHours(0, 0, 0, 0)
  const hasta = new Date(desde)
  hasta.setDate(hasta.getDate() + 7)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

export async function registerAgendaRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/citas                                                    */
  /* ---------------------------------------------------------------- */
  app.get<{ Querystring: QueryAgenda }>(
    '/api/citas',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const porDefecto = rangoPorDefecto()
      const desdeRaw = request.query.desde?.trim()
      const hastaRaw = request.query.hasta?.trim()

      const desde = desdeRaw ? new Date(desdeRaw) : new Date(porDefecto.desde)
      const hasta = hastaRaw ? new Date(hastaRaw) : new Date(porDefecto.hasta)

      if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
        return reply
          .code(400)
          .send({ error: 'rango_invalido', message: 'Las fechas desde/hasta no son válidas' })
      }
      if (hasta <= desde) {
        return reply
          .code(400)
          .send({ error: 'rango_invalido', message: '"hasta" debe ser posterior a "desde"' })
      }

      const estadoRaw = request.query.estado?.trim().toLowerCase()
      if (estadoRaw && !(CITA_ESTADOS as readonly string[]).includes(estadoRaw)) {
        return reply.code(400).send({
          error: 'estado_invalido',
          message: `estado debe ser uno de: ${CITA_ESTADOS.join(', ')}`,
        })
      }

      const pacienteId = request.query.pacienteId?.trim()
      if (pacienteId && !esUuid(pacienteId)) {
        return reply.code(400).send({ error: 'paciente_invalido', message: 'pacienteId inválido' })
      }

      return listarCitas(tenantId, alcance.restringirA, {
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        estado: (estadoRaw as CitaEstado | undefined) ?? null,
        pacienteId: pacienteId ?? null,
      })
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/citas                                                   */
  /* ---------------------------------------------------------------- */
  app.post('/api/citas', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const validacion = validarCita(request.body, true)
    if (!validacion.ok) {
      return reply.code(400).send({ error: 'validacion', errores: validacion.errores })
    }

    try {
      // La cita se agenda SIEMPRE a nombre de quien la crea. Agendar
      // para otro profesional es una función posterior, y permitirlo
      // sin más saltaría el control de solapes del titular.
      const id = await crearCita(tenantId, alcance.restringirA, alcance.profesionalId, validacion.datos)
      return reply.code(201).send({ id, estado: 'programada' })
    } catch (error) {
      if (error instanceof PacienteNoVisibleError) {
        return reply.code(404).send({
          error: 'paciente_no_encontrado',
          message: 'No se encontró el paciente, o está archivado',
        })
      }
      if (error instanceof CitaSolapadaError) {
        return reply.code(409).send(respuestaSolape(error))
      }
      throw error
    }
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/citas/:id                                                */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/citas/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrada())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const cita = await obtenerCita(tenantId, alcance.restringirA, id)
      if (!cita) return reply.code(404).send(noEncontrada())
      return cita
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/citas/:id                                                */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: ParamsId }>(
    '/api/citas/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrada())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const validacion = validarCita(request.body, false)
      if (!validacion.ok) {
        return reply.code(400).send({ error: 'validacion', errores: validacion.errores })
      }

      try {
        const ok = await actualizarCita(tenantId, alcance.restringirA, id, validacion.datos)
        if (!ok) return reply.code(404).send(noEncontrada())
        return obtenerCita(tenantId, alcance.restringirA, id)
      } catch (error) {
        if (error instanceof CitaNoEditableError) {
          return reply.code(409).send({
            error: 'cita_no_editable',
            message:
              error.message === 'cancelada'
                ? 'Una cita cancelada es un registro histórico y no se edita. Agenda una nueva.'
                : 'Una cita completada registra lo que ocurrió y no se edita. Si hace falta otra consulta, agenda una nueva.',
            estadoActual: error.message,
          })
        }
        if (error instanceof CitaSolapadaError) {
          return reply.code(409).send(respuestaSolape(error))
        }
        throw error
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/citas/:id/estado                                        */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/citas/:id/estado',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrada())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const nuevo = validarEstado(request.body)
      if (!nuevo) {
        return reply.code(400).send({
          error: 'estado_invalido',
          message: `estado debe ser uno de: ${CITA_ESTADOS.join(', ')}`,
        })
      }

      try {
        const ok = await cambiarEstado(tenantId, alcance.restringirA, id, nuevo)
        if (!ok) return reply.code(404).send(noEncontrada())
        return { id, estado: nuevo }
      } catch (error) {
        if (error instanceof TransicionInvalidaError) {
          return reply.code(409).send({
            error: 'transicion_invalida',
            message: `Una cita ${error.message} ya no cambia de estado. Si hace falta otra consulta, agenda una nueva.`,
            estadoActual: error.message,
          })
        }
        throw error
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/citas/:id/control                                       */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/citas/:id/control',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontrada())

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      try {
        const snapshotId = await registrarControl(
          tenantId,
          alcance.restringirA,
          id,
          alcance.profesionalId,
        )
        if (!snapshotId) return reply.code(404).send(noEncontrada())
        return reply.code(201).send({ citaId: id, snapshotId, estado: 'borrador' })
      } catch (error) {
        if (error instanceof CitaNoCompletadaError) {
          return reply.code(409).send({
            error: 'cita_no_completada',
            message: 'Marca la cita como completada antes de registrar el control.',
            estadoActual: error.message,
          })
        }
        if (error instanceof ControlYaRegistradoError) {
          return reply.code(409).send({
            error: 'control_ya_registrado',
            message: 'Esta cita ya tiene un control clínico asociado.',
            snapshotId: error.message,
          })
        }
        if (error instanceof BorradorAbiertoError) {
          return reply.code(409).send({
            error: 'borrador_abierto',
            message:
              'Este paciente ya tiene un punto de control en borrador. Ciérralo antes de registrar otro.',
          })
        }
        throw error
      }
    },
  )
}
