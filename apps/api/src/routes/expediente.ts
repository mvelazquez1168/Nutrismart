/**
 * Rutas del expediente y el timeline — Rebanada 3 (CLI-01).
 *
 * Como en pacientes: clinica_id sale del token y un :id de otra clinica
 * responde 404. La excepcion deliberada es /corregir, que devuelve 409
 * cuando el snapshot existe pero no esta cerrado — ahi el cliente ya
 * esta autorizado sobre el recurso, asi que detallar el motivo no
 * revela nada y es lo que el frontend necesita para explicarse.
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverProfesional } from '../pacientes/repositorio.js'
import { validarSnapshot } from '../expediente/validacion.js'
import {
  obtenerCatalogo,
  obtenerExpediente,
  obtenerTimeline,
  crearSnapshot,
  obtenerSnapshotBase,
  actualizarSnapshot,
  cerrarSnapshot,
  corregirSnapshot,
  BorradorAbiertoError,
  SnapshotNoEditableError,
  SnapshotNoCerradoError,
} from '../expediente/repositorio.js'

interface ParamsId {
  id: string
}

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function noEncontradoSnapshot() {
  return { error: 'snapshot_no_encontrado', message: 'No se encontró el punto de control' }
}

export async function registerExpedienteRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/metricas                                                 */
  /* ---------------------------------------------------------------- */
  app.get('/api/metricas', { preHandler: requireAuth }, async () => {
    // El catalogo es global y de solo lectura; no se acota por tenant.
    return obtenerCatalogo()
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/expediente                                 */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/pacientes/:id/expediente',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const catalogo = await obtenerCatalogo()
      const expediente = await obtenerExpediente(tenantId, id, catalogo)
      if (!expediente) return reply.code(404).send(noEncontradoPaciente())

      return expediente
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/snapshots                                  */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/pacientes/:id/snapshots',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      // Se comprueba que el paciente exista en esta clinica antes de
      // devolver una lista vacia: si no, un id ajeno daria [] en vez de
      // 404, y un [] es una respuesta que se interpreta como "existe y
      // no tiene controles".
      const catalogo = await obtenerCatalogo()
      const expediente = await obtenerExpediente(tenantId, id, catalogo)
      if (!expediente) return reply.code(404).send(noEncontradoPaciente())

      return obtenerTimeline(tenantId, id, catalogo)
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/snapshots                                 */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/pacientes/:id/snapshots',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoPaciente())

      const catalogo = await obtenerCatalogo()
      const validacion = validarSnapshot(request.body, catalogo)
      if (!validacion.ok) {
        return reply.code(400).send({ error: 'validacion', errores: validacion.errores })
      }

      const profesionalId = await resolverProfesional(tenantId, sub)

      try {
        const snapshotId = await crearSnapshot(tenantId, id, profesionalId, validacion.datos)
        if (!snapshotId) return reply.code(404).send(noEncontradoPaciente())
        return reply.code(201).send({ id: snapshotId, estado: 'borrador', fecha: validacion.datos.fecha })
      } catch (error) {
        if (error instanceof BorradorAbiertoError) {
          return reply.code(409).send({
            error: 'borrador_abierto',
            message:
              'Este paciente ya tiene un punto de control en borrador. Ciérralo o edítalo antes de crear otro.',
          })
        }
        throw error
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/snapshots/:id                                            */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/snapshots/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoSnapshot())

      const base = await obtenerSnapshotBase(tenantId, id)
      if (!base) return reply.code(404).send(noEncontradoSnapshot())

      const catalogo = await obtenerCatalogo()
      const timeline = await obtenerTimeline(tenantId, base.pacienteId, catalogo)

      // Puede venir anidado como version corregida de otro.
      const encontrado =
        timeline.find((s) => s.id === id) ??
        timeline.map((s) => s.corregidoPor).find((s) => s?.id === id) ??
        null

      if (!encontrado) return reply.code(404).send(noEncontradoSnapshot())
      return encontrado
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/snapshots/:id                                            */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: ParamsId }>(
    '/api/snapshots/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoSnapshot())

      const catalogo = await obtenerCatalogo()
      const validacion = validarSnapshot(request.body, catalogo)
      if (!validacion.ok) {
        return reply.code(400).send({ error: 'validacion', errores: validacion.errores })
      }

      const profesionalId = await resolverProfesional(tenantId, sub)

      try {
        await actualizarSnapshot(tenantId, id, profesionalId, validacion.datos)
        return { id, estado: 'borrador', fecha: validacion.datos.fecha }
      } catch (error) {
        if (error instanceof SnapshotNoEditableError) {
          if (error.message === 'no_encontrado') {
            return reply.code(404).send(noEncontradoSnapshot())
          }
          // La inmutabilidad del snapshot cerrado se aplica en el
          // servidor, no escondiendo un boton en la interfaz.
          return reply.code(409).send({
            error: 'snapshot_inmutable',
            message:
              'Este punto de control está cerrado y no se puede editar. Usa "Corregir" para crear una versión nueva.',
            estado: error.message,
          })
        }
        throw error
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/snapshots/:id/cerrar                                    */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/snapshots/:id/cerrar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoSnapshot())

      const resultado = await cerrarSnapshot(tenantId, id)
      if (!resultado) return reply.code(404).send(noEncontradoSnapshot())

      return { id, ...resultado }
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/snapshots/:id/corregir                                  */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId }>(
    '/api/snapshots/:id/corregir',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub } = request.auth
      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradoSnapshot())

      const profesionalId = await resolverProfesional(tenantId, sub)

      try {
        const nuevoId = await corregirSnapshot(tenantId, id, profesionalId)
        return reply.code(201).send({ id: nuevoId, corrigeA: id, estado: 'borrador' })
      } catch (error) {
        if (error instanceof SnapshotNoCerradoError) {
          if (error.message === 'no_encontrado') {
            return reply.code(404).send(noEncontradoSnapshot())
          }
          return reply.code(409).send({
            error: 'snapshot_no_cerrado',
            message:
              error.message === 'borrador'
                ? 'Este punto de control está en borrador: edítalo directamente, no hace falta corregirlo.'
                : 'Este punto de control ya fue corregido por una versión posterior.',
            estado: error.message,
          })
        }
        if (error instanceof BorradorAbiertoError) {
          return reply.code(409).send({
            error: 'borrador_abierto',
            message:
              'Este paciente ya tiene un punto de control en borrador. Ciérralo antes de corregir otro.',
          })
        }
        throw error
      }
    },
  )
}
