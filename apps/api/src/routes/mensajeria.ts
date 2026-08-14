/**
 * Mensajería profesional–paciente — COM-01.
 *
 * Un hilo por par paciente–profesional dentro de la clínica.
 *
 * La conversación pertenece a quien está en ella. Un `admin_clinica` ve
 * todos los pacientes, pero NO los hilos de sus compañeros: leer la
 * conversación de otro profesional con su paciente no es supervisión,
 * es abrir el correo ajeno. Por eso aquí se filtra siempre por
 * `profesional_id`, no por el alcance de lectura de pacientes.
 *
 * El alcance sí manda al ABRIR un hilo: un nutricionista solo puede
 * empezar una conversación con un paciente suyo.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'

const MAX_CONTENIDO = 4000

function noEncontradaConversacion() {
  return { error: 'conversacion_no_encontrada', message: 'No se encontró la conversación' }
}

function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

interface FilaConversacion extends Record<string, unknown> {
  id: string
  paciente_id: string
  paciente_nombre: string
  ultimo_mensaje_at: Date | null
  ultimo_contenido: string | null
  ultimo_autor: string | null
  mensajes_no_leidos_prof: number
}

function aConversacion(f: FilaConversacion) {
  return {
    id: f.id,
    paciente: { id: f.paciente_id, nombre: f.paciente_nombre },
    ultimoMensajeAt: f.ultimo_mensaje_at,
    ultimoContenido: f.ultimo_contenido,
    ultimoAutor: f.ultimo_autor,
    noLeidos: Number(f.mensajes_no_leidos_prof),
  }
}

function aMensaje(m: Record<string, unknown>) {
  return {
    id: m['id'] as string,
    autorTipo: m['autor_tipo'] as 'profesional' | 'paciente',
    contenido: m['contenido'] as string,
    leido: m['leido'] as boolean,
    createdAt: m['created_at'] as Date,
  }
}

export async function registerMensajeriaRoutes(app: FastifyInstance): Promise<void> {
  /** El hilo, solo si pertenece a quien pregunta. */
  async function cargarConversacion(convId: string, tenantId: string, profesionalId: string) {
    if (!esUuid(convId)) return null
    const { rows } = await pool.query<{ id: string; paciente_id: string }>(
      `select id, paciente_id from conversacion
        where id = $1 and clinica_id = $2 and profesional_id = $3`,
      [convId, tenantId, profesionalId],
    )
    return rows[0] ?? null
  }

  /* ---------------------------------------------------------------- */
  /* GET /api/mensajeria/conversaciones                                */
  /* ---------------------------------------------------------------- */
  app.get('/api/mensajeria/conversaciones', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    // El último mensaje llega por LATERAL en vez de por subconsulta
    // correlacionada: se resuelve una vez por hilo y no una por columna.
    const { rows } = await pool.query<FilaConversacion>(
      `select c.id, c.paciente_id, p.nombre as paciente_nombre,
              c.ultimo_mensaje_at, c.mensajes_no_leidos_prof,
              m.contenido as ultimo_contenido,
              m.autor_tipo::text as ultimo_autor
         from conversacion c
         join paciente p on p.id = c.paciente_id
         left join lateral (
           select contenido, autor_tipo
             from mensaje
            where conversacion_id = c.id
            order by created_at desc
            limit 1
         ) m on true
        where c.clinica_id = $1 and c.profesional_id = $2 and c.activa = true
        order by c.ultimo_mensaje_at desc nulls last, c.created_at desc`,
      [tenantId, alcance.profesionalId],
    )

    return reply.send(rows.map(aConversacion))
  })

  /* ---------------------------------------------------------------- */
  /* POST /api/mensajeria/conversaciones                               */
  /* ---------------------------------------------------------------- */
  app.post('/api/mensajeria/conversaciones', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const cuerpo = (request.body ?? {}) as { pacienteId?: unknown }
    const pacienteId = typeof cuerpo.pacienteId === 'string' ? cuerpo.pacienteId : ''
    if (!esUuid(pacienteId)) return reply.code(404).send(noEncontradoPaciente())

    // Aquí SÍ manda el alcance: un nutricionista no abre un hilo con un
    // paciente que no es suyo.
    const visible = await pool.query(
      `select 1 from paciente
        where id = $1 and clinica_id = $2
          and ($3::uuid is null or nutricionista_id = $3)`,
      [pacienteId, tenantId, alcance.restringirA],
    )
    if (visible.rowCount === 0) return reply.code(404).send(noEncontradoPaciente())

    // ON CONFLICT ... DO UPDATE de una columna a sí misma para que el
    // RETURNING devuelva la fila también cuando ya existía; con DO
    // NOTHING no devuelve nada y haría falta un segundo SELECT.
    const { rows } = await pool.query<FilaConversacion>(
      `insert into conversacion (clinica_id, paciente_id, profesional_id)
            values ($1, $2, $3)
       on conflict (clinica_id, paciente_id, profesional_id)
       do update set activa = true
       returning id, paciente_id, ultimo_mensaje_at, mensajes_no_leidos_prof`,
      [tenantId, pacienteId, alcance.profesionalId],
    )

    const { rows: pac } = await pool.query<{ nombre: string }>(
      'select nombre from paciente where id = $1',
      [pacienteId],
    )

    return reply.code(201).send(
      aConversacion({
        ...(rows[0] as FilaConversacion),
        paciente_nombre: pac[0]?.nombre ?? '',
        ultimo_contenido: null,
        ultimo_autor: null,
      }),
    )
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/mensajeria/conversaciones/:convId/mensajes               */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { convId: string }; Querystring: { desde?: string } }>(
    '/api/mensajeria/conversaciones/:convId/mensajes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const conv = await cargarConversacion(request.params.convId, tenantId, alcance.profesionalId)
      if (!conv) return reply.code(404).send(noEncontradaConversacion())

      // `desde` sirve al sondeo: pide solo lo posterior al último
      // mensaje que ya tiene, en vez de traerse el hilo entero cada
      // cinco segundos.
      const desde = request.query.desde
      const fechaDesde = desde ? new Date(desde) : null
      const valida = fechaDesde !== null && !Number.isNaN(fechaDesde.getTime())

      const { rows } = await pool.query(
        valida
          ? `select id, autor_tipo::text as autor_tipo, contenido, leido, created_at
               from mensaje
              where conversacion_id = $1 and created_at > $2
              order by created_at asc limit 100`
          : `select id, autor_tipo::text as autor_tipo, contenido, leido, created_at
               from mensaje
              where conversacion_id = $1
              order by created_at asc limit 100`,
        valida ? [conv.id, fechaDesde] : [conv.id],
      )

      return reply.send(rows.map(aMensaje))
    },
  )

  /* ---------------------------------------------------------------- */
  /* POST /api/mensajeria/conversaciones/:convId/mensajes              */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { convId: string } }>(
    '/api/mensajeria/conversaciones/:convId/mensajes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const conv = await cargarConversacion(request.params.convId, tenantId, alcance.profesionalId)
      if (!conv) return reply.code(404).send(noEncontradaConversacion())

      const cuerpo = (request.body ?? {}) as { contenido?: unknown }
      const contenido = typeof cuerpo.contenido === 'string' ? cuerpo.contenido.trim() : ''
      if (contenido.length === 0 || contenido.length > MAX_CONTENIDO) {
        return reply.code(400).send({
          error: 'validacion',
          message: `El mensaje debe tener entre 1 y ${MAX_CONTENIDO} caracteres`,
          errores: [{ campo: 'contenido', mensaje: `Entre 1 y ${MAX_CONTENIDO} caracteres` }],
        })
      }

      /*
       * Mensaje, contadores y notificación en UNA transacción.
       *
       * Los contadores están desnormalizados: si el mensaje entrara y el
       * incremento no, la bandeja del paciente diría que no tiene nada
       * pendiente teniendo un mensaje sin leer. Y una notificación sin
       * su mensaje llevaría a un hilo donde no hay nada.
       */
      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        const { rows } = await cliente.query(
          `insert into mensaje (clinica_id, conversacion_id, autor_tipo, autor_id, contenido)
                values ($1, $2, 'profesional', $3, $4)
             returning id, autor_tipo::text as autor_tipo, contenido, leido, created_at`,
          [tenantId, conv.id, alcance.profesionalId, contenido],
        )

        await cliente.query(
          `update conversacion
              set ultimo_mensaje_at = now(),
                  mensajes_no_leidos_pac = mensajes_no_leidos_pac + 1
            where id = $1`,
          [conv.id],
        )

        // El destinatario es el PACIENTE. La app del paciente aún no
        // existe (épica PAC), pero el aviso queda registrado desde ya:
        // así no hay que reprocesar el histórico cuando exista.
        await cliente.query(
          `insert into notificacion
             (clinica_id, destinatario_id, destinatario_tipo, tipo, titulo, contenido, enlace)
           values ($1, $2, 'paciente', 'mensaje_nuevo', $3, $4, $5)`,
          [
            tenantId,
            conv.paciente_id,
            'Nuevo mensaje de tu nutricionista',
            contenido.slice(0, 140),
            `/mensajeria/${conv.id}`,
          ],
        )

        await cliente.query('commit')
        return reply.code(201).send(aMensaje(rows[0] as Record<string, unknown>))
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT /api/mensajeria/conversaciones/:convId/leer                   */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { convId: string } }>(
    '/api/mensajeria/conversaciones/:convId/leer',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const conv = await cargarConversacion(request.params.convId, tenantId, alcance.profesionalId)
      if (!conv) return reply.code(404).send(noEncontradaConversacion())

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')
        // Solo los del PACIENTE: marcar como leídos los propios no
        // significa nada, el profesional ya sabe lo que escribió.
        const { rowCount } = await cliente.query(
          `update mensaje set leido = true, leido_en = now()
            where conversacion_id = $1 and autor_tipo = 'paciente' and leido = false`,
          [conv.id],
        )
        await cliente.query(
          'update conversacion set mensajes_no_leidos_prof = 0 where id = $1',
          [conv.id],
        )
        await cliente.query('commit')
        return reply.send({ marcados: rowCount ?? 0 })
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/mensajeria/no-leidos                                     */
  /* ---------------------------------------------------------------- */
  app.get('/api/mensajeria/no-leidos', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    const { rows } = await pool.query<{ total: string }>(
      `select coalesce(sum(mensajes_no_leidos_prof), 0) as total
         from conversacion
        where clinica_id = $1 and profesional_id = $2 and activa = true`,
      [tenantId, alcance.profesionalId],
    )

    return reply.send({ total: Number(rows[0]?.total ?? 0) })
  })
}
