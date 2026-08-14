/**
 * Consulta de seguimiento — EVAL-08.
 *
 * Dos lecturas: la foto de la última valoración cerrada, para precargar
 * lo que no cambia, y la comparación entre esa y la que está en curso.
 *
 * ── Sobre los deltas y lo que NO dicen ──────────────────────────────
 *
 * Se devuelve la DIRECCIÓN del cambio (sube, baja, igual) y su
 * magnitud. No se devuelve si el cambio es bueno o malo.
 *
 * La especificación pedía marcar cada indicador como 'mejora' o
 * 'empeora' —bajar de peso como mejora, por ejemplo— y eso es un juicio
 * clínico que este sistema no puede emitir. Bajar dos kilos es un logro
 * en un paciente con obesidad y una señal de alarma en uno desnutrido o
 * con cáncer; sin un objetivo de peso registrado, el servidor no tiene
 * con qué distinguirlos, y pintarlo de verde sería afirmar algo que
 * nadie ha comprobado.
 *
 * Es el mismo criterio de la Rebanada 5: el sistema captura y presenta;
 * la aritmética contra un valor anterior no es un diagnóstico. El día
 * que se registre una meta ponderal, «acercándose al objetivo» pasará a
 * ser computable y honesto.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { pacienteVisible } from './consultas.js'

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}
function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/** Los indicadores que se comparan entre consultas, en orden de lectura. */
const INDICADORES = [
  { clave: 'pesoKg', etiqueta: 'Peso', unidad: 'kg', origen: 'antropometria' },
  { clave: 'imc', etiqueta: 'IMC', unidad: '', origen: 'antropometria' },
  { clave: 'pctGrasa', etiqueta: 'Grasa corporal', unidad: '%', origen: 'antropometria' },
  { clave: 'masaLibreGrasaKg', etiqueta: 'Masa libre de grasa', unidad: 'kg', origen: 'antropometria' },
  { clave: 'masaMuscularKg', etiqueta: 'Masa muscular', unidad: 'kg', origen: 'antropometria' },
  { clave: 'anguloFase', etiqueta: 'Ángulo de fase', unidad: '°', origen: 'antropometria' },
  { clave: 'cinturaCm', etiqueta: 'Cintura', unidad: 'cm', origen: 'antropometria' },
  { clave: 'icc', etiqueta: 'Índice cintura-cadera', unidad: '', origen: 'antropometria' },
  { clave: 'kcalEstimadas', etiqueta: 'Ingesta estimada', unidad: 'kcal', origen: 'dietetico' },
  { clave: 'proteinaG', etiqueta: 'Proteína', unidad: 'g', origen: 'dietetico' },
] as const

interface Foto {
  consulta: {
    id: string
    tipo: string
    numeroConsulta: number
    fechaConsulta: string
    estado: string
  }
  antropometria: Record<string, number | string | null> | null
  historial: Record<string, unknown> | null
  dietetico: Record<string, unknown> | null
  conclusion: Record<string, unknown> | null
}

/**
 * Reúne todo lo de una consulta.
 *
 * `historial` y `dietetico` se buscan por PACIENTE, no por consulta:
 * ambos son únicos por paciente y se actualizan visita a visita, así que
 * su `consulta_id` apunta a la última que los tocó. Buscarlos por
 * consulta —como decía la especificación— devolvería vacío en cuanto
 * otra consulta posterior los hubiera editado.
 */
async function reunir(
  tenantId: string,
  pacienteId: string,
  consulta: {
    id: string
    tipo: string
    numero_consulta: number
    fecha_consulta: string
    estado: string
  },
): Promise<Foto> {
  const [antrop, hist, diet, conc] = await Promise.all([
    pool.query(
      `select peso_kg, talla_cm, imc, pct_grasa, masa_libre_grasa_kg, masa_muscular_kg,
              angulo_fase, cintura_cm, cadera_cm, icc, metodo::text as metodo,
              to_char(fecha_medicion,'YYYY-MM-DD') as fecha_medicion
         from medicion_antropometrica
        where consulta_id = $1 and clinica_id = $2`,
      [consulta.id, tenantId],
    ),
    pool.query(
      `select tipo_actividad, sesiones_semana, duracion_min, faf, fuma, alcohol,
              apf, app, sintomas_gi, consulta_id
         from historial_clinico where clinica_id = $1 and paciente_id = $2`,
      [tenantId, pacienteId],
    ),
    pool.query(
      `select kcal_estimadas, proteina_g, cho_g, grasa_g, fibra_g, hidratacion_litros,
              recordatorio_24h, frecuencia_consumo, consulta_id
         from evaluacion_dietetica where clinica_id = $1 and paciente_id = $2`,
      [tenantId, pacienteId],
    ),
    pool.query(
      `select diagnostico_principal, diagnostico_cie10, kcal_prescritas,
              pct_proteina, pct_cho, pct_grasa, proteina_g, cho_g, grasa_g,
              restricciones, acuerdos, recomendaciones
         from conclusion_valoracion where consulta_id = $1 and clinica_id = $2`,
      [consulta.id, tenantId],
    ),
  ])

  const a = antrop.rows[0]
  const h = hist.rows[0]
  const d = diet.rows[0]
  const c = conc.rows[0]

  return {
    consulta: {
      id: consulta.id,
      tipo: consulta.tipo,
      numeroConsulta: Number(consulta.numero_consulta),
      fechaConsulta: consulta.fecha_consulta,
      estado: consulta.estado,
    },
    antropometria: a
      ? {
          pesoKg: num(a['peso_kg']),
          tallaCm: num(a['talla_cm']),
          imc: num(a['imc']),
          pctGrasa: num(a['pct_grasa']),
          masaLibreGrasaKg: num(a['masa_libre_grasa_kg']),
          masaMuscularKg: num(a['masa_muscular_kg']),
          anguloFase: num(a['angulo_fase']),
          cinturaCm: num(a['cintura_cm']),
          caderaCm: num(a['cadera_cm']),
          icc: num(a['icc']),
          metodo: (a['metodo'] as string | null) ?? null,
          fechaMedicion: (a['fecha_medicion'] as string | null) ?? null,
        }
      : null,
    historial: h
      ? {
          tipoActividad: (h['tipo_actividad'] as string | null) ?? null,
          sesionesSemana: num(h['sesiones_semana']),
          duracionMin: num(h['duracion_min']),
          faf: num(h['faf']),
          fuma: h['fuma'] ?? null,
          alcohol: h['alcohol'] ?? null,
          apf: h['apf'] ?? [],
          app: h['app'] ?? [],
          sintomasGi: h['sintomas_gi'] ?? [],
          // Dice si el historial se editó en ESTA consulta o viene de otra.
          actualizadoEnConsultaId: (h['consulta_id'] as string | null) ?? null,
        }
      : null,
    dietetico: d
      ? {
          kcalEstimadas: num(d['kcal_estimadas']),
          proteinaG: num(d['proteina_g']),
          choG: num(d['cho_g']),
          grasaG: num(d['grasa_g']),
          fibraG: num(d['fibra_g']),
          hidratacionLitros: num(d['hidratacion_litros']),
          recordatorio24h: d['recordatorio_24h'] ?? [],
          frecuenciaConsumo: d['frecuencia_consumo'] ?? {},
          actualizadoEnConsultaId: (d['consulta_id'] as string | null) ?? null,
        }
      : null,
    conclusion: c
      ? {
          diagnosticoPrincipal: (c['diagnostico_principal'] as string | null) ?? null,
          diagnosticoCie10: (c['diagnostico_cie10'] as string | null) ?? null,
          kcalPrescritas: num(c['kcal_prescritas']),
          pctProteina: num(c['pct_proteina']),
          pctCho: num(c['pct_cho']),
          pctGrasa: num(c['pct_grasa']),
          proteinaG: num(c['proteina_g']),
          choG: num(c['cho_g']),
          grasaG: num(c['grasa_g']),
          restricciones: c['restricciones'] ?? [],
          acuerdos: c['acuerdos'] ?? [],
          recomendaciones: c['recomendaciones'] ?? [],
        }
      : null,
  }
}

function valorDe(foto: Foto | null, origen: string, clave: string): number | null {
  if (!foto) return null
  const bloque = origen === 'antropometria' ? foto.antropometria : foto.dietetico
  if (!bloque) return null
  const v = (bloque as Record<string, unknown>)[clave]
  return typeof v === 'number' ? v : null
}

export async function registerSeguimientoRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/consultas/ultima-finalizada                */
  /* ---------------------------------------------------------------- */
  // Fastify resuelve los segmentos estáticos antes que los paramétricos,
  // así que esta ruta gana sobre /consultas/:consultaId sin importar el
  // orden de registro.
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/consultas/ultima-finalizada',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const { rows } = await pool.query(
        `select id, tipo::text as tipo, numero_consulta, estado::text as estado,
                to_char(fecha_consulta,'YYYY-MM-DD') as fecha_consulta
           from consulta
          where clinica_id = $1 and paciente_id = $2 and estado = 'finalizada'
          order by numero_consulta desc
          limit 1`,
        [tenantId, id],
      )

      // 404 significa "es la primera valoración", no un fallo: quien
      // llama lo trata como modo inicial y sigue.
      if (!rows[0]) {
        return reply.code(404).send({
          error: 'sin_consulta_previa',
          message: 'Este paciente no tiene ninguna valoración finalizada',
        })
      }

      return reply.send(await reunir(tenantId, id, rows[0] as never))
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/consultas/comparativa                      */
  /* ---------------------------------------------------------------- */
  app.get<{
    Params: { id: string }
    Querystring: { consultaActualId?: string; consultaAnteriorId?: string }
  }>(
    '/api/pacientes/:id/consultas/comparativa',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const actualId = request.query.consultaActualId ?? ''
      if (!esUuid(actualId)) {
        return reply.code(400).send({
          error: 'validacion',
          message: 'Indica la consulta actual en consultaActualId',
        })
      }

      const SQL_UNA = `
        select id, tipo::text as tipo, numero_consulta, estado::text as estado,
               to_char(fecha_consulta,'YYYY-MM-DD') as fecha_consulta
          from consulta
         where id = $1 and clinica_id = $2 and paciente_id = $3`

      // Toda consulta se busca acotada por clínica Y paciente: sin eso,
      // un id de otra clínica entraría en la comparación.
      const actual = await pool.query(SQL_UNA, [actualId, tenantId, id])
      if (!actual.rows[0]) {
        return reply
          .code(404)
          .send({ error: 'consulta_no_encontrada', message: 'No se encontró la consulta' })
      }

      const anteriorId = request.query.consultaAnteriorId
      const anterior = anteriorId
        ? esUuid(anteriorId)
          ? await pool.query(SQL_UNA, [anteriorId, tenantId, id])
          : { rows: [] }
        : await pool.query(
            `select id, tipo::text as tipo, numero_consulta, estado::text as estado,
                    to_char(fecha_consulta,'YYYY-MM-DD') as fecha_consulta
               from consulta
              where clinica_id = $1 and paciente_id = $2 and estado = 'finalizada'
                and numero_consulta < $3
              order by numero_consulta desc limit 1`,
            [tenantId, id, Number(actual.rows[0]['numero_consulta'])],
          )

      const fotoActual = await reunir(tenantId, id, actual.rows[0] as never)
      const fotoAnterior = anterior.rows[0]
        ? await reunir(tenantId, id, anterior.rows[0] as never)
        : null

      const indicadores = INDICADORES.map((ind) => {
        const antes = valorDe(fotoAnterior, ind.origen, ind.clave)
        const ahora = valorDe(fotoActual, ind.origen, ind.clave)
        const hayAmbos = antes !== null && ahora !== null
        const delta = hayAmbos ? Math.round((ahora - antes) * 100) / 100 : null

        return {
          clave: ind.clave,
          etiqueta: ind.etiqueta,
          unidad: ind.unidad,
          anterior: antes,
          actual: ahora,
          delta,
          pctCambio:
            hayAmbos && antes !== 0 ? Math.round(((ahora - antes) / antes) * 1000) / 10 : null,
          // Dirección, no valoración. Ver la nota de cabecera.
          direccion: delta === null ? null : delta > 0 ? 'sube' : delta < 0 ? 'baja' : 'igual',
        }
      })

      const dias =
        fotoAnterior !== null
          ? Math.round(
              (new Date(fotoActual.consulta.fechaConsulta).getTime() -
                new Date(fotoAnterior.consulta.fechaConsulta).getTime()) /
                86_400_000,
            )
          : null

      // Los acuerdos de la consulta anterior: cuántos se cumplieron.
      const acuerdosPrevios = (fotoAnterior?.conclusion?.['acuerdos'] ?? []) as {
        texto: string
        cumplido: boolean
      }[]

      return reply.send({
        anterior: fotoAnterior,
        actual: fotoActual,
        diasEntre: dias,
        indicadores: indicadores.filter((i) => i.anterior !== null || i.actual !== null),
        acuerdos: {
          total: acuerdosPrevios.length,
          cumplidos: acuerdosPrevios.filter((a) => a.cumplido).length,
          detalle: acuerdosPrevios,
        },
      })
    },
  )
}
