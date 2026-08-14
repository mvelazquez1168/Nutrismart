/**
 * Notificaciones y reglas paramétricas — COM-02 y COM-03.
 *
 * El buzón es personal: cada profesional ve el suyo. Las reglas son de
 * la CLÍNICA — describen cómo trabaja el centro, no una preferencia
 * individual— así que cualquiera de sus profesionales las ve y las
 * edita.
 *
 * El evaluador es idempotente. Cada notificación que genera lleva una
 * clave de deduplicación, y un índice único la respalda: evaluar dos
 * veces el mismo día no duplica nada. Sin eso, el botón «Evaluar ahora»
 * sería una forma de llenarse la campana de basura.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'

/**
 * Huso de la clínica. Mismo criterio que el dashboard: hoy es constante
 * porque todas están en Costa Rica, y debería ser una columna de
 * `clinica` en cuanto haya una fuera.
 */
const ZONA_CLINICA = 'America/Costa_Rica'

const TIPOS_REGLA = ['cumpleanos', 'reminder', 'checkup', 'fecha_importante'] as const
type TipoRegla = (typeof TIPOS_REGLA)[number]

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

function noEncontradaRegla() {
  return { error: 'regla_no_encontrada', message: 'No se encontró la regla' }
}

function aNotificacion(n: Record<string, unknown>) {
  return {
    id: n['id'] as string,
    tipo: n['tipo'] as string,
    titulo: n['titulo'] as string,
    contenido: (n['contenido'] as string | null) ?? null,
    enlace: (n['enlace'] as string | null) ?? null,
    leida: n['leida'] as boolean,
    createdAt: n['created_at'] as Date,
  }
}

function aRegla(r: Record<string, unknown>) {
  return {
    id: r['id'] as string,
    nombre: r['nombre'] as string,
    tipo: r['tipo'] as TipoRegla,
    activa: r['activa'] as boolean,
    parametros: r['parametros'],
    createdAt: r['created_at'] as Date,
  }
}

/* ------------------------------------------------------------------ */
/* Validación de reglas                                                */
/* ------------------------------------------------------------------ */

/**
 * Cada tipo tiene sus parámetros y NO se aceptan otros.
 *
 * Guardar lo que venga en el JSONB parece flexible y es lo que hace que
 * el evaluador se encuentre, meses después, con una regla que no sabe
 * ejecutar y ningún sitio donde estuviera escrito el contrato.
 */
function validarParametros(
  tipo: TipoRegla,
  crudo: unknown,
): { ok: true; parametros: Record<string, unknown> } | { ok: false; errores: ErrorCampo[] } {
  const p = (crudo ?? {}) as Record<string, unknown>
  const errores: ErrorCampo[] = []

  const hora = () => {
    const v = p['hora']
    if (typeof v !== 'string' || !HORA_RE.test(v)) {
      errores.push({ campo: 'parametros.hora', mensaje: 'Debe ser una hora HH:MM' })
      return null
    }
    return v
  }

  const entero = (campo: string, min: number, max: number) => {
    const v = p[campo]
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isInteger(n) || n < min || n > max) {
      errores.push({ campo: `parametros.${campo}`, mensaje: `Debe ser un entero entre ${min} y ${max}` })
      return null
    }
    return n
  }

  let parametros: Record<string, unknown> = {}

  if (tipo === 'cumpleanos') {
    parametros = { hora: hora() }
  } else if (tipo === 'reminder') {
    parametros = { diasAntes: entero('diasAntes', 1, 30), hora: hora() }
  } else if (tipo === 'checkup') {
    parametros = { intervaloDias: entero('intervaloDias', 7, 365) }
  } else {
    const fecha = p['fecha']
    if (typeof fecha !== 'string' || !FECHA_RE.test(fecha)) {
      errores.push({ campo: 'parametros.fecha', mensaje: 'Debe ser una fecha AAAA-MM-DD' })
    }
    const mensaje = typeof p['mensaje'] === 'string' ? p['mensaje'].trim() : ''
    if (mensaje.length === 0 || mensaje.length > 200) {
      errores.push({ campo: 'parametros.mensaje', mensaje: 'Debe tener entre 1 y 200 caracteres' })
    }
    parametros = { fecha, mensaje }
  }

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, parametros }
}

export async function registerNotificacionesRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* COM-02 · Buzón                                                    */
  /* ================================================================ */

  app.get<{ Querystring: { limite?: string } }>(
    '/api/notificaciones',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const pedido = Number(request.query.limite)
      const limite = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, 50) : 20

      const { rows } = await pool.query(
        `select id, tipo::text as tipo, titulo, contenido, enlace, leida, created_at
           from notificacion
          where clinica_id = $1 and destinatario_id = $2 and destinatario_tipo = 'profesional'
          order by created_at desc
          limit $3`,
        [tenantId, alcance.profesionalId, limite],
      )
      return reply.send(rows.map(aNotificacion))
    },
  )

  app.get('/api/notificaciones/contador', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const { rows } = await pool.query<{ total: string }>(
      `select count(*) as total from notificacion
        where clinica_id = $1 and destinatario_id = $2
          and destinatario_tipo = 'profesional' and leida = false`,
      [tenantId, alcance.profesionalId],
    )
    return reply.send({ noLeidas: Number(rows[0]?.total ?? 0) })
  })

  app.put<{ Params: { id: string } }>(
    '/api/notificaciones/:id/leer',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) {
        return reply.code(404).send({ error: 'notificacion_no_encontrada', message: 'No existe' })
      }

      // El destinatario va en el WHERE: sin él, conocer un id bastaría
      // para marcar como leída la notificación de otro.
      const { rowCount } = await pool.query(
        `update notificacion set leida = true, leida_en = now()
          where id = $1 and clinica_id = $2 and destinatario_id = $3
            and destinatario_tipo = 'profesional' and leida = false`,
        [id, tenantId, alcance.profesionalId],
      )

      // Marcar como leída algo que ya lo estaba no es un error: el
      // estado final es el que pidió el cliente.
      return reply.send({ marcada: (rowCount ?? 0) > 0 })
    },
  )

  app.put('/api/notificaciones/leer-todas', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const { rowCount } = await pool.query(
      `update notificacion set leida = true, leida_en = now()
        where clinica_id = $1 and destinatario_id = $2
          and destinatario_tipo = 'profesional' and leida = false`,
      [tenantId, alcance.profesionalId],
    )
    return reply.send({ actualizadas: rowCount ?? 0 })
  })

  /* ================================================================ */
  /* COM-03 · Reglas                                                   */
  /* ================================================================ */

  app.get('/api/notificaciones/reglas', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    // Se devuelven activas e inactivas: desactivar una regla no es
    // borrarla, y hay que poder volver a encenderla.
    const { rows } = await pool.query(
      `select id, nombre, tipo::text as tipo, activa, parametros, created_at
         from regla_notificacion
        where clinica_id = $1
        order by activa desc, created_at desc`,
      [tenantId],
    )
    return reply.send(rows.map(aRegla))
  })

  app.post('/api/notificaciones/reglas', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const cuerpo = (request.body ?? {}) as Record<string, unknown>
    const errores: ErrorCampo[] = []

    const nombre = typeof cuerpo['nombre'] === 'string' ? cuerpo['nombre'].trim() : ''
    if (nombre.length === 0 || nombre.length > 120) {
      errores.push({ campo: 'nombre', mensaje: 'Debe tener entre 1 y 120 caracteres' })
    }

    const tipo = cuerpo['tipo']
    if (typeof tipo !== 'string' || !TIPOS_REGLA.includes(tipo as TipoRegla)) {
      return reply.code(400).send({
        error: 'validacion',
        message: 'Tipo de regla no válido',
        errores: [...errores, { campo: 'tipo', mensaje: `Debe ser uno de: ${TIPOS_REGLA.join(', ')}` }],
      })
    }

    const validacion = validarParametros(tipo as TipoRegla, cuerpo['parametros'])
    if (!validacion.ok) errores.push(...validacion.errores)

    if (!validacion.ok || errores.length > 0) {
      return reply
        .code(400)
        .send({ error: 'validacion', message: 'Revisa los datos de la regla', errores })
    }

    const { rows } = await pool.query(
      `insert into regla_notificacion (clinica_id, nombre, tipo, parametros, created_by)
            values ($1, $2, $3::tipo_regla, $4::jsonb, $5)
         returning id, nombre, tipo::text as tipo, activa, parametros, created_at`,
      [tenantId, nombre, tipo, JSON.stringify(validacion.parametros), alcance.profesionalId],
    )
    return reply.code(201).send(aRegla(rows[0] as Record<string, unknown>))
  })

  app.put<{ Params: { id: string } }>(
    '/api/notificaciones/reglas/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradaRegla())

      const { rows: actuales } = await pool.query<{ tipo: TipoRegla }>(
        'select tipo::text as tipo from regla_notificacion where id = $1 and clinica_id = $2',
        [id, tenantId],
      )
      const actual = actuales[0]
      if (!actual) return reply.code(404).send(noEncontradaRegla())

      const cuerpo = (request.body ?? {}) as Record<string, unknown>
      const sets: string[] = []
      const params: unknown[] = []
      const errores: ErrorCampo[] = []

      if (cuerpo['nombre'] !== undefined) {
        const nombre = typeof cuerpo['nombre'] === 'string' ? cuerpo['nombre'].trim() : ''
        if (nombre.length === 0 || nombre.length > 120) {
          errores.push({ campo: 'nombre', mensaje: 'Debe tener entre 1 y 120 caracteres' })
        } else {
          params.push(nombre)
          sets.push(`nombre = $${params.length}`)
        }
      }

      if (cuerpo['parametros'] !== undefined) {
        // El tipo NO se cambia en una edición: cambiarlo convertiría la
        // regla en otra distinta con el mismo historial detrás.
        const v = validarParametros(actual.tipo, cuerpo['parametros'])
        if (!v.ok) errores.push(...v.errores)
        else {
          params.push(JSON.stringify(v.parametros))
          sets.push(`parametros = $${params.length}::jsonb`)
        }
      }

      if (errores.length > 0) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa los datos de la regla', errores })
      }
      if (sets.length === 0) {
        const { rows } = await pool.query(
          `select id, nombre, tipo::text as tipo, activa, parametros, created_at
             from regla_notificacion where id = $1`,
          [id],
        )
        return reply.send(aRegla(rows[0] as Record<string, unknown>))
      }

      params.push(id, tenantId)
      const { rows } = await pool.query(
        `update regla_notificacion set ${sets.join(', ')}
          where id = $${params.length - 1} and clinica_id = $${params.length}
        returning id, nombre, tipo::text as tipo, activa, parametros, created_at`,
        params,
      )
      return reply.send(aRegla(rows[0] as Record<string, unknown>))
    },
  )

  app.put<{ Params: { id: string } }>(
    '/api/notificaciones/reglas/:id/activar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradaRegla())

      const cuerpo = (request.body ?? {}) as { activa?: unknown }
      if (typeof cuerpo.activa !== 'boolean') {
        return reply.code(400).send({
          error: 'validacion',
          message: 'Indica si la regla queda activa',
          errores: [{ campo: 'activa', mensaje: 'Debe ser verdadero o falso' }],
        })
      }

      const { rows } = await pool.query<{ activa: boolean }>(
        `update regla_notificacion set activa = $1
          where id = $2 and clinica_id = $3
        returning activa`,
        [cuerpo.activa, id, tenantId],
      )
      if (!rows[0]) return reply.code(404).send(noEncontradaRegla())
      return reply.send({ activa: rows[0].activa })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/notificaciones/reglas/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!esUuid(id)) return reply.code(404).send(noEncontradaRegla())

      // Baja lógica: la regla explica por qué se generaron las
      // notificaciones que ya existen. Borrarla dejaría ese historial
      // sin causa.
      const { rowCount } = await pool.query(
        'update regla_notificacion set activa = false where id = $1 and clinica_id = $2',
        [id, tenantId],
      )
      if ((rowCount ?? 0) === 0) return reply.code(404).send(noEncontradaRegla())
      return reply.code(204).send()
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/notificaciones/reglas/evaluar                           */
  /* ---------------------------------------------------------------- */
  app.post(
    '/api/notificaciones/reglas/evaluar',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { rows: reglas } = await pool.query<{
        id: string
        nombre: string
        tipo: TipoRegla
        parametros: Record<string, unknown>
      }>(
        `select id, nombre, tipo::text as tipo, parametros
           from regla_notificacion
          where clinica_id = $1 and activa = true`,
        [tenantId],
      )

      // El día se calcula en el huso de la clínica: en UTC, "hoy"
      // empieza a las 18:00 de ayer en Costa Rica y los cumpleaños se
      // avisarían con un día de desfase.
      const { rows: hoyRows } = await pool.query<{ hoy: string }>(
        `select to_char((now() at time zone $1)::date, 'YYYY-MM-DD') as hoy`,
        [ZONA_CLINICA],
      )
      const hoy = hoyRows[0]?.hoy ?? ''

      let generadas = 0

      /**
       * Inserta si la clave no existe ya.
       *
       * El índice único parcial sobre (clinica_id, clave_dedup) es quien
       * lo garantiza: dos evaluaciones simultáneas no pueden colarse
       * entre el `select` y el `insert` porque no hay `select`.
       */
      async function crear(datos: {
        destinatarioId: string
        tipo: string
        titulo: string
        contenido: string | null
        enlace: string | null
        clave: string
      }): Promise<void> {
        const { rowCount } = await pool.query(
          `insert into notificacion
             (clinica_id, destinatario_id, destinatario_tipo, tipo, titulo, contenido, enlace, clave_dedup)
           values ($1, $2, 'profesional', $3::tipo_notificacion, $4, $5, $6, $7)
           on conflict (clinica_id, clave_dedup) where clave_dedup is not null do nothing`,
          [tenantId, datos.destinatarioId, datos.tipo, datos.titulo, datos.contenido, datos.enlace, datos.clave],
        )
        generadas += rowCount ?? 0
      }

      for (const regla of reglas) {
        if (regla.tipo === 'cumpleanos') {
          // Se compara mes y día, no la fecha completa.
          const { rows } = await pool.query<{ id: string; nombre: string; destinatario: string }>(
            `select p.id, p.nombre, coalesce(p.nutricionista_id, $2) as destinatario
               from paciente p
              where p.clinica_id = $1 and p.estado = 'activo'
                and p.fecha_nacimiento is not null
                and to_char(p.fecha_nacimiento, 'MM-DD')
                    = to_char((now() at time zone $3)::date, 'MM-DD')`,
            [tenantId, alcance.profesionalId, ZONA_CLINICA],
          )
          for (const p of rows) {
            await crear({
              destinatarioId: p.destinatario,
              tipo: 'cumpleanos',
              titulo: `${p.nombre} cumple años hoy`,
              contenido: regla.nombre,
              enlace: `/pacientes/${p.id}`,
              clave: `cumpleanos:${p.destinatario}:${p.id}:${hoy}`,
            })
          }
        } else if (regla.tipo === 'reminder') {
          const diasAntes = Number(regla.parametros['diasAntes'] ?? 1)
          const { rows } = await pool.query<{
            id: string
            paciente: string
            profesional_id: string
            inicio: Date
          }>(
            `select c.id, pac.nombre as paciente, c.profesional_id, c.inicio
               from cita c
               join paciente pac on pac.id = c.paciente_id
              where c.clinica_id = $1 and c.estado = 'programada'
                and c.inicio >= now()
                and c.inicio < now() + ($2 || ' days')::interval`,
            [tenantId, String(diasAntes)],
          )
          for (const c of rows) {
            await crear({
              destinatarioId: c.profesional_id,
              tipo: 'cita_proxima',
              titulo: `Cita próxima con ${c.paciente}`,
              contenido: regla.nombre,
              enlace: '/agenda',
              // Una cita se recuerda UNA vez, no cada evaluación.
              clave: `reminder:${c.profesional_id}:${c.id}`,
            })
          }
        } else if (regla.tipo === 'checkup') {
          const intervalo = Number(regla.parametros['intervaloDias'] ?? 30)
          const { rows } = await pool.query<{ id: string; nombre: string; destinatario: string }>(
            `select p.id, p.nombre, coalesce(p.nutricionista_id, $2) as destinatario
               from paciente p
              where p.clinica_id = $1 and p.estado = 'activo'
                and (p.ultima_visita is null
                     or p.ultima_visita < (now() at time zone $4)::date - ($3 || ' days')::interval)`,
            [tenantId, alcance.profesionalId, String(intervalo), ZONA_CLINICA],
          )
          for (const p of rows) {
            await crear({
              destinatarioId: p.destinatario,
              tipo: 'checkup',
              titulo: `${p.nombre} lleva tiempo sin consulta`,
              contenido: `${regla.nombre} · más de ${intervalo} días`,
              enlace: `/pacientes/${p.id}`,
              clave: `checkup:${p.destinatario}:${p.id}:${hoy}`,
            })
          }
        } else {
          // fecha_importante: es de la clínica, así que la reciben
          // todos sus profesionales activos.
          if (regla.parametros['fecha'] !== hoy) continue
          const { rows } = await pool.query<{ id: string }>(
            `select id from profesional where clinica_id = $1 and estado <> 'inactivo'`,
            [tenantId],
          )
          for (const prof of rows) {
            await crear({
              destinatarioId: prof.id,
              tipo: 'fecha_importante',
              titulo: String(regla.parametros['mensaje'] ?? regla.nombre),
              contenido: regla.nombre,
              enlace: null,
              clave: `fecha_importante:${prof.id}:${regla.id}:${hoy}`,
            })
          }
        }
      }

      return reply.send({ generadas, reglasEvaluadas: reglas.length })
    },
  )
}
