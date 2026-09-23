/**
 * Alertas de seguimiento — RPM-03.
 *
 * Dos cosas: las **reglas** que el profesional pone por paciente, y las
 * **alertas** que esas reglas han disparado.
 *
 * El alcance manda en las dos (CLI-02): un nutricionista solo pone
 * reglas sobre sus pacientes y solo ve las alertas de sus pacientes; un
 * administrador de clínica, las de toda la clínica.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance, type Alcance } from '../pacientes/acceso.js'
import { evaluarAlertas } from '../rpm/evaluar-alertas.js'

const METRICAS = [
  'peso',
  'glucosa',
  'presion_sistolica',
  'presion_diastolica',
  'bienestar',
  'dias_sin_diario',
  'dias_sin_registro',
] as const
type Metrica = (typeof METRICAS)[number]

const OPERADORES = ['mayor_que', 'menor_que', 'mayor_igual_que', 'menor_igual_que'] as const
type Operador = (typeof OPERADORES)[number]

/** Rango plausible del umbral, por métrica. */
const RANGO: Record<Metrica, { min: number; max: number }> = {
  peso: { min: 20, max: 400 },
  glucosa: { min: 20, max: 800 },
  presion_sistolica: { min: 50, max: 300 },
  presion_diastolica: { min: 30, max: 200 },
  bienestar: { min: 1, max: 5 },
  dias_sin_diario: { min: 1, max: 365 },
  dias_sin_registro: { min: 1, max: 365 },
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

function noEncontrado() {
  return { error: 'no_encontrado', message: 'No se encontró' }
}

/**
 * ¿Este profesional puede tocar a este paciente?
 *
 * Un paciente de otra clínica y uno de un compañero responden lo mismo:
 * desde fuera no se debe distinguir un id inventado de uno que existe
 * pero no te toca.
 */
async function pacientePropio(
  id: string,
  tenantId: string,
  alcance: Alcance,
): Promise<boolean> {
  if (!esUuid(id)) return false
  const { rows } = await pool.query(
    `select 1 from paciente
      where id = $1 and clinica_id = $2 and estado = 'activo'
        and ($3::uuid is null or nutricionista_id = $3)`,
    [id, tenantId, alcance.restringirA],
  )
  return rows.length > 0
}

export async function registerAlertasRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Reglas de un paciente                                             */
  /* ================================================================ */

  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/alertas/config',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacientePropio(id, tenantId, alcance))) {
        return reply.code(404).send(noEncontrado())
      }

      const { rows } = await pool.query(
        `select c.id, c.metrica::text as metrica, c.operador::text as operador,
                c.umbral, c.ventana_dias, c.mensaje, c.activo,
                p.nombre as autor,
                (select count(*) from alerta_rpm a
                  where a.config_id = c.id and a.estado <> 'resuelta')::int as abiertas
           from alerta_config c
           join profesional p on p.id = c.profesional_id
          where c.paciente_id = $1 and c.clinica_id = $2 and c.activo = true
          order by c.metrica, c.operador`,
        [id, tenantId],
      )

      return reply.send(
        rows.map((r) => ({
          id: r['id'],
          metrica: r['metrica'],
          operador: r['operador'],
          umbral: num(r['umbral']),
          ventanaDias: Number(r['ventana_dias']),
          mensaje: r['mensaje'],
          autor: r['autor'],
          abiertas: Number(r['abiertas']),
        })),
      )
    },
  )

  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/pacientes/:id/alertas/config',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacientePropio(id, tenantId, alcance))) {
        return reply.code(404).send(noEncontrado())
      }

      const b = request.body ?? {}

      const metrica = b['metrica']
      if (typeof metrica !== 'string' || !(METRICAS as readonly string[]).includes(metrica)) {
        return reply.code(400).send({ error: 'validacion', message: 'Esa métrica no existe' })
      }
      const operador = b['operador']
      if (typeof operador !== 'string' || !(OPERADORES as readonly string[]).includes(operador)) {
        return reply.code(400).send({ error: 'validacion', message: 'Ese operador no existe' })
      }

      const { min, max } = RANGO[metrica as Metrica]
      const umbral = Number(b['umbral'])
      if (!Number.isFinite(umbral) || umbral < min || umbral > max) {
        return reply.code(400).send({
          error: 'validacion',
          message: `El umbral debe estar entre ${min} y ${max}`,
        })
      }

      // Las métricas de silencio no llevan ventana: la falta de datos ES
      // lo que miden. Se guarda el valor por defecto y la pantalla no lo
      // pregunta.
      const esDeSilencio = metrica === 'dias_sin_diario' || metrica === 'dias_sin_registro'
      let ventana = 14
      if (!esDeSilencio && b['ventanaDias'] !== undefined) {
        const v = Number(b['ventanaDias'])
        if (!Number.isInteger(v) || v < 1 || v > 365) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'La ventana debe estar entre 1 y 365 días' })
        }
        ventana = v
      }

      const mensaje = typeof b['mensaje'] === 'string' ? b['mensaje'].trim() : ''
      if (mensaje.length > 300) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'El mensaje no puede pasar de 300 caracteres' })
      }

      // PUT: hay una regla por paciente, métrica y operador. Volver a
      // enviarla la corrige. `profesional_id` se actualiza para que la
      // regla lleve la firma de quien la dejó como está.
      const { rows } = await pool.query<{ id: string }>(
        `insert into alerta_config
           (clinica_id, profesional_id, paciente_id, metrica, operador,
            umbral, ventana_dias, mensaje)
         values ($1, $2, $3, $4::alerta_metrica, $5::alerta_operador, $6, $7, $8)
         on conflict (paciente_id, metrica, operador) do update
           set umbral = excluded.umbral,
               ventana_dias = excluded.ventana_dias,
               mensaje = excluded.mensaje,
               profesional_id = excluded.profesional_id,
               activo = true,
               updated_at = now()
         returning id`,
        [
          tenantId,
          alcance.profesionalId,
          id,
          metrica as Metrica,
          operador as Operador,
          umbral,
          ventana,
          mensaje === '' ? null : mensaje,
        ],
      )

      // Se evalúa en el momento, solo este paciente. Si no, el
      // profesional pone un umbral y no pasa nada hasta mañana a las
      // ocho: parecería que no funciona.
      const r = await evaluarAlertas(id)

      return reply.send({ id: rows[0]!.id, evaluacion: r })
    },
  )

  app.delete<{ Params: { id: string; configId: string } }>(
    '/api/pacientes/:id/alertas/config/:configId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, configId } = request.params
      if (!esUuid(configId) || !(await pacientePropio(id, tenantId, alcance))) {
        return reply.code(404).send(noEncontrado())
      }

      // Archivar la regla, no borrarla: las alertas que generó apuntan a
      // ella. Y se cierran las que dejó abiertas — mantener viva una
      // alerta de una regla retirada es pedir atención sobre algo que ya
      // nadie vigila.
      const cliente = await pool.connect()
      try {
        await cliente.query('begin')
        const { rowCount } = await cliente.query(
          `update alerta_config set activo = false, updated_at = now()
            where id = $1 and paciente_id = $2 and clinica_id = $3 and activo = true`,
          [configId, id, tenantId],
        )
        if (rowCount === 0) {
          await cliente.query('rollback')
          return reply.code(404).send(noEncontrado())
        }
        await cliente.query(
          `update alerta_rpm
              set estado = 'resuelta', resuelta_en = now(), resuelta_auto = true, updated_at = now()
            where config_id = $1 and estado <> 'resuelta'`,
          [configId],
        )
        await cliente.query('commit')
      } catch (e) {
        await cliente.query('rollback')
        throw e
      } finally {
        cliente.release()
      }

      return reply.send({ ok: true })
    },
  )

  /* ================================================================ */
  /* Alertas disparadas                                                */
  /* ================================================================ */

  app.get<{ Querystring: { estado?: string; pacienteId?: string } }>(
    '/api/alertas',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      // Por defecto lo que sigue abierto: activas y reconocidas. Lo
      // resuelto se pide a propósito.
      const estado = request.query.estado
      const filtro =
        estado === 'activa' || estado === 'reconocida' || estado === 'resuelta' ? estado : null

      const pid = request.query.pacienteId
      const porPaciente = typeof pid === 'string' && esUuid(pid) ? pid : null

      const { rows } = await pool.query(
        `select a.id, a.metrica::text as metrica, a.valor_observado, a.umbral,
                a.mensaje, a.estado::text as estado, a.resuelta_auto,
                to_char(a.created_at    at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
                to_char(a.observado_en  at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as observado_en,
                to_char(a.reconocida_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as reconocida_en,
                to_char(a.resuelta_en   at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as resuelta_en,
                p.id as paciente_id, p.nombre as paciente
           from alerta_rpm a
           join paciente p on p.id = a.paciente_id
          where a.clinica_id = $1
            and ($2::uuid is null or p.nutricionista_id = $2)
            and ($3::text is null or a.estado::text = $3)
            and ($3::text is not null or a.estado <> 'resuelta')
            and ($4::uuid is null or a.paciente_id = $4)
          -- Lo más grave primero no se puede saber sin clínica; lo más
          -- reciente sí, y es lo que se espera de una bandeja.
          order by a.created_at desc, a.id desc
          limit 200`,
        [tenantId, alcance.restringirA, filtro, porPaciente],
      )

      return reply.send(
        rows.map((r) => ({
          id: r['id'],
          paciente: { id: r['paciente_id'], nombre: r['paciente'] },
          metrica: r['metrica'],
          valorObservado: num(r['valor_observado']),
          umbral: num(r['umbral']),
          mensaje: r['mensaje'],
          estado: r['estado'],
          resueltaAuto: r['resuelta_auto'] === true,
          observadoEn: r['observado_en'],
          creadaEn: r['created_at'],
          reconocidaEn: r['reconocida_en'],
          resueltaEn: r['resuelta_en'],
        })),
      )
    },
  )

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/alertas/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      const estado = request.body?.['estado']
      if (estado !== 'reconocida' && estado !== 'resuelta') {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'El estado debe ser reconocida o resuelta' })
      }

      // Reconocer = «la he visto»; resolver = «está atendida». Se cierra
      // a mano marcando `resuelta_auto = false`: una alerta que alguien
      // atendió y una que se arregló sola no dicen lo mismo.
      const { rows } = await pool.query(
        `update alerta_rpm a
            set estado = $3::alerta_estado,
                reconocida_en = case when $3 = 'reconocida' then now() else a.reconocida_en end,
                resuelta_en   = case when $3 = 'resuelta'   then now() else null end,
                resuelta_auto = case when $3 = 'resuelta'   then false else a.resuelta_auto end,
                updated_at = now()
           from paciente p
          where a.id = $1 and p.id = a.paciente_id
            and a.clinica_id = $2
            and ($4::uuid is null or p.nutricionista_id = $4)
            and a.estado <> 'resuelta'
          returning a.id, a.estado::text as estado`,
        [esUuid(id) ? id : null, tenantId, estado, alcance.restringirA],
      )

      const r = rows[0]
      if (!r) return reply.code(404).send(noEncontrado())
      return reply.send({ id: r['id'], estado: r['estado'] })
    },
  )
}
