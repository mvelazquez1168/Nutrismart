/**
 * Configuración de la clínica y gestión del equipo — GAM-01 y GAM-02.
 *
 * ── De dónde sale la autoridad para ser administrador ──────────────
 *
 * De **las dos partes a la vez**: el rol `admin_clinica` en el token de
 * Keycloak Y `profesional.rol = 'admin_clinica'` en la base.
 *
 * No es redundancia. En este proyecto quien concede el acceso es
 * Keycloak: el token es lo que la API verifica y lo único que el
 * navegador no puede falsear. Si bastara la columna de la base, cambiar
 * un `rol` desde esta misma pantalla otorgaría permisos que Keycloak no
 * ha dado — una escalada de privilegios con formulario propio.
 *
 * Exigiendo las dos, la columna **puede quitar pero nunca dar**. Degradar
 * a alguien aquí surte efecto de inmediato; ascenderlo requiere además
 * el rol en Keycloak. La pantalla lo dice, para que nadie ascienda a un
 * compañero y se pregunte por qué no entra.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { ROL_ADMIN_CLINICA } from '../pacientes/acceso.js'
import { enviarBienvenidaProfesional } from '../equipo/email.js'

const ROLES = ['admin_clinica', 'nutricionista'] as const
type Rol = (typeof ROLES)[number]

const ESTADOS = ['activo', 'invitacion_pendiente', 'inactivo'] as const
type Estado = (typeof ESTADOS)[number]

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

interface Admin {
  profesionalId: string
}

/**
 * Resuelve al administrador que hace la petición, o el motivo por el que
 * no lo es. Devuelve `null` cuando no procede seguir.
 */
async function comoAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Admin | null> {
  const { tenantId, sub, roles } = request.auth

  const { rows } = await pool.query<{ id: string; rol: string }>(
    `select id, rol::text as rol from profesional
      where keycloak_user_id = $1 and clinica_id = $2 and estado = 'activo'`,
    [sub, tenantId],
  )
  const yo = rows[0]

  if (!yo) {
    reply.code(403).send({
      error: 'profesional_no_encontrado',
      message: 'Tu usuario no tiene un profesional activo en esta clínica',
    })
    return null
  }

  // Aquí el 403 SÍ es la respuesta correcta: no hay ningún identificador
  // ajeno que confirmar, solo se dice que esta zona no es para ti.
  if (!roles.includes(ROL_ADMIN_CLINICA) || yo.rol !== ROL_ADMIN_CLINICA) {
    reply.code(403).send({
      error: 'solo_administradores',
      message: 'Esta sección es solo para administradores de la clínica',
    })
    return null
  }

  return { profesionalId: yo.id }
}

export async function registerEquipoRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Quién soy                                                         */
  /* ================================================================ */

  /**
   * Lo usa el frontend para decidir qué pinta. No es la defensa: quien
   * manda es el 403 del servidor, que no depende de nada que el
   * navegador pueda alterar.
   */
  app.get('/api/profesional/yo', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth

    const { rows } = await pool.query(
      `select p.id, p.nombre, p.correo, p.colegiatura, p.foto_url,
              p.rol::text as rol, p.estado::text as estado,
              c.id as clinica_id,
              coalesce(c.nombre_comercial, c.nombre_fiscal) as clinica,
              c.zona_horaria
         from profesional p
         join clinica c on c.id = p.clinica_id
        where p.keycloak_user_id = $1 and p.clinica_id = $2`,
      [sub, tenantId],
    )
    const yo = rows[0]
    if (!yo) {
      return reply.code(404).send({
        error: 'profesional_no_encontrado',
        message: 'Tu usuario no tiene un profesional en esta clínica',
      })
    }

    const enToken = roles.includes(ROL_ADMIN_CLINICA)
    const enBase = yo['rol'] === ROL_ADMIN_CLINICA

    return reply.send({
      id: yo['id'],
      nombre: yo['nombre'],
      correo: yo['correo'],
      colegiatura: yo['colegiatura'],
      fotoUrl: yo['foto_url'],
      rol: yo['rol'],
      estado: yo['estado'],
      clinica: {
        id: yo['clinica_id'],
        nombre: yo['clinica'],
        zonaHoraria: yo['zona_horaria'],
      },
      // Las dos hacen falta. Devolverlas por separado permite que la
      // pantalla explique cuál falta en vez de decir «no tienes permiso».
      esAdmin: enToken && enBase,
      adminEnToken: enToken,
      adminEnBase: enBase,
    })
  })

  /* ================================================================ */
  /* Datos de la clínica                                               */
  /* ================================================================ */

  app.get('/api/admin/clinica', { preHandler: requireAuth }, async (request, reply) => {
    if (!(await comoAdmin(request, reply))) return

    const { rows } = await pool.query(
      `select id, nombre_comercial, nombre_fiscal, pais, subdominio,
              direccion, telefono, sitio_web, zona_horaria
         from clinica where id = $1`,
      [request.auth.tenantId],
    )
    const c = rows[0]!

    return reply.send({
      id: c['id'],
      nombreComercial: c['nombre_comercial'],
      nombreFiscal: c['nombre_fiscal'],
      pais: c['pais'],
      subdominio: c['subdominio'],
      direccion: c['direccion'],
      telefono: c['telefono'],
      sitioWeb: c['sitio_web'],
      zonaHoraria: c['zona_horaria'],
    })
  })

  app.patch<{ Body: Record<string, unknown> }>(
    '/api/admin/clinica',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await comoAdmin(request, reply))) return

      const b = request.body ?? {}
      const campos: string[] = []
      const args: unknown[] = [request.auth.tenantId]

      const texto = (clave: string, col: string, max: number): string | null | undefined => {
        if (!(clave in b)) return undefined
        const v = b[clave]
        if (v === null) return null
        if (typeof v !== 'string') return undefined
        const t = v.trim()
        if (t === '') return null
        return t.length > max ? undefined : t
      }

      for (const [clave, col, max] of [
        ['nombreComercial', 'nombre_comercial', 150],
        ['direccion', 'direccion', 300],
        ['telefono', 'telefono', 40],
      ] as const) {
        const v = texto(clave, col, max)
        if (v === undefined) {
          if (clave in b) {
            return reply
              .code(400)
              .send({ error: 'validacion', message: `El campo ${clave} no es válido` })
          }
          continue
        }
        // El nombre comercial es lo que ven los pacientes en sus correos:
        // vaciarlo dejaría avisos firmados por nadie.
        if (clave === 'nombreComercial' && v === null) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'La clínica necesita un nombre' })
        }
        args.push(v)
        campos.push(`${col} = $${args.length}`)
      }

      if ('sitioWeb' in b) {
        const v = b['sitioWeb']
        let valor: string | null = null
        if (v !== null && v !== '') {
          if (typeof v !== 'string' || !v.startsWith('https://') || v.length > 200) {
            return reply.code(400).send({
              error: 'validacion',
              message: 'La dirección del sitio web debe empezar por https://',
            })
          }
          valor = v.trim()
        }
        args.push(valor)
        campos.push(`sitio_web = $${args.length}`)
      }

      if ('zonaHoraria' in b) {
        const v = b['zonaHoraria']
        if (typeof v !== 'string') {
          return reply.code(400).send({ error: 'validacion', message: 'Zona horaria no válida' })
        }
        // Contra la lista real del servidor, no contra una copia que se
        // quede vieja. Un valor inventado haría reventar cualquier
        // `at time zone` que lo use después.
        const { rows } = await pool.query(
          `select 1 from pg_timezone_names where name = $1`,
          [v],
        )
        if (rows.length === 0) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'Esa zona horaria no existe' })
        }
        args.push(v)
        campos.push(`zona_horaria = $${args.length}`)
      }

      if (campos.length === 0) {
        return reply.code(400).send({ error: 'validacion', message: 'No hay nada que cambiar' })
      }

      await pool.query(`update clinica set ${campos.join(', ')} where id = $1`, args)
      return reply.send({ ok: true })
    },
  )

  /** Las zonas horarias que se ofrecen, para no escribirlas a mano. */
  app.get('/api/admin/zonas-horarias', { preHandler: requireAuth }, async (request, reply) => {
    if (!(await comoAdmin(request, reply))) return
    const { rows } = await pool.query<{ name: string }>(
      `select name from pg_timezone_names
        where name like 'America/%' or name like 'Europe/%'
        order by name`,
    )
    return reply.send(rows.map((r) => r.name))
  })

  /* ================================================================ */
  /* Equipo                                                            */
  /* ================================================================ */

  app.get('/api/admin/profesionales', { preHandler: requireAuth }, async (request, reply) => {
    if (!(await comoAdmin(request, reply))) return

    const { rows } = await pool.query(
      `select p.id, p.nombre, p.correo, p.colegiatura, p.foto_url,
              p.rol::text as rol, p.estado::text as estado,
              (p.keycloak_user_id is not null) as tiene_cuenta,
              to_char(p.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
              (select count(*) from paciente pa
                where pa.nutricionista_id = p.id and pa.estado = 'activo')::int as pacientes,
              (select count(*) from cita c
                where c.profesional_id = p.id and c.clinica_id = $1
                  and c.inicio >= now() - interval '30 days')::int as citas_30d
         from profesional p
        where p.clinica_id = $1
        -- Por rol y luego por nombre. Sobre el enum va con CASE: por el
        -- texto ordenaria alfabeticamente y 'admin_clinica' quedaria
        -- antes por casualidad, no por diseño.
        order by case p.rol when 'admin_clinica' then 0 else 1 end,
                 case p.estado when 'activo' then 0 when 'invitacion_pendiente' then 1 else 2 end,
                 p.nombre`,
      [request.auth.tenantId],
    )

    return reply.send(
      rows.map((r) => ({
        id: r['id'],
        nombre: r['nombre'],
        correo: r['correo'],
        colegiatura: r['colegiatura'],
        fotoUrl: r['foto_url'],
        rol: r['rol'],
        estado: r['estado'],
        tieneCuenta: r['tiene_cuenta'] === true,
        altaEn: r['created_at'],
        pacientes: Number(r['pacientes']),
        citas30d: Number(r['citas_30d']),
      })),
    )
  })

  app.post<{ Body: Record<string, unknown> }>(
    '/api/admin/profesionales',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!(await comoAdmin(request, reply))) return

      const b = request.body ?? {}
      const nombre = typeof b['nombre'] === 'string' ? b['nombre'].trim() : ''
      if (nombre === '' || nombre.length > 150) {
        return reply.code(400).send({ error: 'validacion', message: 'Escribe el nombre' })
      }

      const correo = typeof b['correo'] === 'string' ? b['correo'].trim().toLowerCase() : ''
      if (!RE_CORREO.test(correo) || correo.length > 150) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Escribe un correo electrónico válido' })
      }

      const rol = b['rol'] ?? 'nutricionista'
      if (typeof rol !== 'string' || !(ROLES as readonly string[]).includes(rol)) {
        return reply.code(400).send({ error: 'validacion', message: 'Ese rol no existe' })
      }

      const colegiatura =
        typeof b['colegiatura'] === 'string' && b['colegiatura'].trim() !== ''
          ? b['colegiatura'].trim().slice(0, 50)
          : null

      const { rows: repe } = await pool.query(
        `select 1 from profesional
          where clinica_id = $1 and lower(correo) = $2 and estado <> 'inactivo'`,
        [request.auth.tenantId, correo],
      )
      if (repe.length > 0) {
        return reply.code(409).send({
          error: 'correo_repetido',
          message: 'Ya hay alguien con ese correo en la clínica',
        })
      }

      // Nace en `invitacion_pendiente`, no activo.
      //
      // Esta fila NO crea la cuenta: eso lo hace el administrador de
      // Keycloak. El profesional queda vinculado en su primer acceso,
      // cuando su `keycloak_user_id` se escribe aquí. Decir que está
      // «activo» antes de eso sería afirmar que puede entrar, y no puede.
      const { rows } = await pool.query<{ id: string }>(
        `insert into profesional (clinica_id, nombre, correo, colegiatura, rol, estado)
         values ($1, $2, $3, $4, $5::profesional_rol, 'invitacion_pendiente')
         returning id`,
        [request.auth.tenantId, nombre, correo, colegiatura, rol as Rol],
      )

      const { rows: cli } = await pool.query<{ clinica: string }>(
        `select coalesce(nombre_comercial, nombre_fiscal) as clinica from clinica where id = $1`,
        [request.auth.tenantId],
      )

      // Que el correo no salga no puede tumbar el alta: la fila ya está.
      void enviarBienvenidaProfesional({
        nombre,
        correo,
        clinica: cli[0]?.clinica ?? 'tu clínica',
      })

      return reply.code(201).send({ id: rows[0]!.id, estado: 'invitacion_pendiente' })
    },
  )

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/admin/profesionales/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const admin = await comoAdmin(request, reply)
      if (!admin) return

      const { id } = request.params
      const tenantId = request.auth.tenantId

      const { rows: actual } = await pool.query<{ rol: string; estado: string }>(
        `select rol::text as rol, estado::text as estado from profesional
          where id = $1 and clinica_id = $2`,
        [esUuid(id) ? id : null, tenantId],
      )
      const yaEs = actual[0]
      if (!yaEs) {
        return reply
          .code(404)
          .send({ error: 'no_encontrado', message: 'No se encontró el profesional' })
      }

      const b = request.body ?? {}
      const nuevoRol = b['rol']
      const nuevoEstado = b['estado']

      if (nuevoRol !== undefined && (typeof nuevoRol !== 'string' || !(ROLES as readonly string[]).includes(nuevoRol))) {
        return reply.code(400).send({ error: 'validacion', message: 'Ese rol no existe' })
      }
      if (
        nuevoEstado !== undefined &&
        (typeof nuevoEstado !== 'string' || !(ESTADOS as readonly string[]).includes(nuevoEstado))
      ) {
        return reply.code(400).send({ error: 'validacion', message: 'Ese estado no existe' })
      }

      const pierdeAdmin =
        yaEs.rol === ROL_ADMIN_CLINICA &&
        (nuevoRol === 'nutricionista' || nuevoEstado === 'inactivo')

      if (pierdeAdmin) {
        const { rows: n } = await pool.query<{ total: number }>(
          `select count(*)::int as total from profesional
            where clinica_id = $1 and rol = 'admin_clinica' and estado = 'activo'`,
          [tenantId],
        )
        // Una clínica sin administrador no puede volver a tenerlo desde
        // la aplicación: nadie podría entrar a esta pantalla a arreglarlo.
        if ((n[0]?.total ?? 0) <= 1) {
          return reply.code(409).send({
            error: 'ultimo_administrador',
            message: 'Es el único administrador activo. Nombra a otro antes de cambiarlo.',
          })
        }
      }

      // Dar de baja a quien tiene pacientes los deja sin nutricionista:
      // dejan de verse en la agenda y en el monitoreo de todos menos del
      // administrador, sin que nadie se entere. Se exige a quién pasan.
      if (nuevoEstado === 'inactivo') {
        const { rows: pac } = await pool.query<{ total: number }>(
          `select count(*)::int as total from paciente
            where nutricionista_id = $1 and estado = 'activo'`,
          [id],
        )
        const cuantos = pac[0]?.total ?? 0
        if (cuantos > 0) {
          const destino = b['reasignarA']
          if (typeof destino !== 'string' || !esUuid(destino)) {
            return reply.code(409).send({
              error: 'tiene_pacientes',
              message: `Tiene ${cuantos} ${cuantos === 1 ? 'paciente' : 'pacientes'} a su cargo. Indica a quién pasan.`,
              pacientes: cuantos,
            })
          }
          const { rows: ok } = await pool.query(
            `select 1 from profesional
              where id = $1 and clinica_id = $2 and estado = 'activo' and id <> $3`,
            [destino, tenantId, id],
          )
          if (ok.length === 0) {
            return reply.code(400).send({
              error: 'validacion',
              message: 'El profesional al que quieres pasar los pacientes no está disponible',
            })
          }
          await pool.query(
            `update paciente set nutricionista_id = $1, updated_at = now()
              where nutricionista_id = $2 and estado = 'activo'`,
            [destino, id],
          )
        }
      }

      const campos: string[] = []
      const args: unknown[] = [id, tenantId]

      if (typeof b['nombre'] === 'string' && b['nombre'].trim() !== '') {
        args.push(b['nombre'].trim().slice(0, 150))
        campos.push(`nombre = $${args.length}`)
      }
      if (nuevoRol !== undefined) {
        args.push(nuevoRol as Rol)
        campos.push(`rol = $${args.length}::profesional_rol`)
      }
      if (nuevoEstado !== undefined) {
        args.push(nuevoEstado as Estado)
        campos.push(`estado = $${args.length}::profesional_estado`)
      }
      if (campos.length === 0) {
        return reply.code(400).send({ error: 'validacion', message: 'No hay nada que cambiar' })
      }

      const { rows } = await pool.query(
        `update profesional set ${campos.join(', ')}
          where id = $1 and clinica_id = $2
          returning id, nombre, rol::text as rol, estado::text as estado`,
        args,
      )
      const r = rows[0]!
      return reply.send({
        id: r['id'],
        nombre: r['nombre'],
        rol: r['rol'],
        estado: r['estado'],
      })
    },
  )
}
