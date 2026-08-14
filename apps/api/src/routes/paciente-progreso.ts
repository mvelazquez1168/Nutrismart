/**
 * Progreso y tareas del paciente — PAC-05, PAC-06.
 *
 * Sobre el peso y de dónde sale: hay DOS series y no se mezclan.
 *
 *   - `medicion_antropometrica`: lo que mide el profesional en consulta,
 *     con báscula calibrada y siempre igual. Es la que cuenta contra la
 *     meta.
 *   - `registro_metrica`: lo que el paciente se pesa en casa (Rebanada
 *     22). Va aparte, más clara, como referencia del día a día.
 *
 * El encargo calculaba el avance solo con la de casa. Decirle a alguien
 * «te faltan 2 kg» a partir de una báscula sin calibrar, a una hora
 * cualquiera y vestido, es dar por exacto lo que no lo es.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth, requireAuthPaciente } from '../auth.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { esUuid } from '../pacientes/validacion.js'

const PRIORIDADES = ['alta', 'normal', 'baja'] as const
type Prioridad = (typeof PRIORIDADES)[number]

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

const SELECT_TAREA = `
  t.id, t.titulo, t.descripcion,
  to_char(t.fecha_limite,'YYYY-MM-DD') as fecha_limite,
  t.prioridad::text as prioridad, t.estado::text as estado,
  to_char(t.completada_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as completada_en,
  to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at
`

function mapearTarea(t: Record<string, unknown>) {
  return {
    id: t['id'],
    titulo: t['titulo'],
    descripcion: t['descripcion'],
    fechaLimite: t['fecha_limite'],
    prioridad: t['prioridad'],
    estado: t['estado'],
    completadaEn: t['completada_en'],
    createdAt: t['created_at'],
    profesional: t['profesional'] ?? null,
  }
}

export async function registerPacienteProgresoRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* PAC-05 · Progreso                                                 */
  /* ================================================================ */

  app.get<{ Querystring: { meses?: string } }>(
    '/api/paciente/progreso',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const m = Number(request.query.meses)
      const meses = Number.isInteger(m) && m >= 1 && m <= 24 ? m : 6

      const [meta, clinica, casa, kcal, otras] = await Promise.all([
        // La meta de la última consulta cerrada.
        pool.query(
          `select cv.peso_objetivo,
                  to_char(cv.fecha_objetivo_peso,'YYYY-MM-DD') as fecha_objetivo,
                  cv.kcal_prescritas
             from conclusion_valoracion cv
             join consulta c on c.id = cv.consulta_id
            where c.paciente_id = $1 and c.clinica_id = $2 and c.estado = 'finalizada'
            order by c.numero_consulta desc limit 1`,
          [pac.id, pac.clinica_id],
        ),

        // Serie de consulta: la que cuenta contra la meta.
        pool.query(
          // El desempate por `created_at` no es cosmético: dos
          // mediciones el mismo día —una corrección, o dos consultas—
          // empatan, el orden queda a merced del plan de ejecución y el
          // "peso inicial" puede acabar siendo el más reciente. Con eso,
          // una pérdida de 2,4 kg se presenta como una ganancia.
          `select to_char(fecha_medicion,'YYYY-MM-DD') as fecha, peso_kg
             from medicion_antropometrica
            where paciente_id = $1 and clinica_id = $2 and peso_kg is not null
              and fecha_medicion >= (current_date - ($3::int || ' months')::interval)
            order by fecha_medicion, created_at`,
          [pac.id, pac.clinica_id, meses],
        ),

        // Serie de casa: promedio por semana, que es como se lee un peso
        // doméstico. Un valor suelto oscila con la hora y la ropa.
        pool.query(
          `select to_char(date_trunc('week', medido_en at time zone 'America/Costa_Rica'),'YYYY-MM-DD') as semana,
                  round(avg(valor)::numeric, 1) as promedio,
                  count(*)::int as lecturas
             from registro_metrica
            where paciente_id = $1 and clinica_id = $2 and tipo = 'peso' and activo = true
              and medido_en >= now() - ($3::int || ' months')::interval
            group by 1 order by 1`,
          [pac.id, pac.clinica_id, meses],
        ),

        // Calorías: media por DÍA CON REGISTRO, no por día natural.
        // Dividir entre siete cuando solo se apuntaron dos días diría
        // que el paciente come 300 kcal.
        pool.query(
          `select to_char(date_trunc('week', fecha),'YYYY-MM-DD') as semana,
                  round(sum(kcal) / nullif(count(distinct fecha),0), 0) as kcal_dia,
                  count(distinct fecha)::int as dias
             from registro_comida
            where paciente_id = $1 and clinica_id = $2 and activo = true
              and kcal is not null
              and fecha >= (current_date - ($3::int || ' months')::interval)
            group by 1 order by 1`,
          [pac.id, pac.clinica_id, meses],
        ),

        pool.query(
          `select distinct on (tipo)
                  tipo::text as tipo, valor, sistolica, diastolica, unidad,
                  to_char(medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as medido_en
             from registro_metrica
            where paciente_id = $1 and clinica_id = $2 and activo = true and tipo <> 'peso'
            order by tipo, medido_en desc`,
          [pac.id, pac.clinica_id],
        ),
      ])

      const serieClinica = clinica.rows.map((r) => ({
        fecha: r['fecha'] as string,
        pesoKg: Number(r['peso_kg']),
      }))

      const objetivo = num(meta.rows[0]?.['peso_objetivo'])
      const inicial = serieClinica[0] ?? null
      const actual = serieClinica[serieClinica.length - 1] ?? null

      // El avance solo se calcula si hay meta Y al menos dos mediciones
      // de consulta. Con una sola no hay recorrido que medir, y un
      // "0 % completado" sugiere un estancamiento que nadie ha observado.
      let avance: {
        pesoInicial: number
        pesoActual: number
        objetivo: number
        recorrido: number
        restante: number
        pctCompletado: number
      } | null = null

      if (objetivo !== null && inicial && actual && serieClinica.length >= 2) {
        const total = objetivo - inicial.pesoKg
        const hecho = actual.pesoKg - inicial.pesoKg
        avance = {
          pesoInicial: inicial.pesoKg,
          pesoActual: actual.pesoKg,
          objetivo,
          recorrido: Math.round(hecho * 10) / 10,
          restante: Math.round((objetivo - actual.pesoKg) * 10) / 10,
          // Si la meta coincide con el peso de partida no hay recorrido
          // y el porcentaje no significa nada.
          pctCompletado:
            total === 0 ? 100 : Math.max(0, Math.min(100, Math.round((hecho / total) * 100))),
        }
      }

      return reply.send({
        meses,
        meta: {
          pesoObjetivo: objetivo,
          fechaObjetivo: meta.rows[0]?.['fecha_objetivo'] ?? null,
          kcalObjetivo: num(meta.rows[0]?.['kcal_prescritas']),
        },
        avance,
        // Las dos series van etiquetadas y separadas a propósito.
        pesoEnConsulta: serieClinica,
        pesoEnCasa: casa.rows.map((r) => ({
          semana: r['semana'],
          promedio: Number(r['promedio']),
          lecturas: Number(r['lecturas']),
        })),
        calorias: kcal.rows.map((r) => ({
          semana: r['semana'],
          kcalDia: num(r['kcal_dia']),
          diasConRegistro: Number(r['dias']),
        })),
        otrasMetricas: otras.rows.map((r) => ({
          tipo: r['tipo'],
          valor: num(r['valor']),
          sistolica: num(r['sistolica']),
          diastolica: num(r['diastolica']),
          unidad: r['unidad'],
          medidoEn: r['medido_en'],
        })),
      })
    },
  )

  /* ================================================================ */
  /* PAC-06 · Tareas, lado del paciente                                */
  /* ================================================================ */

  app.get<{ Querystring: { estado?: string } }>(
    '/api/paciente/tareas',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      // Las archivadas no se le enseñan al paciente: el profesional las
      // retiró, y volver a mostrarlas confunde.
      const soloPendientes = request.query.estado === 'pendiente'

      const { rows } = await pool.query(
        `select ${SELECT_TAREA}, prof.nombre as profesional
           from tarea_paciente t
           left join profesional prof on prof.id = t.profesional_id
          where t.paciente_id = $1 and t.clinica_id = $2
            and t.estado <> 'archivada'
            and ($3::bool is false or t.estado = 'pendiente')
          -- Lo pendiente primero, y dentro de eso lo que vence antes.
          -- Las que no tienen fecha van al final: no urgen.
          order by (t.estado = 'completada'),
                   t.fecha_limite asc nulls last,
                   t.created_at desc`,
        [pac.id, pac.clinica_id, soloPendientes],
      )

      return reply.send(rows.map(mapearTarea))
    },
  )

  app.patch<{ Params: { id: string }; Body: { completada?: unknown } }>(
    '/api/paciente/tareas/:id',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { id } = request.params
      if (!esUuid(id)) {
        return reply.code(404).send({ error: 'no_encontrada', message: 'No se encontró la tarea' })
      }

      // Un solo endpoint para marcar y desmarcar, en vez de
      // /completar y /descompletar: es el mismo interruptor y separarlo
      // duplica la comprobación de propiedad.
      const completada = request.body?.completada !== false

      const { rows } = await pool.query(
        `update tarea_paciente
            set estado = case when $4 then 'completada'::estado_tarea else 'pendiente'::estado_tarea end,
                completada_en = case when $4 then now() else null end
          where id = $1 and paciente_id = $2 and clinica_id = $3
            and estado <> 'archivada'
          returning ${SELECT_TAREA.replace(/t\./g, '')}`,
        [id, pac.id, pac.clinica_id, completada],
      )
      if (!rows[0]) {
        return reply.code(404).send({ error: 'no_encontrada', message: 'No se encontró la tarea' })
      }

      return reply.send(mapearTarea(rows[0]))
    },
  )

  /* ================================================================ */
  /* PAC-06 · Tareas, lado del profesional                             */
  /* ================================================================ */

  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/tareas',
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

      const { id } = request.params
      const { rows: visible } = await pool.query(
        `select 1 from paciente
          where id = $1 and clinica_id = $2 and ($3::uuid is null or nutricionista_id = $3)`,
        [id, tenantId, alcance.restringirA],
      )
      if (!visible[0]) {
        return reply
          .code(404)
          .send({ error: 'paciente_no_encontrado', message: 'No se encontró el paciente' })
      }

      // Aquí SÍ se ven las archivadas: el profesional necesita saber qué
      // mandó y retiró, aunque el paciente ya no lo vea.
      const { rows } = await pool.query(
        `select ${SELECT_TAREA}, prof.nombre as profesional
           from tarea_paciente t
           left join profesional prof on prof.id = t.profesional_id
          where t.paciente_id = $1 and t.clinica_id = $2
          order by (t.estado <> 'pendiente'), t.fecha_limite asc nulls last, t.created_at desc`,
        [id, tenantId],
      )

      return reply.send(rows.map(mapearTarea))
    },
  )

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/pacientes/:id/tareas',
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

      const { id } = request.params
      const { rows: visible } = await pool.query(
        `select 1 from paciente
          where id = $1 and clinica_id = $2 and estado = 'activo'
            and ($3::uuid is null or nutricionista_id = $3)`,
        [id, tenantId, alcance.restringirA],
      )
      if (!visible[0]) {
        return reply
          .code(404)
          .send({ error: 'paciente_no_encontrado', message: 'No se encontró el paciente' })
      }

      const b = request.body ?? {}
      const titulo = typeof b['titulo'] === 'string' ? b['titulo'].trim() : ''
      if (titulo === '' || titulo.length > 200) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'La tarea necesita un título de hasta 200 caracteres',
        })
      }

      const descripcion =
        typeof b['descripcion'] === 'string' && b['descripcion'].trim() !== ''
          ? b['descripcion'].trim().slice(0, 2000)
          : null

      const p = b['prioridad']
      const prioridad: Prioridad =
        typeof p === 'string' && PRIORIDADES.includes(p as Prioridad) ? (p as Prioridad) : 'normal'

      const f = b['fechaLimite']
      const fechaLimite = typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null

      const consultaId =
        typeof b['consultaId'] === 'string' && esUuid(b['consultaId']) ? b['consultaId'] : null

      const { rows } = await pool.query(
        `insert into tarea_paciente
           (clinica_id, paciente_id, profesional_id, consulta_id,
            titulo, descripcion, fecha_limite, prioridad)
         values ($1,$2,$3,$4,$5,$6,$7::date,$8)
         returning ${SELECT_TAREA.replace(/t\./g, '')}`,
        [
          tenantId,
          id,
          alcance.profesionalId,
          consultaId,
          titulo,
          descripcion,
          fechaLimite,
          prioridad,
        ],
      )

      return reply.code(201).send(mapearTarea(rows[0]!))
    },
  )

  app.delete<{ Params: { id: string; tareaId: string } }>(
    '/api/pacientes/:id/tareas/:tareaId',
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

      const { id, tareaId } = request.params
      if (!esUuid(tareaId)) {
        return reply.code(404).send({ error: 'no_encontrada', message: 'No se encontró la tarea' })
      }

      // Archivar, no borrar: lo que se le mandó al paciente y luego se
      // retiró también es parte de lo que ocurrió.
      const { rows } = await pool.query(
        `update tarea_paciente set estado = 'archivada', completada_en = null
          where id = $1 and paciente_id = $2 and clinica_id = $3 and estado <> 'archivada'
            and ($4::uuid is null or profesional_id = $4)
          returning id`,
        [tareaId, id, tenantId, alcance.restringirA],
      )
      if (!rows[0]) {
        return reply.code(404).send({ error: 'no_encontrada', message: 'No se encontró la tarea' })
      }
      return reply.code(204).send()
    },
  )
}
