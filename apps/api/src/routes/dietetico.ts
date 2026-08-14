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
  kcal_estimadas, proteina_g, cho_g, grasa_g, fibra_g, notas_dieteticas, updated_at
`

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
             kcal_estimadas, proteina_g, cho_g, grasa_g, fibra_g, notas_dieteticas
           ) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)
           on conflict (clinica_id, paciente_id) do update set
             consulta_id = coalesce(excluded.consulta_id, evaluacion_dietetica.consulta_id),
             profesional_id = excluded.profesional_id,
             recordatorio_24h = excluded.recordatorio_24h,
             frecuencia_consumo = excluded.frecuencia_consumo,
             hidratacion_litros = excluded.hidratacion_litros,
             kcal_estimadas = excluded.kcal_estimadas,
             proteina_g = excluded.proteina_g, cho_g = excluded.cho_g,
             grasa_g = excluded.grasa_g, fibra_g = excluded.fibra_g,
             notas_dieteticas = excluded.notas_dieteticas
           returning ${CAMPOS}`,
          [
            tenantId, id, consultaId, alcance.profesionalId,
            json(c['recordatorio24h'], '[]'), json(c['frecuenciaConsumo'], '{}'),
            valores.hidratacion, valores.kcal, valores.proteina, valores.cho,
            valores.grasa, valores.fibra, notas,
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
