/**
 * Evaluación dietética — EVAL-04.
 *
 * Recordatorio de 24 horas, frecuencia de consumo y macros. Como el
 * historial clínico, es UNO por paciente y se actualiza consulta a
 * consulta.
 *
 * Los macros NO se derivan del recordatorio: hacerlo bien exige una
 * tabla de composición de alimentos, que es otra épica. Aquí los
 * declara el profesional, y la interfaz lo dice.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { pacienteVisible } from './consultas.js'

const CAMPOS = `
  id, consulta_id, recordatorio_24h, frecuencia_consumo, hidratacion_litros,
  kcal_estimadas, proteina_g, cho_g, grasa_g, fibra_g, notas_dieteticas, updated_at,
  tiempos_por_dia, tiempos_realizados, lugar_comidas, quien_prepara, apetito,
  grasas_cocinar, tipos_coccion, agrega_sal, consume_azucar, usa_edulcorante,
  dietas_realizadas, consume_agua, cantidad_agua,
  alimentos_no_consume, alimentos_preferidos
`

/* ------------------------------------------------------------------ */
/* Habitos alimentarios — R50                                          */
/* ------------------------------------------------------------------ */

/**
 * Las respuestas cerradas que el servidor acepta.
 *
 * Son las mismas listas que los CHECK de la migracion 050. Repetirlas
 * aqui no es duplicacion ociosa: el CHECK protege la base de cualquier
 * cliente, y esta lista permite devolver un error de validacion con el
 * nombre del campo en vez de un 500 de Postgres.
 *
 * Lo que NO esta en la lista se rechaza, no se descarta en silencio: a
 * diferencia de las restricciones dieteticas de la conclusion —donde el
 * descarte silencioso evita borrar datos clinicos al reguardar—, aqui un
 * valor desconocido solo puede venir de un cliente roto.
 */
const TIEMPOS_POR_DIA = ['1-2', '3-5', '6+']
const LUGARES = ['casa', 'fuera', 'otro']
const APETITOS = ['bueno', 'regular', 'malo']
const TIEMPOS_COMIDA = [
  'desayuno',
  'merienda_am',
  'almuerzo',
  'merienda_pm',
  'cena',
  'colacion_nocturna',
]
const COCCIONES = ['asado', 'fritura', 'hervido', 'plancha', 'vapor']

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}
function noEncontradoPaciente() {
  return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
}

function aEvaluacion(f: Record<string, unknown>) {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    id: f['id'] as string,
    consultaId: (f['consulta_id'] as string | null) ?? null,
    recordatorio24h: f['recordatorio_24h'] ?? [],
    frecuenciaConsumo: f['frecuencia_consumo'] ?? {},
    hidratacionLitros: num(f['hidratacion_litros']),
    kcalEstimadas: num(f['kcal_estimadas']),
    proteinaG: num(f['proteina_g']),
    choG: num(f['cho_g']),
    grasaG: num(f['grasa_g']),
    fibraG: num(f['fibra_g']),
    notasDieteticas: (f['notas_dieteticas'] as string | null) ?? null,
    updatedAt: f['updated_at'] as Date,

    /*
     * Habitos alimentarios (R50).
     *
     * Los tres si/no viajan como `boolean | null` y **null significa «no
     * se pregunto»**, que no es lo mismo que «no». Mapearlo a false
     * convertiria una pregunta sin responder en un «no agrega sal» que
     * nadie dijo.
     */
    tiemposPorDia: (f['tiempos_por_dia'] as string | null) ?? null,
    tiemposRealizados: (f['tiempos_realizados'] as string[] | null) ?? [],
    lugarComidas: (f['lugar_comidas'] as string | null) ?? null,
    quienPrepara: (f['quien_prepara'] as string | null) ?? null,
    apetito: (f['apetito'] as string | null) ?? null,
    grasasCocinar: (f['grasas_cocinar'] as string | null) ?? null,
    tiposCoccion: (f['tipos_coccion'] as string[] | null) ?? [],
    agregaSal: (f['agrega_sal'] as boolean | null) ?? null,
    consumeAzucar: (f['consume_azucar'] as boolean | null) ?? null,
    usaEdulcorante: (f['usa_edulcorante'] as boolean | null) ?? null,
    dietasRealizadas: (f['dietas_realizadas'] as string | null) ?? null,
    consumeAgua: (f['consume_agua'] as boolean | null) ?? null,
    cantidadAgua: (f['cantidad_agua'] as string | null) ?? null,
    alimentosNoConsume: (f['alimentos_no_consume'] as string | null) ?? null,
    alimentosPreferidos: (f['alimentos_preferidos'] as string | null) ?? null,
  }
}

export async function registerDieteticoRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/dietetico',
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
        `select ${CAMPOS} from evaluacion_dietetica where clinica_id = $1 and paciente_id = $2`,
        [tenantId, id],
      )
      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: 'sin_evaluacion', message: 'Este paciente aún no tiene evaluación dietética' })
      }
      return reply.send(aEvaluacion(rows[0] as Record<string, unknown>))
    },
  )

  app.put<{ Params: { id: string } }>(
    '/api/pacientes/:id/dietetico',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const c = (request.body ?? {}) as Record<string, unknown>
      const errores: ErrorCampo[] = []

      const consultaId = typeof c['consultaId'] === 'string' ? c['consultaId'] : null
      if (consultaId !== null && !esUuid(consultaId)) {
        errores.push({ campo: 'consultaId', mensaje: 'No es un identificador válido' })
      }

      // El recordatorio se valida en su forma, no en su contenido: si no
      // es una lista, lo que llegue romperá la pantalla que lo dibuja.
      if (c['recordatorio24h'] !== undefined && !Array.isArray(c['recordatorio24h'])) {
        errores.push({ campo: 'recordatorio24h', mensaje: 'Debe ser una lista de comidas' })
      }
      if (
        c['frecuenciaConsumo'] !== undefined &&
        (typeof c['frecuenciaConsumo'] !== 'object' ||
          c['frecuenciaConsumo'] === null ||
          Array.isArray(c['frecuenciaConsumo']))
      ) {
        errores.push({ campo: 'frecuenciaConsumo', mensaje: 'Debe ser un objeto grupo → frecuencia' })
      }

      function numero(campo: string, min: number, max: number, entero = false): number | null {
        const v = c[campo]
        if (v === undefined || v === null || v === '') return null
        const n = Number(v)
        if (!Number.isFinite(n) || n < min || n > max || (entero && !Number.isInteger(n))) {
          errores.push({
            campo,
            mensaje: entero
              ? `Debe ser un entero entre ${min} y ${max}`
              : `Debe ser un número entre ${min} y ${max}`,
          })
          return null
        }
        return n
      }

      const valores = {
        hidratacion: numero('hidratacionLitros', 0, 20),
        kcal: numero('kcalEstimadas', 0, 20000, true),
        proteina: numero('proteinaG', 0, 2000),
        cho: numero('choG', 0, 2000),
        grasa: numero('grasaG', 0, 2000),
        fibra: numero('fibraG', 0, 500),
      }

      /* ---- Habitos alimentarios (R50) ---- */

      /** Texto libre, recortado. Vacio es null: es «sin dato», no «''». */
      function texto(campo: string, max: number): string | null {
        const v = c[campo]
        if (typeof v !== 'string') return null
        const t = v.trim()
        if (t === '') return null
        if (t.length > max) {
          errores.push({ campo, mensaje: `No puede pasar de ${max} caracteres` })
          return null
        }
        return t
      }

      /** Una de la lista, o null. Lo que no esta en la lista es un error. */
      function opcion(campo: string, permitidas: string[]): string | null {
        const v = c[campo]
        if (v === undefined || v === null || v === '') return null
        if (typeof v !== 'string' || !permitidas.includes(v)) {
          errores.push({ campo, mensaje: 'No es una opción válida' })
          return null
        }
        return v
      }

      /**
       * Varias de la lista, sin repetidos y en el orden declarado.
       *
       * El orden se normaliza a proposito: los tiempos de comida se
       * muestran en orden cronologico, y guardar el orden en que el
       * profesional fue marcando casillas haria que la misma respuesta se
       * leyera distinta segun como se tildo.
       */
      function varias(campo: string, permitidas: string[]): string[] {
        const v = c[campo]
        if (v === undefined || v === null) return []
        if (!Array.isArray(v)) {
          errores.push({ campo, mensaje: 'Debe ser una lista' })
          return []
        }
        const malas = v.filter((x) => typeof x !== 'string' || !permitidas.includes(x))
        if (malas.length > 0) {
          errores.push({ campo, mensaje: 'Contiene opciones que no existen' })
          return []
        }
        return permitidas.filter((p) => (v as string[]).includes(p))
      }

      /** Si/no/sin responder. `null` es un valor, no un fallo. */
      function siNo(campo: string): boolean | null {
        const v = c[campo]
        if (v === undefined || v === null || v === '') return null
        if (typeof v !== 'boolean') {
          errores.push({ campo, mensaje: 'Debe ser sí o no' })
          return null
        }
        return v
      }

      const habitos = {
        tiemposPorDia: opcion('tiemposPorDia', TIEMPOS_POR_DIA),
        tiemposRealizados: varias('tiemposRealizados', TIEMPOS_COMIDA),
        lugarComidas: opcion('lugarComidas', LUGARES),
        quienPrepara: texto('quienPrepara', 200),
        apetito: opcion('apetito', APETITOS),
        grasasCocinar: texto('grasasCocinar', 300),
        tiposCoccion: varias('tiposCoccion', COCCIONES),
        agregaSal: siNo('agregaSal'),
        consumeAzucar: siNo('consumeAzucar'),
        usaEdulcorante: siNo('usaEdulcorante'),
        dietasRealizadas: texto('dietasRealizadas', 1000),
        consumeAgua: siNo('consumeAgua'),
        cantidadAgua: texto('cantidadAgua', 100),
        alimentosNoConsume: texto('alimentosNoConsume', 2000),
        alimentosPreferidos: texto('alimentosPreferidos', 2000),
      }

      if (errores.length > 0) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa la evaluación dietética', errores })
      }

      const json = (v: unknown, porDefecto: string) =>
        v === undefined ? porDefecto : JSON.stringify(v)
      const notas =
        typeof c['notasDieteticas'] === 'string' && c['notasDieteticas'].trim() !== ''
          ? c['notasDieteticas'].trim()
          : null

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        const { rows } = await cliente.query(
          `insert into evaluacion_dietetica (
             clinica_id, paciente_id, consulta_id, profesional_id,
             recordatorio_24h, frecuencia_consumo, hidratacion_litros,
             kcal_estimadas, proteina_g, cho_g, grasa_g, fibra_g, notas_dieteticas,
             tiempos_por_dia, tiempos_realizados, lugar_comidas, quien_prepara,
             apetito, grasas_cocinar, tipos_coccion, agrega_sal, consume_azucar,
             usa_edulcorante, dietas_realizadas, consume_agua, cantidad_agua,
             alimentos_no_consume, alimentos_preferidos
           ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,
                     $14,$15::text[],$16,$17,$18,$19,$20::text[],$21,$22,$23,$24,$25,$26,$27,$28)
           on conflict (clinica_id, paciente_id) do update set
             consulta_id = coalesce(excluded.consulta_id, evaluacion_dietetica.consulta_id),
             profesional_id = excluded.profesional_id,
             recordatorio_24h = excluded.recordatorio_24h,
             frecuencia_consumo = excluded.frecuencia_consumo,
             hidratacion_litros = excluded.hidratacion_litros,
             kcal_estimadas = excluded.kcal_estimadas,
             proteina_g = excluded.proteina_g, cho_g = excluded.cho_g,
             grasa_g = excluded.grasa_g, fibra_g = excluded.fibra_g,
             notas_dieteticas = excluded.notas_dieteticas,
             tiempos_por_dia = excluded.tiempos_por_dia,
             tiempos_realizados = excluded.tiempos_realizados,
             lugar_comidas = excluded.lugar_comidas,
             quien_prepara = excluded.quien_prepara,
             apetito = excluded.apetito,
             grasas_cocinar = excluded.grasas_cocinar,
             tipos_coccion = excluded.tipos_coccion,
             agrega_sal = excluded.agrega_sal,
             consume_azucar = excluded.consume_azucar,
             usa_edulcorante = excluded.usa_edulcorante,
             dietas_realizadas = excluded.dietas_realizadas,
             consume_agua = excluded.consume_agua,
             cantidad_agua = excluded.cantidad_agua,
             alimentos_no_consume = excluded.alimentos_no_consume,
             alimentos_preferidos = excluded.alimentos_preferidos
           returning ${CAMPOS}`,
          [
            tenantId, id, consultaId, alcance.profesionalId,
            json(c['recordatorio24h'], '[]'), json(c['frecuenciaConsumo'], '{}'),
            valores.hidratacion, valores.kcal, valores.proteina, valores.cho,
            valores.grasa, valores.fibra, notas,
            habitos.tiemposPorDia, habitos.tiemposRealizados, habitos.lugarComidas,
            habitos.quienPrepara, habitos.apetito, habitos.grasasCocinar,
            habitos.tiposCoccion, habitos.agregaSal, habitos.consumeAzucar,
            habitos.usaEdulcorante, habitos.dietasRealizadas, habitos.consumeAgua,
            habitos.cantidadAgua, habitos.alimentosNoConsume, habitos.alimentosPreferidos,
          ],
        )

        if (consultaId) {
          await cliente.query(
            `update consulta
                set secciones_completas = jsonb_set(secciones_completas, '{dietetico}', 'true', true)
              where id = $1 and clinica_id = $2 and paciente_id = $3 and estado = 'borrador'`,
            [consultaId, tenantId, id],
          )
        }

        await cliente.query('commit')
        return reply.send(aEvaluacion(rows[0] as Record<string, unknown>))
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }
    },
  )
}
