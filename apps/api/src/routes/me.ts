/**
 * GET /api/me
 *
 * Devuelve el profesional autenticado y su clinica, segun el contrato de
 * docs/REBANADA-01.md.
 *
 * La busqueda usa DOS condiciones, no una: keycloak_user_id = sub Y
 * clinica_id = tenant_id. Buscar solo por keycloak_user_id bastaria para
 * encontrar la fila, pero entonces un token cuyo tenant_id no coincida
 * con la clinica del profesional pasaria sin ser detectado. Exigir ambas
 * hace que un token incoherente no devuelva nada.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'

interface MeRow {
  profesional_id: string
  profesional_nombre: string
  profesional_rol: string
  clinica_id: string
  clinica_nombre: string
}

const SQL = `
  select
    prof.id              as profesional_id,
    prof.nombre          as profesional_nombre,
    prof.rol::text       as profesional_rol,
    cli.id               as clinica_id,
    cli.nombre_comercial as clinica_nombre
  from profesional prof
  join clinica cli on cli.id = prof.clinica_id
  where prof.keycloak_user_id = $1
    and prof.clinica_id       = $2
    and prof.estado <> 'inactivo'
  limit 1
`

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/me', { preHandler: requireAuth }, async (request, reply) => {
    const { sub, tenantId } = request.auth

    const { rows } = await pool.query<MeRow>(SQL, [sub, tenantId])
    const row = rows[0]

    if (!row) {
      // El token es valido, pero no hay profesional que le corresponda en
      // esta clinica. Suele significar que el seed no tiene el 'sub' real
      // del usuario de Keycloak en profesional.keycloak_user_id.
      request.log.warn({ sub, tenantId }, '/api/me: sin profesional para este token')
      return reply.code(404).send({
        error: 'profesional_no_encontrado',
        message: 'El usuario autenticado no tiene un profesional asociado en esta clinica',
      })
    }

    return {
      profesional: {
        id: row.profesional_id,
        nombre: row.profesional_nombre,
        rol: row.profesional_rol,
      },
      clinica: {
        id: row.clinica_id,
        nombre: row.clinica_nombre,
      },
    }
  })
}
