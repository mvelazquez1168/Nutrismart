/**
 * Rutas del super-administrador de NutriSmart (plataforma).
 *
 * Estas rutas crean clínicas y sus primeros usuarios admin. Solo son
 * accesibles para usuarios con el rol `super_admin` en Keycloak.
 *
 * Flujo:
 *   1. POST /api/superadmin/clinicas          — crea la clínica
 *   2. POST /api/superadmin/clinicas/:id/admin — crea el admin de la clínica
 *      (crea el usuario en Keycloak + el row en profesional)
 *
 * Requiere KEYCLOAK_SVC_CLIENT y KEYCLOAK_SVC_SECRET configurados.
 *
 * ── Por qué `requireSuperAdmin` y no `requireAuth` ──────────────────
 *
 * `requireAuth` exige el claim `tenant_id` y responde **401** si falta. El
 * operador de plataforma no pertenece a ninguna clínica, así que con
 * `requireAuth` todo este módulo devolvía 401 antes de comprobar ningún
 * rol, y la única salida habría sido inventarle en Keycloak el `tenant_id`
 * de una clínica que no existe — un UUID falso que acabaría usándose como
 * filtro en alguna query.
 *
 * **Con este preHandler, `request.auth` NO existe: el contexto está en
 * `request.authSuper`.** Añadir aquí una guarda del tipo
 * `request.auth.roles.includes(...)` no es redundancia inofensiva: revienta
 * con «Cannot read properties of null» en TODAS las rutas del módulo, y el
 * compilador no lo ve porque `auth` está declarado como no-nulo. El rol ya
 * lo exige `requireSuperAdmin`, que responde 403 por su cuenta.
 *
 * La clínica sobre la que se actúa viaja en la ruta y se comprueba contra
 * la base, que es más estricto que confiar en un claim.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireSuperAdmin } from '../auth.js'
import {
  crearUsuarioKeycloak,
  enviarEmailActivacion,
  eliminarUsuarioKeycloak,
  asignarRolKeycloak,
} from '../keycloak-admin.js'
import { config } from '../config.js'

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function registerSuperAdminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Crea una nueva clínica en la plataforma.
   * Body: { nombre_comercial, pais }
   */
  app.post<{ Body: Record<string, unknown> }>(
    '/api/superadmin/clinicas',
    { preHandler: requireSuperAdmin },
    async (request, reply) => {
      const b = request.body ?? {}
      const nombreComercial =
        typeof b['nombre_comercial'] === 'string' ? b['nombre_comercial'].trim() : ''
      if (nombreComercial === '' || nombreComercial.length > 200) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'nombre_comercial es requerido (máx 200 chars)' })
      }

      const pais = typeof b['pais'] === 'string' ? b['pais'].trim() : ''
      if (pais === '' || pais.length > 100) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'pais es requerido (máx 100 chars)' })
      }

      const { rows } = await pool.query<{ id: string }>(
        `insert into clinica (nombre_comercial, pais) values ($1, $2) returning id`,
        [nombreComercial, pais],
      )

      return reply.code(201).send({ id: rows[0]!.id, nombre_comercial: nombreComercial, pais })
    },
  )

  /**
   * Lista todas las clínicas (para el panel super-admin).
   */
  app.get(
    '/api/superadmin/clinicas',
    { preHandler: requireSuperAdmin },
    async (_request, reply) => {
      const { rows } = await pool.query(
        `select id, nombre_comercial, nombre_fiscal, pais, created_at
         from clinica order by created_at desc`,
      )

      return reply.send(rows)
    },
  )

  /**
   * Crea el primer usuario admin de una clínica.
   * Crea el usuario en Keycloak y el row en profesional con rol admin_clinica.
   * Body: { nombre, correo }
   */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/superadmin/clinicas/:id/admin',
    { preHandler: requireSuperAdmin },
    async (request, reply) => {
      if (!config.keycloak.adminEnabled) {
        return reply.code(503).send({
          error: 'keycloak_admin_no_configurado',
          message: 'Configura KEYCLOAK_SVC_CLIENT y KEYCLOAK_SVC_SECRET para crear usuarios automáticamente',
        })
      }

      const clinicaId = request.params.id
      if (!UUID_RE.test(clinicaId)) {
        return reply.code(400).send({ error: 'validacion', message: 'ID de clínica inválido' })
      }

      // Verificar que la clínica existe
      const { rows: clinica } = await pool.query(
        `select id from clinica where id = $1`,
        [clinicaId],
      )
      if (clinica.length === 0) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'Clínica no encontrada' })
      }

      const b = request.body ?? {}
      const nombre = typeof b['nombre'] === 'string' ? b['nombre'].trim() : ''
      if (nombre === '' || nombre.length > 150) {
        return reply.code(400).send({ error: 'validacion', message: 'nombre es requerido' })
      }

      const correo = typeof b['correo'] === 'string' ? b['correo'].trim().toLowerCase() : ''
      if (!RE_CORREO.test(correo) || correo.length > 150) {
        return reply.code(400).send({ error: 'validacion', message: 'correo inválido' })
      }

      // Verificar que no exista ya un admin en esa clínica con ese correo
      const { rows: repe } = await pool.query(
        `select 1 from profesional where clinica_id = $1 and lower(correo) = $2 and estado <> 'inactivo'`,
        [clinicaId, correo],
      )
      if (repe.length > 0) {
        return reply.code(409).send({ error: 'correo_repetido', message: 'Ya hay un profesional con ese correo en esta clínica' })
      }

      const username = correo.split('@')[0]!

      // Crear usuario en Keycloak
      let keycloakUserId: string
      try {
        keycloakUserId = await crearUsuarioKeycloak({
          username,
          email: correo,
          firstName: nombre,
          tenantId: clinicaId,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Error al crear usuario en Keycloak'
        if (msg.includes('Ya existe')) {
          return reply.code(409).send({ error: 'correo_repetido_keycloak', message: msg })
        }
        throw err
      }

      // Asignar rol admin_clinica en Keycloak para que el token ya lo traiga
      // desde el primer login. Si falla, hacemos rollback del usuario.
      try {
        await asignarRolKeycloak(keycloakUserId, 'admin_clinica')
      } catch (rolErr) {
        // Se ESPERA el borrado. Lanzado sin await, la respuesta de error
        // puede salir antes de que Keycloak lo procese, y el reintento
        // inmediato choca con «ya existe un usuario con ese correo».
        await eliminarUsuarioKeycloak(keycloakUserId)

        // Y se devuelve el motivo real en vez de dejarlo como un 500. Lo
        // que falla aquí es casi siempre configuración del realm —el rol no
        // existe, o al service account le falta permiso— y «el servidor
        // tuvo un problema» manda a buscar en el sitio equivocado.
        const motivo =
          rolErr instanceof Error ? rolErr.message : 'No se pudo asignar el rol admin_clinica'
        request.log.error({ err: rolErr }, 'superadmin: rol admin_clinica no asignado')
        return reply.code(503).send({ error: 'rol_no_asignado', message: motivo })
      }

      // Crear profesional en la DB
      let profesionalId: string
      try {
        const { rows } = await pool.query<{ id: string }>(
          `insert into profesional (clinica_id, keycloak_user_id, nombre, correo, rol, estado)
           values ($1, $2, $3, $4, 'admin_clinica', 'activo')
           returning id`,
          [clinicaId, keycloakUserId, nombre, correo],
        )
        profesionalId = rows[0]!.id
      } catch (dbErr) {
        void eliminarUsuarioKeycloak(keycloakUserId)
        throw dbErr
      }

      // Enviar email de activación
      void enviarEmailActivacion(keycloakUserId)

      return reply.code(201).send({
        id: profesionalId,
        keycloakUserId,
        clinicaId,
        nombre,
        correo,
        rol: 'admin_clinica',
        estado: 'activo',
      })
    },
  )
}
