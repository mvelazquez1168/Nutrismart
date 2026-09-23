/**
 * Tendencia de la clínica y exportación — GAM-03.
 *
 * Complementa al dashboard de la Rebanada 8, no lo sustituye. Aquel
 * responde «qué pasa hoy» —citas del día, agenda, KPIs del periodo—;
 * este responde «cómo va la clínica»: cómo evolucionan las citas y los
 * pacientes mes a mes, y cuánto está usando la gente la aplicación.
 *
 * Por eso ambos viven en la misma pantalla en vez de en dos entradas de
 * menú llamadas «Dashboard».
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { ROL_ADMIN_CLINICA } from '../pacientes/acceso.js'

/** Zona de la clínica. Ver la nota del dashboard de la R8. */
const ZONA = 'America/Costa_Rica'

/**
 * Mismo criterio que en `routes/equipo.ts`: hace falta el rol en el token
 * Y en la base. Aquí importa además porque estas rutas sacan datos
 * personales de todos los pacientes de la clínica de una sentada.
 */
async function comoAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ profesionalId: string; nombre: string } | null> {
  const { tenantId, sub, roles } = request.auth
  const { rows } = await pool.query<{ id: string; nombre: string; rol: string }>(
    `select id, nombre, rol::text as rol from profesional
      where keycloak_user_id = $1 and clinica_id = $2 and estado = 'activo'`,
    [sub, tenantId],
  )
  const yo = rows[0]
  if (!yo || !roles.includes(ROL_ADMIN_CLINICA) || yo.rol !== ROL_ADMIN_CLINICA) {
    reply.code(403).send({
      error: 'solo_administradores',
      message: 'Esta sección es solo para administradores de la clínica',
    })
    return null
  }
  return { profesionalId: yo.id, nombre: yo.nombre }
}

const n = (v: unknown) => Number(v ?? 0)

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Escapa un valor para CSV.
 *
 * Además de las comillas y los saltos de línea, neutraliza las fórmulas.
 * Excel y LibreOffice ejecutan lo que empieza por `=`, `+`, `-` o `@`, y
 * aquí se exportan nombres y notas que escriben personas: un paciente
 * llamado `=HYPERLINK("http://…","Actualizar")` se convierte en un
 * enlace ejecutable en el ordenador de quien abra el archivo.
 *
 * Se antepone un apóstrofo, que es lo que las hojas de cálculo entienden
 * como «esto es texto» y no se ve al abrirlo.
 */
function celda(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function aCsv(filas: Record<string, unknown>[], columnas: readonly string[]): string {
  return [
    columnas.join(','),
    ...filas.map((f) => columnas.map((c) => celda(f[c])).join(',')),
  ].join('\r\n')
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function registerEstadisticasRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Tendencia                                                         */
  /* ================================================================ */

  app.get('/api/admin/estadisticas', { preHandler: requireAuth }, async (request, reply) => {
    if (!(await comoAdmin(request, reply))) return
    const cid = request.auth.tenantId

    const [resumen, adherencia, meses, profesionales] = await Promise.all([
      pool.query(
        `select
           count(*) filter (where estado = 'activo')::int as pacientes_activos,
           count(*) filter (where estado <> 'activo')::int as pacientes_inactivos,
           count(*) filter (
             where estado = 'activo'
               and created_at >= date_trunc('month', now() at time zone $2)
           )::int as altas_este_mes
         from paciente where clinica_id = $1`,
        [cid, ZONA],
      ),

      // Adherencia: de los pacientes que PUEDEN apuntar —los que tienen
      // cuenta activada—, cuántos días de los últimos siete apuntaron
      // algo.
      //
      // El encargo dividía entre todos los pacientes activos. Eso mide
      // otra cosa: un paciente sin cuenta no puede apuntar, y contarlo
      // como incumplidor hunde el porcentaje por un motivo que no es la
      // adherencia. Se devuelven las dos cifras para que se vea.
      pool.query(
        `with con_app as (
           select id from paciente
            where clinica_id = $1 and estado = 'activo' and keycloak_user_id is not null
         ),
         dias as (
           select count(distinct (r.paciente_id, r.fecha))::int as total
             from registro_comida r
             join con_app c on c.id = r.paciente_id
            where r.clinica_id = $1 and r.activo
              and r.fecha >= (now() at time zone $2)::date - 6
         )
         select (select count(*)::int from con_app) as con_app,
                (select total from dias) as dias_con_registro,
                (select count(*)::int from paciente
                  where clinica_id = $1 and estado = 'activo') as activos`,
        [cid, ZONA],
      ),

      // Doce meses, incluidos los vacíos: `generate_series` a la
      // izquierda. Sin él, un mes sin citas no sale como cero, sale
      // como que no existe, y la gráfica junta noviembre con enero.
      pool.query(
        `with meses as (
           select generate_series(
                    date_trunc('month', (now() at time zone $2)::date) - interval '11 months',
                    date_trunc('month', (now() at time zone $2)::date),
                    interval '1 month'
                  )::date as mes
         )
         select to_char(m.mes,'YYYY-MM') as mes,
                coalesce(c.total, 0)::int       as citas,
                coalesce(c.completadas, 0)::int as completadas,
                coalesce(c.no_asistio, 0)::int  as no_asistio,
                coalesce(p.altas, 0)::int       as altas
           from meses m
           left join lateral (
             select count(*) as total,
                    count(*) filter (where estado = 'completada') as completadas,
                    count(*) filter (where estado = 'no_asistio') as no_asistio
               from cita
              where clinica_id = $1
                and date_trunc('month', inicio at time zone $2) = m.mes
           ) c on true
           left join lateral (
             select count(*) as altas from paciente
              where clinica_id = $1
                and date_trunc('month', created_at at time zone $2) = m.mes
           ) p on true
          order by m.mes`,
        [cid, ZONA],
      ),

      pool.query(
        `select p.nombre,
                p.rol::text as rol,
                (select count(*) from paciente pa
                  where pa.nutricionista_id = p.id and pa.estado = 'activo')::int as pacientes,
                (select count(*) from cita c
                  where c.profesional_id = p.id and c.clinica_id = $1
                    and c.inicio >= now() - interval '90 days')::int as citas_90d,
                (select count(*) from cita c
                  where c.profesional_id = p.id and c.clinica_id = $1
                    and c.inicio >= now() - interval '90 days'
                    and c.estado = 'completada')::int as completadas_90d
           from profesional p
          where p.clinica_id = $1 and p.estado <> 'inactivo'
          order by case p.rol when 'admin_clinica' then 0 else 1 end, p.nombre`,
        [cid],
      ),
    ])

    const a = adherencia.rows[0]!
    const conApp = n(a['con_app'])
    const esperados = conApp * 7

    return reply.send({
      pacientes: {
        activos: n(resumen.rows[0]!['pacientes_activos']),
        inactivos: n(resumen.rows[0]!['pacientes_inactivos']),
        altasEsteMes: n(resumen.rows[0]!['altas_este_mes']),
      },
      adherencia: {
        // `null` y no `0` cuando nadie tiene la aplicación: un 0 % diría
        // que nadie apunta, y lo que pasa es que nadie puede.
        pct: esperados === 0 ? null : Math.round((n(a['dias_con_registro']) / esperados) * 1000) / 10,
        conApp,
        activos: n(a['activos']),
        diasConRegistro: n(a['dias_con_registro']),
      },
      meses: meses.rows.map((m) => ({
        mes: m['mes'],
        citas: n(m['citas']),
        completadas: n(m['completadas']),
        noAsistio: n(m['no_asistio']),
        altas: n(m['altas']),
      })),
      profesionales: profesionales.rows.map((p) => ({
        nombre: p['nombre'],
        rol: p['rol'],
        pacientes: n(p['pacientes']),
        citas90d: n(p['citas_90d']),
        completadas90d: n(p['completadas_90d']),
      })),
    })
  })

  /* ================================================================ */
  /* Exportación                                                       */
  /* ================================================================ */

  function enviarCsv(reply: FastifyReply, nombre: string, csv: string) {
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${nombre}"`)
      // BOM: sin él, Excel en Windows abre el archivo como Latin-1 y
      // «Fernández» sale como «FernÃ¡ndez».
      .send('﻿' + csv)
  }

  const COLS_PACIENTES = [
    'nombre',
    'correo',
    'sexo',
    'fecha_nacimiento',
    'profesional',
    'estado',
    'ultima_cita',
    'citas_completadas',
    'peso_inicial_kg',
    'peso_actual_kg',
  ] as const

  app.get(
    '/api/admin/exportar/pacientes',
    { preHandler: requireAuth },
    async (request, reply) => {
      const admin = await comoAdmin(request, reply)
      if (!admin) return

      const { rows } = await pool.query(
        `select p.nombre,
                p.correo,
                p.sexo_biologico::text as sexo,
                to_char(p.fecha_nacimiento,'YYYY-MM-DD') as fecha_nacimiento,
                prof.nombre as profesional,
                p.estado::text as estado,
                (select to_char(max(c.inicio at time zone $2),'YYYY-MM-DD')
                   from cita c
                  where c.paciente_id = p.id and c.estado = 'completada') as ultima_cita,
                (select count(*) from cita c2
                  where c2.paciente_id = p.id and c2.estado = 'completada')::int as citas_completadas,
                -- El peso de CONSULTA, no el de casa: es el que el
                -- profesional midió. Mezclarlos es lo que la R22 separó.
                (select m.peso_kg from medicion_antropometrica m
                  where m.paciente_id = p.id and m.peso_kg is not null
                  order by m.fecha_medicion asc, m.id asc limit 1) as peso_inicial_kg,
                (select m.peso_kg from medicion_antropometrica m
                  where m.paciente_id = p.id and m.peso_kg is not null
                  order by m.fecha_medicion desc, m.id desc limit 1) as peso_actual_kg
           from paciente p
           left join profesional prof on prof.id = p.nutricionista_id
          where p.clinica_id = $1
          order by p.nombre`,
        [request.auth.tenantId, ZONA],
      )

      // Sacar de una vez los datos personales de toda la clínica deja
      // rastro. No hay tabla de auditoría todavía —merece su propia
      // rebanada— así que de momento va al registro del servidor.
      //
      // `warn` y no `info` a propósito: en producción el nivel del
      // logger es 'warn', así que un `info` no se escribiría y el rastro
      // solo existiría en desarrollo, que es justo donde no hace falta.
      request.log.warn(
        { admin: admin.nombre, clinica: request.auth.tenantId, filas: rows.length },
        'exportacion de pacientes',
      )

      return enviarCsv(reply, 'pacientes.csv', aCsv(rows, COLS_PACIENTES))
    },
  )

  const COLS_CITAS = [
    'fecha',
    'hora',
    'paciente',
    'profesional',
    'tipo',
    'duracion_minutos',
    'estado',
    'motivo',
  ] as const

  app.get<{ Querystring: { desde?: string; hasta?: string } }>(
    '/api/admin/exportar/citas',
    { preHandler: requireAuth },
    async (request, reply) => {
      const admin = await comoAdmin(request, reply)
      if (!admin) return

      // Las fechas se validan antes de tocar la consulta: `undefined` o
      // un texto cualquiera darían un rango imposible en vez de un error.
      const q = request.query
      const desde = typeof q.desde === 'string' && RE_FECHA.test(q.desde) ? q.desde : null
      const hasta = typeof q.hasta === 'string' && RE_FECHA.test(q.hasta) ? q.hasta : null
      if ((q.desde && !desde) || (q.hasta && !hasta)) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Las fechas deben ir como AAAA-MM-DD' })
      }
      if (desde && hasta && desde > hasta) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'La fecha de inicio va antes que la de fin' })
      }

      const { rows } = await pool.query(
        `select to_char(c.inicio at time zone $4,'YYYY-MM-DD') as fecha,
                to_char(c.inicio at time zone $4,'HH24:MI')    as hora,
                pac.nombre  as paciente,
                prof.nombre as profesional,
                c.tipo::text   as tipo,
                c.duracion_minutos,
                c.estado::text as estado,
                c.motivo
           from cita c
           join paciente pac on pac.id = c.paciente_id
           left join profesional prof on prof.id = c.profesional_id
          where c.clinica_id = $1
            and (c.inicio at time zone $4)::date >= coalesce($2::date, (now() at time zone $4)::date - 30)
            and (c.inicio at time zone $4)::date <= coalesce($3::date, (now() at time zone $4)::date)
          order by c.inicio desc, c.id desc`,
        [request.auth.tenantId, desde, hasta, ZONA],
      )

      // Mismo motivo que arriba para el nivel.
      request.log.warn(
        { admin: admin.nombre, clinica: request.auth.tenantId, filas: rows.length, desde, hasta },
        'exportacion de citas',
      )

      return enviarCsv(reply, 'citas.csv', aCsv(rows, COLS_CITAS))
    },
  )
}
