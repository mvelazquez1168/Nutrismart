/**
 * Mensajería y plan desde la app del paciente — PAC-03, PAC-04.
 *
 * Reutiliza `conversacion` y `mensaje` de la Rebanada 13, ya probadas
 * desde el lado del profesional. La clínica sale de la fila de
 * `paciente`, nunca del token.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuthPaciente } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'

interface Pac {
  id: string
  clinica_id: string
}

async function resolverPaciente(sub: string): Promise<Pac | undefined> {
  const { rows } = await pool.query<Pac>(
    `select id, clinica_id from paciente
      where keycloak_user_id = $1 and estado = 'activo'`,
    [sub],
  )
  return rows[0]
}

/**
 * Distingue al profesional que se equivocó de aplicación del paciente
 * que aún no ha usado su enlace. Mismo criterio que en `paciente.ts`.
 */
async function sinExpediente(sub: string) {
  const { rows } = await pool.query(
    `select 1 from profesional where keycloak_user_id = $1 limit 1`,
    [sub],
  )
  return rows[0]
    ? {
        codigo: 403,
        cuerpo: {
          error: 'solo_pacientes',
          message: 'Esta zona es solo para pacientes. Entra por la aplicación profesional.',
        },
      }
    : {
        codigo: 404,
        cuerpo: {
          error: 'sin_vincular',
          message: 'Tu cuenta todavía no está vinculada a un expediente.',
        },
      }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export async function registerPacienteMensajeriaRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* PAC-03 · Mensajería                                               */
  /* ================================================================ */

  app.get(
    '/api/paciente/conversacion',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const SQL_LEER = `
        select c.id, c.profesional_id, c.mensajes_no_leidos_pac,
               prof.nombre as profesional
          from conversacion c
          join profesional prof on prof.id = c.profesional_id
         where c.clinica_id = $1 and c.paciente_id = $2 and c.activa = true
         order by c.ultimo_mensaje_at desc nulls last
         limit 1`

      const existente = await pool.query(SQL_LEER, [pac.clinica_id, pac.id])
      if (existente.rows[0]) {
        const c = existente.rows[0]
        return reply.send({
          id: c['id'],
          profesional: c['profesional'],
          mensajesSinLeer: Number(c['mensajes_no_leidos_pac'] ?? 0),
        })
      }

      // No hay conversación todavía. Se abre con el profesional que le
      // invitó; si no hay invitación aceptada, no hay a quién escribir.
      const { rows: inv } = await pool.query<{ profesional_id: string }>(
        `select profesional_id from invitacion_paciente
          where paciente_id = $1 and clinica_id = $2 and estado = 'aceptada'
          order by usado_en desc limit 1`,
        [pac.id, pac.clinica_id],
      )
      const profesionalId = inv[0]?.profesional_id
      if (!profesionalId) {
        return reply.code(404).send({
          error: 'sin_conversacion',
          message: 'Todavía no hay una conversación abierta. Tu nutricionista la iniciará.',
        })
      }

      // UPSERT contra el índice único real (clinica, paciente,
      // profesional). El encargo usaba `on conflict do nothing` sin
      // objetivo y luego releía: con dos pestañas abiertas la relectura
      // puede caer entre el insert y el commit de la otra.
      await pool.query(
        `insert into conversacion (clinica_id, paciente_id, profesional_id)
         values ($1,$2,$3)
         on conflict (clinica_id, paciente_id, profesional_id)
         do update set activa = true`,
        [pac.clinica_id, pac.id, profesionalId],
      )

      const creada = await pool.query(SQL_LEER, [pac.clinica_id, pac.id])
      const c = creada.rows[0]!
      return reply.send({
        id: c['id'],
        profesional: c['profesional'],
        mensajesSinLeer: Number(c['mensajes_no_leidos_pac'] ?? 0),
      })
    },
  )

  app.get<{ Querystring: { desde?: string } }>(
    '/api/paciente/conversacion/mensajes',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { rows: convs } = await pool.query<{ id: string }>(
        `select id from conversacion
          where clinica_id = $1 and paciente_id = $2 and activa = true
          limit 1`,
        [pac.clinica_id, pac.id],
      )
      const conv = convs[0]
      // Sin conversación no hay mensajes, y eso no es un error: la
      // pantalla enseña el hilo vacío.
      if (!conv) return reply.send([])

      // Abrir el hilo marca como leído lo del profesional. Es un efecto
      // sobre un GET, y es lo correcto aquí: leer es exactamente lo que
      // el paciente está haciendo.
      await pool.query(
        `update mensaje set leido = true, leido_en = now()
          where conversacion_id = $1 and autor_tipo = 'profesional' and leido = false`,
        [conv.id],
      )
      await pool.query(`update conversacion set mensajes_no_leidos_pac = 0 where id = $1`, [
        conv.id,
      ])

      const desde = request.query.desde
      const hayDesde = typeof desde === 'string' && desde.trim() !== ''

      // `created_at` se devuelve con microsegundos porque el cliente lo
      // reenvia tal cual como `desde`. Truncado al segundo, el ultimo
      // mensaje vuelve a salir en cada sondeo.

      // Los últimos 50, no los primeros. El encargo ordenaba ascendente
      // con LIMIT 50: en un hilo de doscientos mensajes eso devuelve los
      // cincuenta MAS ANTIGUOS y el paciente nunca ve lo recién escrito.
      const { rows } = await pool.query(
        `select * from (
           select m.id, m.autor_tipo::text as autor_tipo, m.contenido, m.leido,
                  to_char(m.created_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') as created_at,
                  m.created_at as orden
             from mensaje m
            where m.conversacion_id = $1
              and ($2::timestamptz is null or m.created_at > $2::timestamptz)
            order by m.created_at desc
            limit 50
         ) ultimos
         order by orden asc`,
        [conv.id, hayDesde ? desde : null],
      )

      return reply.send(
        rows.map((m) => ({
          id: m['id'],
          autorTipo: m['autor_tipo'],
          contenido: m['contenido'],
          leido: m['leido'],
          createdAt: m['created_at'],
        })),
      )
    },
  )

  app.post<{ Body: { contenido?: unknown } }>(
    '/api/paciente/conversacion/mensajes',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const bruto = request.body?.contenido
      const contenido = typeof bruto === 'string' ? bruto.trim() : ''
      if (contenido === '' || contenido.length > 4000) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'El mensaje debe tener entre 1 y 4000 caracteres',
        })
      }

      const { rows: convs } = await pool.query<{ id: string; profesional_id: string }>(
        `select id, profesional_id from conversacion
          where clinica_id = $1 and paciente_id = $2 and activa = true
          limit 1`,
        [pac.clinica_id, pac.id],
      )
      const conv = convs[0]
      if (!conv) {
        return reply.code(404).send({
          error: 'sin_conversacion',
          message: 'Todavía no hay una conversación abierta',
        })
      }

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        // clinica_id es NOT NULL en `mensaje`: el insert del encargo lo
        // omitía y habría fallado siempre.
        const { rows } = await cliente.query(
          `insert into mensaje (clinica_id, conversacion_id, autor_tipo, autor_id, contenido)
           values ($1,$2,'paciente',$3,$4)
           returning id, autor_tipo::text as autor_tipo, contenido, leido,
                     to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF') as created_at`,
          [pac.clinica_id, conv.id, pac.id, contenido],
        )

        await cliente.query(
          `update conversacion
              set ultimo_mensaje_at = now(),
                  mensajes_no_leidos_prof = mensajes_no_leidos_prof + 1
            where id = $1`,
          [conv.id],
        )

        // Misma forma que la notificación al paciente de la Rebanada 13,
        // en sentido contrario. Sin clave_dedup, igual que allí: cambiar
        // solo este lado dejaría las dos direcciones comportándose
        // distinto sin motivo.
        await cliente.query(
          `insert into notificacion
             (clinica_id, destinatario_id, destinatario_tipo, tipo, titulo, contenido, enlace)
           values ($1,$2,'profesional','mensaje_nuevo',$3,$4,$5)`,
          [
            pac.clinica_id,
            conv.profesional_id,
            'Nuevo mensaje de un paciente',
            contenido.slice(0, 140),
            `/mensajeria/${conv.id}`,
          ],
        )

        await cliente.query('commit')

        const m = rows[0]!
        return reply.code(201).send({
          id: m['id'],
          autorTipo: m['autor_tipo'],
          contenido: m['contenido'],
          leido: m['leido'],
          createdAt: m['created_at'],
        })
      } catch (e) {
        await cliente.query('rollback')
        throw e
      } finally {
        cliente.release()
      }
    },
  )

  /* ================================================================ */
  /* PAC-04 · Plan y acuerdos                                          */
  /* ================================================================ */

  app.get('/api/paciente/plan', { preHandler: requireAuthPaciente }, async (request, reply) => {
    const pac = await resolverPaciente(request.authPac.sub)
    if (!pac) {
      const r = await sinExpediente(request.authPac.sub)
      return reply.code(r.codigo).send(r.cuerpo)
    }

    const { rows: planes } = await pool.query(
      `select con.id as consulta_id, con.numero_consulta,
              to_char(con.fecha_consulta,'YYYY-MM-DD') as fecha,
              cv.kcal_prescritas, cv.pct_proteina, cv.pct_cho, cv.pct_grasa,
              cv.proteina_g, cv.cho_g, cv.grasa_g,
              cv.restricciones, cv.suplementos, cv.acuerdos,
              prof.nombre as profesional
         from conclusion_valoracion cv
         join consulta con on con.id = cv.consulta_id
         left join profesional prof on prof.id = con.profesional_id
        where con.clinica_id = $1 and con.paciente_id = $2
          and con.estado = 'finalizada'
        order by con.numero_consulta desc
        limit 1`,
      [pac.clinica_id, pac.id],
    )
    const p = planes[0]

    if (!p) {
      return reply.send({
        plan: null,
        mensaje: 'Tu nutricionista todavía no ha cerrado una consulta con tu plan.',
      })
    }

    const { rows: registros } = await pool.query(
      `select acuerdo_index, acuerdo_texto, cumplido, nota_paciente,
              to_char(registrado_en,'YYYY-MM-DD"T"HH24:MI:SSOF') as registrado_en
         from cumplimiento_acuerdo
        where paciente_id = $1 and consulta_id = $2`,
      [pac.id, p['consulta_id']],
    )

    const acuerdos = ((p['acuerdos'] ?? []) as { texto: string; cumplido: boolean }[]).map(
      (a, i) => {
        const r = registros.find((x) => Number(x['acuerdo_index']) === i)
        // El registro solo cuenta si el acuerdo sigue diciendo lo mismo.
        // Si el profesional lo editó o reordenó la lista, lo que el
        // paciente marcó era otra cosa: se descarta y el acuerdo aparece
        // sin marcar, que es la verdad.
        const vigente = r !== undefined && r['acuerdo_texto'] === a.texto
        return {
          index: i,
          texto: a.texto,
          // Lo que marcó el profesional en consulta y lo que reporta el
          // paciente son dos cosas distintas, y se muestran por separado.
          cumplidoProfesional: a.cumplido === true,
          cumplidoPaciente: vigente ? r['cumplido'] === true : false,
          registradoEn: vigente ? r['registrado_en'] : null,
          notaPaciente: vigente ? r['nota_paciente'] : null,
        }
      },
    )

    return reply.send({
      plan: {
        consultaId: p['consulta_id'],
        numeroConsulta: Number(p['numero_consulta']),
        fecha: p['fecha'],
        profesional: p['profesional'],
        kcal: num(p['kcal_prescritas']),
        pctProteina: num(p['pct_proteina']),
        pctCho: num(p['pct_cho']),
        pctGrasa: num(p['pct_grasa']),
        proteinaG: num(p['proteina_g']),
        choG: num(p['cho_g']),
        grasaG: num(p['grasa_g']),
        restricciones: (p['restricciones'] ?? []) as string[],
        suplementos: p['suplementos'],
        acuerdos,
      },
    })
  })

  app.post<{
    Params: { consultaId: string; index: string }
    Body: { cumplido?: unknown; nota?: unknown }
  }>(
    '/api/paciente/acuerdos/:consultaId/:index/cumplir',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { consultaId, index } = request.params
      const idx = Number.parseInt(index, 10)
      if (!esUuid(consultaId) || !Number.isInteger(idx) || idx < 0) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Consulta o índice no válidos' })
      }

      // La consulta tiene que ser de ESTE paciente y estar finalizada.
      // Un consultaId de otro paciente cae aquí como 404.
      const { rows: acuerdosFila } = await pool.query<{ acuerdos: unknown }>(
        `select cv.acuerdos
           from conclusion_valoracion cv
           join consulta con on con.id = cv.consulta_id
          where con.id = $1 and con.clinica_id = $2 and con.paciente_id = $3
            and con.estado = 'finalizada'`,
        [consultaId, pac.clinica_id, pac.id],
      )
      const lista = (acuerdosFila[0]?.acuerdos ?? []) as { texto: string }[]
      const acuerdo = lista[idx]
      if (!acuerdo) {
        return reply
          .code(404)
          .send({ error: 'acuerdo_no_encontrado', message: 'No se encontró ese acuerdo' })
      }

      const cumplido = request.body?.cumplido !== false
      const notaBruta = request.body?.nota
      const nota =
        typeof notaBruta === 'string' && notaBruta.trim() !== ''
          ? notaBruta.trim().slice(0, 500)
          : null

      const { rows } = await pool.query(
        `insert into cumplimiento_acuerdo
           (clinica_id, paciente_id, consulta_id, acuerdo_index, acuerdo_texto, cumplido, nota_paciente)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (paciente_id, consulta_id, acuerdo_index)
         do update set cumplido = excluded.cumplido,
                       acuerdo_texto = excluded.acuerdo_texto,
                       nota_paciente = excluded.nota_paciente,
                       registrado_en = now()
         returning cumplido,
                   to_char(registrado_en,'YYYY-MM-DD"T"HH24:MI:SSOF') as registrado_en`,
        [pac.clinica_id, pac.id, consultaId, idx, acuerdo.texto, cumplido, nota],
      )

      return reply.send({
        cumplido: rows[0]!['cumplido'],
        registradoEn: rows[0]!['registrado_en'],
      })
    },
  )
}
