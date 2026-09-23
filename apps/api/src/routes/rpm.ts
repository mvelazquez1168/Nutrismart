/**
 * Panel de monitoreo continuo — RPM-02.
 *
 * Lo que el profesional mira entre consultas: quién está reportando,
 * quién dejó de hacerlo y cómo se encuentran.
 *
 * El valor de esta pantalla no está en quien va bien: está en detectar,
 * sin abrir doce expedientes, a quién lleva nueve días sin apuntar nada
 * o lleva una semana reportando que se encuentra mal. Por eso las
 * columnas que ordenan la lista son «días sin reportar» y «cómo se
 * encuentra», no el peso.
 *
 * **Alcance (CLI-02):** un nutricionista ve solo SUS pacientes; un
 * administrador de clínica ve los de toda la clínica. El encargo
 * consultaba `where p.clinica_id = $1` a secas, lo que habría enseñado a
 * cada nutricionista el seguimiento de los pacientes de sus compañeros.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}

/** Meses de historia pedidos, acotado. Un `NaN` no llega a la consulta. */
function mesesPedidos(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1) return 3
  return Math.min(Math.floor(n), 12)
}

export async function registerRpmRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Lista de seguimiento                                              */
  /* ================================================================ */

  app.get('/api/rpm/pacientes', { preHandler: requireAuth }, async (request, reply) => {
    const { tenantId, sub, roles } = request.auth
    const alcance = await resolverAlcance(tenantId, sub, roles)
    if (!alcance) return reply.code(403).send(sinProfesional())

    // Una sola consulta con LATERAL en vez de cinco y un ensamblado en
    // JavaScript. Cada bloque se resuelve una vez por paciente, y lo que
    // llega ya viene emparejado: no hay forma de que un mapa por id se
    // desincronice de otro.
    //
    // `dias_sin_*` se calcula en SQL contra la fecha de Costa Rica. En
    // JavaScript, restar un Date de una columna `date` mezcla dos husos
    // y devuelve un día de más o de menos según la hora a la que se
    // mire la pantalla.
    const { rows } = await pool.query(
      `with hoy as (select (now() at time zone 'America/Costa_Rica')::date as d)
       select p.id, p.nombre,
              coalesce(cfg.nombre_preferido, p.nombre) as nombre_mostrado,
              cfg.foto_url,

              pes.valor      as peso_valor,
              to_char(pes.medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as peso_en,
              glu.valor      as glucosa_valor,
              to_char(glu.medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as glucosa_en,
              pre.sistolica, pre.diastolica,
              to_char(pre.medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as presion_en,

              bie.estado     as bienestar_estado,
              to_char(bie.fecha,'YYYY-MM-DD') as bienestar_fecha,
              (select d from hoy) - bie.fecha as dias_sin_bienestar,
              (select d from hoy) - com.fecha as dias_sin_diario,
              to_char(com.fecha,'YYYY-MM-DD') as diario_fecha,

              spark.puntos,
              coalesce(al.abiertas, 0) as alertas_abiertas
         from paciente p
         left join configuracion_paciente cfg
                on cfg.paciente_id = p.id and cfg.clinica_id = p.clinica_id

         -- Última lectura de cada tipo. El desempate por id es necesario:
         -- dos tomas del mismo instante dejarían el orden al plan de
         -- ejecución, que es el fallo que apareció en la Rebanada 23.
         left join lateral (
           select valor, medido_en from registro_metrica m
            where m.paciente_id = p.id and m.tipo = 'peso' and m.activo
            order by m.medido_en desc, m.id desc limit 1
         ) pes on true
         left join lateral (
           select valor, medido_en from registro_metrica m
            where m.paciente_id = p.id and m.tipo = 'glucosa' and m.activo
            order by m.medido_en desc, m.id desc limit 1
         ) glu on true
         left join lateral (
           select sistolica, diastolica, medido_en from registro_metrica m
            where m.paciente_id = p.id and m.tipo = 'presion_arterial' and m.activo
            order by m.medido_en desc, m.id desc limit 1
         ) pre on true

         left join lateral (
           select estado, fecha from registro_bienestar b
            where b.paciente_id = p.id and b.activo
            order by b.fecha desc, b.id desc limit 1
         ) bie on true
         left join lateral (
           select fecha from registro_comida c
            where c.paciente_id = p.id and c.activo
            order by c.fecha desc, c.id desc limit 1
         ) com on true

         -- Minigráfica de peso: los últimos 14 valores de los últimos 30
         -- días, en orden cronológico para poder dibujarlos.
         left join lateral (
           select json_agg(json_build_object('fecha', f, 'valor', v) order by f) as puntos
             from (
               select to_char(m.medido_en at time zone 'America/Costa_Rica','YYYY-MM-DD') as f,
                      m.valor as v
                 from registro_metrica m
                where m.paciente_id = p.id and m.tipo = 'peso' and m.activo
                  and m.medido_en >= now() - interval '30 days'
                order by m.medido_en desc, m.id desc
                limit 14
             ) ult
         ) spark on true

         -- Alertas abiertas (activas o reconocidas), desde la R27.
         left join lateral (
           select count(*)::int as abiertas from alerta_rpm a
            where a.paciente_id = p.id and a.estado <> 'resuelta'
         ) al on true

        where p.clinica_id = $1
          and p.estado = 'activo'
          -- CLI-02: null = admin, ve toda la clínica.
          and ($2::uuid is null or p.nutricionista_id = $2)
        order by p.nombre`,
      [tenantId, alcance.restringirA],
    )

    return reply.send(
      rows.map((r) => ({
        id: r['id'],
        nombre: r['nombre_mostrado'],
        fotoUrl: r['foto_url'] ?? null,
        ultimoPeso: r['peso_valor'] === null ? null : { valor: num(r['peso_valor']), medidoEn: r['peso_en'] },
        ultimaGlucosa:
          r['glucosa_valor'] === null ? null : { valor: num(r['glucosa_valor']), medidoEn: r['glucosa_en'] },
        ultimaPresion:
          r['sistolica'] === null
            ? null
            : {
                sistolica: num(r['sistolica']),
                diastolica: num(r['diastolica']),
                medidoEn: r['presion_en'],
              },
        ultimoBienestar:
          r['bienestar_estado'] === null
            ? null
            : { estado: Number(r['bienestar_estado']), fecha: r['bienestar_fecha'] },
        // `null` significa «nunca ha reportado», que NO es lo mismo que
        // «hace muchos días». La pantalla los distingue.
        diasSinBienestar: r['dias_sin_bienestar'] === null ? null : Number(r['dias_sin_bienestar']),
        diasSinDiario: r['dias_sin_diario'] === null ? null : Number(r['dias_sin_diario']),
        sparklinePeso: (r['puntos'] ?? []) as { fecha: string; valor: number }[],
        alertasAbiertas: Number(r['alertas_abiertas']),
      })),
    )
  })

  /* ================================================================ */
  /* Detalle de un paciente                                            */
  /* ================================================================ */

  app.get<{ Params: { id: string }; Querystring: { meses?: string } }>(
    '/api/rpm/pacientes/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      const meses = mesesPedidos(request.query.meses)

      // Un paciente de otra clínica y uno de un compañero responden lo
      // mismo: 404. Desde fuera no se puede distinguir un id inventado
      // de uno que existe pero no te toca.
      const { rows: pacs } = await pool.query<{ id: string; nombre: string }>(
        `select id, nombre from paciente
          where id = $1 and clinica_id = $2 and estado = 'activo'
            and ($3::uuid is null or nutricionista_id = $3)`,
        [esUuid(id) ? id : null, tenantId, alcance.restringirA],
      )
      const pac = pacs[0]
      if (!pac) {
        return reply
          .code(404)
          .send({ error: 'paciente_no_encontrado', message: 'No se encontró el paciente' })
      }

      // `make_interval` con parámetro, no interpolación de texto en el
      // SQL: el encargo construía `INTERVAL '${meses} months'` a mano.
      const [metricas, bienestar, medidas, diario] = await Promise.all([
        pool.query(
          `select tipo::text as tipo, valor, sistolica, diastolica, unidad,
                  to_char(medido_en at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as medido_en
             from registro_metrica
            where paciente_id = $1 and clinica_id = $2 and activo = true
              and medido_en >= now() - make_interval(months => $3)
            order by tipo, medido_en, id`,
          [pac.id, tenantId, meses],
        ),
        pool.query(
          `select to_char(fecha,'YYYY-MM-DD') as fecha, estado, sintomas, nota
             from registro_bienestar
            where paciente_id = $1 and clinica_id = $2 and activo = true
              and fecha >= (now() at time zone 'America/Costa_Rica')::date - make_interval(months => $3)
            order by fecha, id`,
          [pac.id, tenantId, meses],
        ),
        pool.query(
          `select to_char(fecha,'YYYY-MM-DD') as fecha,
                  cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm
             from registro_medida_corporal
            where paciente_id = $1 and clinica_id = $2 and activo = true
              and fecha >= (now() at time zone 'America/Costa_Rica')::date - make_interval(months => $3)
            order by fecha, id`,
          [pac.id, tenantId, meses],
        ),
        pool.query(
          // `count(kcal)` y no `count(*)`: dice cuántas comidas de ese
          // día traen calorías, que es lo que hace interpretable el
          // total. Un día con 400 kcal y tres comidas sin estimar no es
          // un día de 400 kcal.
          `select to_char(fecha,'YYYY-MM-DD') as fecha,
                  sum(kcal) as kcal_total,
                  count(*)::int as comidas,
                  count(kcal)::int as comidas_con_kcal
             from registro_comida
            where paciente_id = $1 and clinica_id = $2 and activo = true
              and fecha >= (now() at time zone 'America/Costa_Rica')::date - make_interval(months => $3)
            group by fecha
            order by fecha`,
          [pac.id, tenantId, meses],
        ),
      ])

      // Cuántas veces apareció cada síntoma. Es lo que convierte una
      // lista de partes diarios en algo accionable: «cinco días con
      // insomnio este mes» es un dato de consulta.
      const conteo = new Map<string, number>()
      for (const b of bienestar.rows) {
        for (const s of (b['sintomas'] ?? []) as string[]) {
          conteo.set(s, (conteo.get(s) ?? 0) + 1)
        }
      }

      return reply.send({
        paciente: { id: pac.id, nombre: pac.nombre },
        meses,
        metricas: metricas.rows.map((m) => ({
          tipo: m['tipo'],
          valor: num(m['valor']),
          sistolica: num(m['sistolica']),
          diastolica: num(m['diastolica']),
          unidad: m['unidad'],
          medidoEn: m['medido_en'],
        })),
        bienestar: bienestar.rows.map((b) => ({
          fecha: b['fecha'],
          estado: Number(b['estado']),
          sintomas: (b['sintomas'] ?? []) as string[],
          nota: b['nota'],
        })),
        sintomasFrecuentes: [...conteo.entries()]
          .map(([sintoma, veces]) => ({ sintoma, veces }))
          .sort((a, b) => b.veces - a.veces || a.sintoma.localeCompare(b.sintoma)),
        medidas: medidas.rows.map((m) => ({
          fecha: m['fecha'],
          cinturaCm: num(m['cintura_cm']),
          caderaCm: num(m['cadera_cm']),
          pechoCm: num(m['pecho_cm']),
          brazoCm: num(m['brazo_cm']),
          musloCm: num(m['muslo_cm']),
          cuelloCm: num(m['cuello_cm']),
        })),
        diario: diario.rows.map((d) => ({
          fecha: d['fecha'],
          kcal: num(d['kcal_total']),
          comidas: Number(d['comidas']),
          comidasConKcal: Number(d['comidas_con_kcal']),
        })),
      })
    },
  )
}
