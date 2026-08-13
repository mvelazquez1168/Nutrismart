/**
 * Dashboard administrativo de la clínica — CLI-08.
 *
 * Solo lectura y solo para `admin_clinica`. Un nutricionista ve sus
 * pacientes; quien mira la clínica entera es quien la administra.
 *
 * Aquí el 403 sí es la respuesta correcta, al revés que en las rutas
 * con `:pacienteId`. Allí un 403 confirmaría que cierto paciente
 * existe; aquí el recurso es la propia clínica del solicitante, cuya
 * existencia ya conoce por su token. Nada se filtra al decirle que no
 * tiene el rol.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { resolverAlcance } from '../pacientes/acceso.js'

/**
 * Huso de la clínica.
 *
 * Hoy es una constante porque todas las clínicas están en Costa Rica.
 * Debería ser una columna de `clinica` en cuanto haya una fuera, y por
 * eso viaja como parámetro a las consultas en vez de estar incrustado
 * en el SQL: el día que cambie, se cambia aquí y nada más.
 */
const ZONA_CLINICA = 'America/Costa_Rica'

const PERIODOS = ['hoy', 'semana', 'mes'] as const
type Periodo = (typeof PERIODOS)[number]

/**
 * La ventana la calcula POSTGRES, no Node.
 *
 * "Hoy" y "este mes" dependen del huso de la clínica, no del reloj del
 * servidor. Con el proceso en UTC, un `new Date()` truncado a
 * medianoche empieza el día a las 18:00 del día anterior en Costa
 * Rica: el dashboard mostraría como "hoy" seis horas de ayer. Es el
 * mismo error que ya documentó la agenda en la Rebanada 4.
 *
 * El período llega hasta su FINAL, no hasta `now()`. Cortar en el
 * instante actual deja fuera las citas ya agendadas para más tarde, y
 * entonces el KPI "Pendientes" no puede contar nada: una cita
 * pendiente está, por definición, en el futuro. Un administrador que
 * mira "Este mes" con cinco citas en la agenda vería un cero.
 *
 * "Semana" es el único rodante (los últimos 7 días), tal como se
 * especificó; también se extiende al final del día para no cortar la
 * jornada en curso por la mitad.
 */
const SQL_VENTANA = `
  select
    case $1::text
      when 'hoy'    then date_trunc('day',   now() at time zone $2) at time zone $2
      when 'semana' then now() - interval '7 days'
      else               date_trunc('month', now() at time zone $2) at time zone $2
    end as desde,
    case $1::text
      when 'mes' then (date_trunc('month', now() at time zone $2) + interval '1 month') at time zone $2
      else            (date_trunc('day',   now() at time zone $2) + interval '1 day')   at time zone $2
    end as hasta
`

/**
 * Sin filtro de "activo": `cita` no tiene esa columna. Su ciclo de vida
 * es el enum `estado`, y una cita cancelada NO se excluye — se cuenta
 * aparte, que es justo lo que el administrador quiere ver.
 */
const SQL_KPIS_CITAS = `
  select
    count(*)                                                      as citas_total,
    count(*) filter (where estado = 'completada')                 as citas_completadas,
    count(*) filter (where estado = 'cancelada')                  as citas_canceladas,
    count(*) filter (where estado not in ('completada','cancelada')) as citas_pendientes
  from cita
  where clinica_id = $1
    and inicio >= $2
    and inicio <  $3
`

// `paciente.estado` es un enum de tres valores; 'activo' es el que
// cuenta. 'baja' está archivado y 'inactivo' es un alta sin seguimiento.
const SQL_PACIENTES_ACTIVOS = `
  select count(*) as total from paciente
  where clinica_id = $1 and estado = 'activo'
`

const SQL_PACIENTES_NUEVOS = `
  select count(*) as total from paciente
  where clinica_id = $1 and estado = 'activo' and created_at >= $2
`

// La tabla es `clinical_snapshot`, no `snapshot`. Se cuentan todos los
// creados en el período, incluidos los corregidos: una corrección no
// borra que ese control ocurrió.
const SQL_SNAPSHOTS = `
  select count(*) as total from clinical_snapshot
  where clinica_id = $1 and created_at >= $2
`

// Los anulados se excluyen: un estudio cargado por error y anulado no
// es trabajo hecho, y contarlo inflaría la actividad de la clínica.
const SQL_EXAMENES = `
  select count(*) as total from lab_estudio
  where clinica_id = $1 and estado = 'vigente' and created_at >= $2
`

/**
 * La agenda es SIEMPRE la de hoy, ignorando ?periodo: es la pregunta
 * "¿qué toca ahora?", no una estadística del rango elegido.
 *
 * El día se compara en el huso de la clínica. Comparar contra el día
 * UTC metería las citas de la tarde de ayer y dejaría fuera las de la
 * tarde de hoy.
 */
const SQL_AGENDA_HOY = `
  select
    c.id                as cita_id,
    c.inicio,
    c.fin,
    c.estado::text      as estado,
    pac.nombre          as paciente_nombre,
    pro.nombre          as profesional_nombre
  from cita c
  join paciente    pac on pac.id = c.paciente_id
  join profesional pro on pro.id = c.profesional_id
  where c.clinica_id = $1
    and (c.inicio at time zone $2)::date = (now() at time zone $2)::date
  order by c.inicio asc
`

/**
 * Un profesional sin citas en el período tiene que aparecer con cero,
 * no desaparecer: su ausencia de la tabla es justamente el dato que el
 * administrador busca. De ahí el LEFT JOIN con las condiciones de
 * período DENTRO del ON — moverlas al WHERE lo convertiría en un INNER
 * JOIN silencioso y esas filas se perderían.
 */
const SQL_POR_PROFESIONAL = `
  select
    p.id                                                as profesional_id,
    p.nombre,
    count(c.id)                                         as citas_total,
    count(c.id) filter (where c.estado = 'completada')  as citas_completadas,
    (select count(*) from paciente pa
      where pa.nutricionista_id = p.id
        and pa.clinica_id       = $1
        and pa.estado           = 'activo')             as pacientes_activos
  from profesional p
  left join cita c on c.profesional_id = p.id
                  and c.clinica_id     = $1
                  and c.inicio        >= $2
                  and c.inicio         < $3
  where p.clinica_id = $1
    and p.estado <> 'inactivo'
  group by p.id, p.nombre
  order by citas_total desc, p.nombre asc
`

/** pg devuelve los count() como string para no perder precisión. */
function num(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { periodo?: string } }>(
    '/api/admin/dashboard',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth

      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) {
        return reply.code(403).send({
          error: 'profesional_no_encontrado',
          message: 'Tu usuario no tiene un profesional asociado en esta clínica',
        })
      }
      if (!alcance.esAdmin) {
        return reply.code(403).send({
          error: 'solo_admin_clinica',
          message: 'Solo un administrador de la clínica puede ver el dashboard',
        })
      }

      // Un período desconocido cae al valor por defecto en vez de dar
      // 400: es un parámetro de presentación, y romper la pantalla
      // entera por una cadena mal escrita en la URL sería desmedido.
      const pedido = request.query.periodo
      const periodo: Periodo = PERIODOS.includes(pedido as Periodo) ? (pedido as Periodo) : 'mes'

      const ventana = await pool.query<{ desde: Date; hasta: Date }>(SQL_VENTANA, [
        periodo,
        ZONA_CLINICA,
      ])
      const desde = ventana.rows[0]?.desde
      const hasta = ventana.rows[0]?.hasta
      if (!desde || !hasta) throw new Error('No se pudo calcular la ventana del dashboard')

      // En paralelo: son independientes y encadenarlas multiplicaría la
      // espera por siete antes de poder pintar nada.
      const [citas, activos, nuevos, snapshots, examenes, agenda, profesionales] =
        await Promise.all([
          pool.query(SQL_KPIS_CITAS, [tenantId, desde, hasta]),
          pool.query(SQL_PACIENTES_ACTIVOS, [tenantId]),
          pool.query(SQL_PACIENTES_NUEVOS, [tenantId, desde]),
          pool.query(SQL_SNAPSHOTS, [tenantId, desde]),
          pool.query(SQL_EXAMENES, [tenantId, desde]),
          pool.query(SQL_AGENDA_HOY, [tenantId, ZONA_CLINICA]),
          pool.query(SQL_POR_PROFESIONAL, [tenantId, desde, hasta]),
        ])

      const k = citas.rows[0] ?? {}

      return reply.send({
        periodo,
        desde,
        hasta,
        generadoEn: new Date(),
        kpis: {
          citasTotal: num(k.citas_total),
          citasCompletadas: num(k.citas_completadas),
          citasCanceladas: num(k.citas_canceladas),
          citasPendientes: num(k.citas_pendientes),
          pacientesActivos: num(activos.rows[0]?.total),
          pacientesNuevos: num(nuevos.rows[0]?.total),
          snapshotsCreados: num(snapshots.rows[0]?.total),
          examenesSubidos: num(examenes.rows[0]?.total),
        },
        // Los instantes viajan en crudo: el servidor no conoce el huso
        // del navegador y formatear aquí es cómo la agenda acabó
        // mostrando las 21:00 para una cita de las 15:00.
        agendaHoy: agenda.rows.map((c) => ({
          citaId: c.cita_id,
          inicio: c.inicio,
          fin: c.fin,
          estado: c.estado,
          paciente: c.paciente_nombre,
          profesional: c.profesional_nombre,
        })),
        porProfesional: profesionales.rows.map((p) => ({
          profesionalId: p.profesional_id,
          nombre: p.nombre,
          citasTotal: num(p.citas_total),
          citasCompletadas: num(p.citas_completadas),
          pacientesActivos: num(p.pacientes_activos),
        })),
      })
    },
  )
}
