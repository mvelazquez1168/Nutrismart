/**
 * Lo que el paciente registra desde casa — diario de comidas y métricas.
 *
 * Dos cosas que conviene tener presentes al leer esto:
 *
 * El diario usa las MISMAS franjas que el plan alimentario (el enum
 * `tipo_comida` de la Rebanada 9). Es lo que permite poner al lado lo
 * planificado y lo comido.
 *
 * Las métricas de casa NO se mezclan con `medicion_antropometrica`, que
 * es lo que mide el profesional en consulta. Son datos distintos y se
 * cuentan aparte.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth, requireAuthPaciente } from '../auth.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { esUuid } from '../pacientes/validacion.js'

const TIPOS_COMIDA = [
  'desayuno',
  'media_manana',
  'almuerzo',
  'merienda',
  'cena',
  'extra',
] as const
type TipoComida = (typeof TIPOS_COMIDA)[number]

const TIPOS_METRICA = ['peso', 'presion_arterial', 'glucosa', 'otro'] as const
type TipoMetrica = (typeof TIPOS_METRICA)[number]

/** Unidad por defecto de cada métrica, para no fiarse de la del cliente. */
const UNIDAD: Record<TipoMetrica, string> = {
  peso: 'kg',
  presion_arterial: 'mmHg',
  glucosa: 'mg/dL',
  otro: '',
}

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

/** Número opcional y no negativo; devuelve `undefined` si no vale. */
function numeroOpcional(v: unknown, max: number): number | null | undefined {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return undefined
  return n
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function registerPacienteRegistrosRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Diario de comidas                                                 */
  /* ================================================================ */

  app.get<{ Querystring: { fecha?: string } }>(
    '/api/paciente/diario',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const q = request.query.fecha
      const fecha = typeof q === 'string' && RE_FECHA.test(q) ? q : null

      const [registros, plan] = await Promise.all([
        pool.query(
          // `order by rc.tipo_comida` con la tabla ALIADA, no
          // `order by tipo_comida` a secas: el alias de salida es texto
          // y lo tapa, con lo que se ordena alfabéticamente y el
          // almuerzo sale antes que el desayuno. Es el mismo fallo de la
          // Rebanada 9, y volvió a aparecer aquí.
          `select rc.id, rc.tipo_comida::text as tipo_comida, rc.descripcion,
                  rc.kcal, rc.proteina_g, rc.cho_g, rc.grasa_g,
                  to_char(rc.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as updated_at
             from registro_comida rc
            where rc.paciente_id = $1 and rc.clinica_id = $2 and rc.activo = true
              and rc.fecha = coalesce($3::date, (now() at time zone 'America/Costa_Rica')::date)
            order by rc.tipo_comida`,
          [pac.id, pac.clinica_id, fecha],
        ),
        // Objetivo del día: lo que prescribió el profesional en la
        // última consulta cerrada. `conclusion_valoracion` no tiene una
        // columna `plan_nutricional` como asumía el encargo.
        pool.query(
          `select cv.kcal_prescritas, cv.proteina_g, cv.cho_g, cv.grasa_g
             from conclusion_valoracion cv
             join consulta c on c.id = cv.consulta_id
            where c.paciente_id = $1 and c.clinica_id = $2 and c.estado = 'finalizada'
            order by c.numero_consulta desc limit 1`,
          [pac.id, pac.clinica_id],
        ),
      ])

      const filas = registros.rows.map((r) => ({
        id: r['id'],
        tipoComida: r['tipo_comida'],
        descripcion: r['descripcion'],
        kcal: num(r['kcal']),
        proteinaG: num(r['proteina_g']),
        choG: num(r['cho_g']),
        grasaG: num(r['grasa_g']),
        actualizadoEn: r['updated_at'],
      }))

      const suma = (campo: keyof (typeof filas)[number]) =>
        filas.reduce((t, f) => t + (typeof f[campo] === 'number' ? (f[campo] as number) : 0), 0)

      const p = plan.rows[0]

      return reply.send({
        fecha:
          fecha ??
          (
            await pool.query<{ hoy: string }>(
              `select (now() at time zone 'America/Costa_Rica')::date::text as hoy`,
            )
          ).rows[0]!.hoy,
        registros: filas,
        // Se suma solo lo que tiene número. Un total de 400 kcal cuando
        // tres de las cinco comidas no lo tienen no es un total: por eso
        // se dice también cuántas comidas quedaron sin estimar.
        totales: {
          kcal: Math.round(suma('kcal')),
          proteinaG: Math.round(suma('proteinaG')),
          choG: Math.round(suma('choG')),
          grasaG: Math.round(suma('grasaG')),
          sinEstimar: filas.filter((f) => f.kcal === null).length,
        },
        objetivo: p
          ? {
              kcal: num(p['kcal_prescritas']),
              proteinaG: num(p['proteina_g']),
              choG: num(p['cho_g']),
              grasaG: num(p['grasa_g']),
            }
          : null,
      })
    },
  )

  app.post<{ Body: Record<string, unknown> }>(
    '/api/paciente/diario',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}
      const tipo = b['tipoComida']
      if (typeof tipo !== 'string' || !TIPOS_COMIDA.includes(tipo as TipoComida)) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Indica una franja de comida válida' })
      }

      const descripcion = typeof b['descripcion'] === 'string' ? b['descripcion'].trim() : ''
      if (descripcion === '' || descripcion.length > 1000) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'Escribe qué comiste (hasta 1000 caracteres)',
        })
      }

      const kcal = numeroOpcional(b['kcal'], 9999)
      const prot = numeroOpcional(b['proteinaG'], 999)
      const cho = numeroOpcional(b['choG'], 999)
      const grasa = numeroOpcional(b['grasaG'], 999)
      if ([kcal, prot, cho, grasa].includes(undefined)) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Alguna cantidad no es un número válido' })
      }

      const f = b['fecha']
      const fecha = typeof f === 'string' && RE_FECHA.test(f) ? f : null

      const { rows } = await pool.query(
        `insert into registro_comida
           (clinica_id, paciente_id, fecha, tipo_comida, descripcion, kcal, proteina_g, cho_g, grasa_g)
         values ($1,$2,
                 coalesce($3::date, (now() at time zone 'America/Costa_Rica')::date),
                 $4,$5,$6,$7,$8,$9)
         on conflict (paciente_id, fecha, tipo_comida) do update
           set descripcion = excluded.descripcion,
               kcal = excluded.kcal,
               proteina_g = excluded.proteina_g,
               cho_g = excluded.cho_g,
               grasa_g = excluded.grasa_g,
               activo = true,
               updated_at = now()
         returning id, tipo_comida::text as tipo_comida, descripcion,
                   kcal, proteina_g, cho_g, grasa_g`,
        [pac.clinica_id, pac.id, fecha, tipo, descripcion, kcal, prot, cho, grasa],
      )

      const r = rows[0]!
      return reply.code(201).send({
        id: r['id'],
        tipoComida: r['tipo_comida'],
        descripcion: r['descripcion'],
        kcal: num(r['kcal']),
        proteinaG: num(r['proteina_g']),
        choG: num(r['cho_g']),
        grasaG: num(r['grasa_g']),
      })
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/api/paciente/diario/:id',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { id } = request.params
      if (!esUuid(id)) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'No se encontró el registro' })
      }

      // Baja lógica, como en el resto del proyecto: lo que el paciente
      // apuntó y luego borró también es información clínica.
      const { rows } = await pool.query(
        `update registro_comida set activo = false, updated_at = now()
          where id = $1 and paciente_id = $2 and clinica_id = $3 and activo = true
          returning id`,
        [id, pac.id, pac.clinica_id],
      )
      if (!rows[0]) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'No se encontró el registro' })
      }
      return reply.code(204).send()
    },
  )

  app.get<{ Querystring: { dias?: string } }>(
    '/api/paciente/diario/semana',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const n = Number(request.query.dias)
      const dias = Number.isInteger(n) && n >= 1 && n <= 90 ? n : 7

      // `generate_series` para que los días SIN registros salgan a cero
      // en vez de faltar. Una gráfica a la que le faltan los días vacíos
      // dibuja una línea continua sobre huecos y da a entender que el
      // paciente registró todos los días.
      const { rows } = await pool.query(
        `select d::date::text as fecha,
                coalesce(sum(rc.kcal), 0)::numeric as kcal,
                count(rc.id)::int as comidas
           from generate_series(
                  (now() at time zone 'America/Costa_Rica')::date - ($3::int - 1),
                  (now() at time zone 'America/Costa_Rica')::date,
                  interval '1 day') d
           left join registro_comida rc
             on rc.fecha = d::date and rc.paciente_id = $1
            and rc.clinica_id = $2 and rc.activo = true
          group by d
          order by d`,
        [pac.id, pac.clinica_id, dias],
      )

      return reply.send(
        rows.map((r) => ({
          fecha: r['fecha'],
          kcal: Number(r['kcal']),
          comidas: Number(r['comidas']),
        })),
      )
    },
  )

  /* ================================================================ */
  /* Métricas en casa                                                  */
  /* ================================================================ */

  app.get<{ Querystring: { tipo?: string; limite?: string } }>(
    '/api/paciente/metricas',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const t = request.query.tipo
      const tipo = typeof t === 'string' && TIPOS_METRICA.includes(t as TipoMetrica) ? t : null
      const l = Number(request.query.limite)
      const limite = Number.isInteger(l) && l >= 1 && l <= 90 ? l : 30

      const { rows } = await pool.query(
        `select id, tipo::text as tipo, valor, sistolica, diastolica, unidad, nota,
                to_char(medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as medido_en
           from registro_metrica
          where paciente_id = $1 and clinica_id = $2 and activo = true
            and ($4::text is null or tipo::text = $4)
          order by medido_en desc
          limit $3`,
        [pac.id, pac.clinica_id, limite, tipo],
      )

      return reply.send(
        rows.map((r) => ({
          id: r['id'],
          tipo: r['tipo'],
          valor: num(r['valor']),
          sistolica: num(r['sistolica']),
          diastolica: num(r['diastolica']),
          unidad: r['unidad'],
          nota: r['nota'],
          medidoEn: r['medido_en'],
        })),
      )
    },
  )

  app.post<{ Body: Record<string, unknown> }>(
    '/api/paciente/metricas',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}
      const t = b['tipo']
      if (typeof t !== 'string' || !TIPOS_METRICA.includes(t as TipoMetrica)) {
        return reply.code(400).send({ error: 'validacion', message: 'Tipo de medida no válido' })
      }
      const tipo = t as TipoMetrica

      let valor: number | null = null
      let sistolica: number | null = null
      let diastolica: number | null = null

      if (tipo === 'presion_arterial') {
        const s = Number(b['sistolica'])
        const d = Number(b['diastolica'])
        if (!Number.isFinite(s) || s < 40 || s > 300 || !Number.isFinite(d) || d < 20 || d > 200) {
          return reply.code(400).send({
            error: 'validacion',
            message: 'La presión necesita dos números dentro de un rango razonable',
          })
        }
        if (s <= d) {
          // No es quisquillosidad: casi siempre significa que se
          // escribieron al revés, y guardarlo así estropea la serie.
          return reply.code(400).send({
            error: 'validacion',
            message: 'La primera cifra (sistólica) debe ser mayor que la segunda',
          })
        }
        sistolica = s
        diastolica = d
      } else {
        const v = Number(b['valor'])
        if (!Number.isFinite(v) || v <= 0 || v > 100000) {
          return reply.code(400).send({ error: 'validacion', message: 'Indica un valor válido' })
        }
        valor = v
      }

      const unidadCliente = typeof b['unidad'] === 'string' ? b['unidad'].trim().slice(0, 20) : ''
      // Para los tipos conocidos manda la unidad del servidor: un peso
      // en libras guardado como "kg" no se detecta después.
      const unidad = tipo === 'otro' ? unidadCliente || '—' : UNIDAD[tipo]

      const nota = typeof b['nota'] === 'string' && b['nota'].trim() !== ''
        ? b['nota'].trim().slice(0, 500)
        : null

      const medidoEn = typeof b['medidoEn'] === 'string' ? b['medidoEn'] : null

      try {
        const { rows } = await pool.query(
          `insert into registro_metrica
             (clinica_id, paciente_id, tipo, valor, sistolica, diastolica, unidad, medido_en, nota)
           values ($1,$2,$3,$4,$5,$6,$7, coalesce($8::timestamptz, now()), $9)
           returning id, tipo::text as tipo, valor, sistolica, diastolica, unidad, nota,
                     to_char(medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as medido_en`,
          [pac.clinica_id, pac.id, tipo, valor, sistolica, diastolica, unidad, medidoEn, nota],
        )
        const r = rows[0]!
        return reply.code(201).send({
          id: r['id'],
          tipo: r['tipo'],
          valor: num(r['valor']),
          sistolica: num(r['sistolica']),
          diastolica: num(r['diastolica']),
          unidad: r['unidad'],
          nota: r['nota'],
          medidoEn: r['medido_en'],
        })
      } catch (e) {
        // La restricción de "no futuro" vive en la base; se traduce aquí
        // para no devolver un error de Postgres al paciente.
        if (e instanceof Error && e.message.includes('chk_no_futuro')) {
          return reply
            .code(400)
            .send({ error: 'validacion', message: 'Esa fecha todavía no ha llegado' })
        }
        throw e
      }
    },
  )

  app.get(
    '/api/paciente/metricas/resumen',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { rows } = await pool.query(
        `select distinct on (tipo)
                tipo::text as tipo, valor, sistolica, diastolica, unidad,
                to_char(medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as medido_en
           from registro_metrica
          where paciente_id = $1 and clinica_id = $2 and activo = true
          order by tipo, medido_en desc`,
        [pac.id, pac.clinica_id],
      )

      return reply.send(
        Object.fromEntries(
          rows.map((r) => [
            r['tipo'],
            {
              valor: num(r['valor']),
              sistolica: num(r['sistolica']),
              diastolica: num(r['diastolica']),
              unidad: r['unidad'],
              medidoEn: r['medido_en'],
            },
          ]),
        ),
      )
    },
  )

  /* ================================================================ */
  /* Lo mismo, visto por el profesional                                */
  /* ================================================================ */

  //
  // Sin esto el diario es un cuaderno que nadie lee. El paciente apunta
  // lo que come para que su nutricionista lo vea en la siguiente
  // consulta; si no hay forma de verlo, no hay motivo para apuntarlo.
  app.get<{ Params: { id: string }; Querystring: { dias?: string } }>(
    '/api/pacientes/:id/registros',
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

      const n = Number(request.query.dias)
      const dias = Number.isInteger(n) && n >= 1 && n <= 90 ? n : 14

      const [comidas, metricas] = await Promise.all([
        pool.query(
          `select rc.fecha::text as fecha, rc.tipo_comida::text as tipo_comida, rc.descripcion,
                  rc.kcal, rc.proteina_g, rc.cho_g, rc.grasa_g
             from registro_comida rc
            where rc.paciente_id = $1 and rc.clinica_id = $2 and rc.activo = true
              and rc.fecha >= (now() at time zone 'America/Costa_Rica')::date - ($3::int - 1)
            order by rc.fecha desc, rc.tipo_comida`,
          [id, tenantId, dias],
        ),
        pool.query(
          `select tipo::text as tipo, valor, sistolica, diastolica, unidad, nota,
                  to_char(medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as medido_en
             from registro_metrica
            where paciente_id = $1 and clinica_id = $2 and activo = true
              and medido_en >= now() - ($3::int || ' days')::interval
            order by medido_en desc`,
          [id, tenantId, dias],
        ),
      ])

      return reply.send({
        dias,
        comidas: comidas.rows.map((r) => ({
          fecha: r['fecha'],
          tipoComida: r['tipo_comida'],
          descripcion: r['descripcion'],
          kcal: num(r['kcal']),
          proteinaG: num(r['proteina_g']),
          choG: num(r['cho_g']),
          grasaG: num(r['grasa_g']),
        })),
        metricas: metricas.rows.map((r) => ({
          tipo: r['tipo'],
          valor: num(r['valor']),
          sistolica: num(r['sistolica']),
          diastolica: num(r['diastolica']),
          unidad: r['unidad'],
          nota: r['nota'],
          medidoEn: r['medido_en'],
        })),
      })
    },
  )
}
