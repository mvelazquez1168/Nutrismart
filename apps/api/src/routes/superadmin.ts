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
  buscarUsuarioKeycloakPorEmail,
  crearUsuarioKeycloak,
  enviarEmailActivacion,
  eliminarUsuarioKeycloak,
  asignarRolKeycloak,
} from '../keycloak-admin.js'
import { config } from '../config.js'

/**
 * Lo único que ve el operador cuando algo falla del lado de Keycloak.
 *
 * Antes se le devolvía el mensaje de Keycloak tal cual —«Keycloak create
 * user error 409: {...}», rutas del Admin API, nombres de realm—. Eso no
 * le sirve de nada a quien está delante de la pantalla y, de paso,
 * cuenta por fuera cómo está montado el servidor.
 *
 * El detalle NO se pierde: va entero a `request.log.error`, que es donde
 * hay que mirarlo.
 *
 * Las validaciones de más arriba («correo inválido», «ya hay un
 * profesional con ese correo») sí siguen diciendo lo suyo: son nuestras,
 * describen algo que la persona puede arreglar y no revelan nada.
 */
const ERROR_GENERICO = 'No se pudo completar la operación. Intenta de nuevo.'

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

      /*
       * Primero se BUSCA, y solo si no está se crea.
       *
       * Antes se creaba siempre, y a la segunda clínica de la misma
       * persona Keycloak devolvía 409 y la pantalla decía «ya existe un
       * usuario con ese correo» — un callejón sin salida: ni se podía
       * crear ni había forma de usar la cuenta que ya existía. Alguien
       * que asesora a dos clínicas es un caso normal, no un error.
       *
       * Un fallo de la búsqueda NO se trata como «no existe». Si
       * Keycloak no contesta y se sigue adelante, el intento de crear
       * acaba en el mismo 409 de antes; peor aún, si contestara a
       * medias se crearía un duplicado.
       */
      let keycloakUserId: string
      let usuarioExistente: boolean

      let encontrado: Awaited<ReturnType<typeof buscarUsuarioKeycloakPorEmail>>
      try {
        encontrado = await buscarUsuarioKeycloakPorEmail(correo)
      } catch (err) {
        request.log.error({ err, correo }, 'superadmin: fallo al buscar el usuario en Keycloak')
        return reply.code(503).send({ error: 'keycloak_error', message: ERROR_GENERICO })
      }

      if (encontrado) {
        // Solo se le asigna el rol. No se le tocan ni el nombre, ni el
        // correo, ni el `tenant_id`: esa cuenta ya es de alguien y
        // pisarle los datos desde aquí le cambiaría la clínica en la
        // que trabaja. Ver la nota de la respuesta.
        keycloakUserId = encontrado.id
        usuarioExistente = true
      } else {
        try {
          keycloakUserId = await crearUsuarioKeycloak({
            username,
            email: correo,
            firstName: nombre,
            tenantId: clinicaId,
          })
          usuarioExistente = false
        } catch (err) {
          request.log.error({ err, correo }, 'superadmin: fallo al crear el usuario en Keycloak')
          return reply.code(503).send({ error: 'keycloak_error', message: ERROR_GENERICO })
        }
      }

      // Asignar rol admin_clinica en Keycloak para que el token ya lo traiga
      // desde el primer login. `asignarRolKeycloak` es idempotente: si ya
      // lo tiene, no hace nada.
      try {
        await asignarRolKeycloak(keycloakUserId, 'admin_clinica')
      } catch (rolErr) {
        // El rollback SOLO si acabamos de crear la cuenta. Borrar un
        // usuario que ya existía por un fallo nuestro al asignarle un
        // rol le quitaría el acceso a la clínica donde ya trabajaba.
        //
        // Se ESPERA el borrado. Lanzado sin await, la respuesta de error
        // puede salir antes de que Keycloak lo procese, y el reintento
        // inmediato choca con «ya existe un usuario con ese correo».
        if (!usuarioExistente) {
          await eliminarUsuarioKeycloak(keycloakUserId)
        }

        request.log.error({ err: rolErr }, 'superadmin: rol admin_clinica no asignado')
        return reply.code(503).send({ error: 'rol_no_asignado', message: ERROR_GENERICO })
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
        // Mismo criterio que arriba: no se borra una cuenta que ya era
        // de alguien.
        if (!usuarioExistente) void eliminarUsuarioKeycloak(keycloakUserId)
        request.log.error({ err: dbErr, clinicaId, correo }, 'superadmin: alta de admin fallida')
        return reply.code(500).send({ error: 'alta_fallida', message: ERROR_GENERICO })
      }

      /*
       * El correo de activación SOLO para cuentas nuevas.
       *
       * `execute-actions-email` con UPDATE_PASSWORD le pediría a quien ya
       * tiene cuenta que se invente una contraseña nueva, como si la
       * suya no valiera. Quien ya entra a NutriSmart entra igual: lo
       * único que ha cambiado es que ahora también es administrador de
       * esta clínica.
       */
      if (!usuarioExistente) {
        void enviarEmailActivacion(keycloakUserId)
      }

      return reply.code(201).send({
        id: profesionalId,
        keycloakUserId,
        clinicaId,
        nombre,
        correo,
        rol: 'admin_clinica',
        estado: 'activo',
        /** Para que la pantalla sepa si decir «se le envió un correo». */
        usuarioExistente,
        /*
         * El `tenant_id` que ese usuario ya tenía, si tenía otro.
         *
         * No se toca a propósito, y conviene que quien mire la pantalla
         * lo sepa: ese claim es el que decide en qué clínica actúa su
         * token (`requireAuth` en auth.ts). Mientras una cuenta solo
         * pueda llevar un `tenant_id`, esta persona seguirá entrando a
         * la clínica de antes aunque aquí conste como administradora.
         */
        tenantIdPrevio:
          usuarioExistente && encontrado?.tenantId && encontrado.tenantId !== clinicaId
            ? encontrado.tenantId
            : null,
      })
    },
  )
}
