/**
 * Rutas de pacientes — Rebanada 2.
 *
 * Aislamiento entre inquilinos: clinica_id sale SIEMPRE de request.auth,
 * nunca de la query string ni del cuerpo. Un :id de otra clinica
 * responde 404, no 403: un 403 confirmaria que ese paciente existe en
 * otro sitio, y eso ya es informacion clinica filtrada.
 */
import type { FastifyInstance } from 'fastify'
import { requireAuth } from '../auth.js'
import { validarPaciente, esUuid } from '../pacientes/validacion.js'
import {
  listar,
  obtenerDetalle,
  crear,
  actualizar,
  darDeBaja,
  resolverProfesional,
  DocumentoDuplicadoError,
  ExpedienteEnCarreraError,
} from '../pacientes/repositorio.js'

const ESTADOS_CLINICOS = ['normal', 'alerta', 'critico'] as const

interface QueryLista {
  search?: string
  estadoClinico?: string
}

interface ParamsId {
  id: string
}

interface CuerpoBaja {
  motivo?: string
}

export async function registerPacientesRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes                                                */
  /* ---------------------------------------------------------------- */
  app.get<{ Querystring: QueryLista }>(
    '/api/pacientes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth

      const searchRaw = request.query.search?.trim()
      const search = searchRaw ? searchRaw : null

      const estadoRaw = request.query.estadoClinico?.trim().toLowerCase()
      let estadoClinico: string | null = null

      if (estadoRaw) {
        // Se valida contra la lista en vez de pasarlo a Postgres: un
        // valor fuera del enum daria un 500 en lugar de un 400 claro.
        if (!(ESTADOS_CLINICOS as readonly string[]).includes(estadoRaw)) {
          return reply.code(400).send({
            error: 'estado_clinico_invalido',
            message: `estadoClinico debe ser uno de: ${ESTADOS_CLINICOS.join(', ')}`,
          })
        }
        estadoClinico = estadoRaw
      }

      return listar(tenantId, search, estadoClinico)
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes                                               */
  /* ---------------------------------------------------------------- */
  app.post('/api/pacientes', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub } = request.auth

    const validacion = validarPaciente(request.body)
    if (!validacion.ok) {
      return reply.code(400).send({ error: 'validacion', errores: validacion.errores })
    }

    // El nutricionista asignado es quien da de alta. Sin esto todo
    // paciente nuevo apareceria como "Sin asignar" en la lista.
    const profesionalId = await resolverProfesional(tenantId, sub)
    if (!profesionalId) {
      request.log.warn({ sub, tenantId }, 'POST pacientes: sin profesional en esta clinica')
      return reply.code(403).send({
        error: 'profesional_no_encontrado',
        message: 'Tu usuario no tiene un profesional asociado en esta clínica',
      })
    }

    try {
      const creado = await crear(tenantId, profesionalId, validacion.datos)
      return reply.code(201).send({ ...creado, estado: 'activo' })
    } catch (error) {
      if (error instanceof DocumentoDuplicadoError) {
        // 409 y no 400: la peticion esta bien formada, lo que choca es
        // el estado del servidor. Permite al formulario distinguir
        // "corrige el campo" de "ese paciente ya existe".
        return reply.code(409).send({
          error: 'documento_duplicado',
          message: 'Ya existe un paciente con ese número de documento en tu clínica',
        })
      }
      if (error instanceof ExpedienteEnCarreraError) {
        request.log.error({ tenantId }, 'no se pudo asignar numero de expediente tras varios intentos')
        return reply.code(503).send({
          error: 'expediente_no_asignado',
          message: 'No se pudo asignar el número de expediente. Vuelve a intentarlo.',
        })
      }
      throw error
    }
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id                                            */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: ParamsId }>(
    '/api/pacientes/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params

      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const detalle = await obtenerDetalle(tenantId, id)
      if (!detalle) return reply.code(404).send(noEncontrado())

      return detalle
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/pacientes/:id                                            */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: ParamsId }>(
    '/api/pacientes/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params

      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const validacion = validarPaciente(request.body)
      if (!validacion.ok) {
        return reply.code(400).send({ error: 'validacion', errores: validacion.errores })
      }

      try {
        const detalle = await actualizar(tenantId, id, validacion.datos)
        if (!detalle) return reply.code(404).send(noEncontrado())
        return detalle
      } catch (error) {
        if (error instanceof DocumentoDuplicadoError) {
          return reply.code(409).send({
            error: 'documento_duplicado',
            message: 'Ya existe otro paciente con ese número de documento en tu clínica',
          })
        }
        throw error
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/baja                                      */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: ParamsId; Body: CuerpoBaja }>(
    '/api/pacientes/:id/baja',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId } = request.auth
      const { id } = request.params

      if (!esUuid(id)) return reply.code(404).send(noEncontrado())

      const motivoRaw = request.body?.motivo
      const motivo = typeof motivoRaw === 'string' && motivoRaw.trim() !== '' ? motivoRaw.trim() : null

      const resultado = await darDeBaja(tenantId, id, motivo)
      if (!resultado) return reply.code(404).send(noEncontrado())

      return { id, ...resultado }
    },
  )
}

function noEncontrado() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}
