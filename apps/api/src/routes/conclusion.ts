/**
 * Conclusiones de la valoración — EVAL-05.
 *
 * Es el juicio del día: diagnóstico, recomendaciones, prescripción y
 * acuerdos. Pertenece a la CONSULTA, no al paciente — la siguiente
 * emite el suyo y ambos quedan.
 *
 * Los gramos de cada macro los deriva el servidor de las kilocalorías y
 * los porcentajes. Aceptarlos del cliente permitiría guardar unos
 * gramos que no corresponden con el reparto declarado en su propia
 * fila, y la prescripción diría dos cosas a la vez.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'

const RESTRICCIONES = [
  'sin_gluten',
  'sin_lactosa',
  'bajo_sodio',
  'bajo_grasa',
  'diabetica',
  'vegetariana',
  'vegana',
  'renal',
] as const

/** Kilocalorías por gramo. Atwater, redondeado como en la práctica. */
const KCAL_G = { proteina: 4, cho: 4, grasa: 9 }

const CAMPOS = `
  id, consulta_id, diagnostico_principal, diagnostico_cie10, diagnostico_secundario,
  observaciones_clinicas, recomendaciones, kcal_prescritas,
  pct_proteina, pct_cho, pct_grasa, proteina_g, cho_g, grasa_g,
  restricciones, suplementos, acuerdos, updated_at
`

function sinProfesional() {
  return {
    error: 'profesional_no_encontrado',
    message: 'Tu usuario no tiene un profesional asociado en esta clínica',
  }
}
function noEncontradaConsulta() {
  return { error: 'consulta_no_encontrada', message: 'No se encontró la consulta' }
}

function aConclusion(f: Record<string, unknown>) {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return {
    id: f['id'] as string,
    consultaId: f['consulta_id'] as string,
    diagnosticoPrincipal: (f['diagnostico_principal'] as string | null) ?? null,
    diagnosticoCie10: (f['diagnostico_cie10'] as string | null) ?? null,
    diagnosticoSecundario: (f['diagnostico_secundario'] as string | null) ?? null,
    observacionesClinicas: (f['observaciones_clinicas'] as string | null) ?? null,
    recomendaciones: (f['recomendaciones'] ?? []) as string[],
    kcalPrescritas: num(f['kcal_prescritas']),
    pctProteina: num(f['pct_proteina']),
    pctCho: num(f['pct_cho']),
    pctGrasa: num(f['pct_grasa']),
    proteinaG: num(f['proteina_g']),
    choG: num(f['cho_g']),
    grasaG: num(f['grasa_g']),
    restricciones: (f['restricciones'] ?? []) as string[],
    suplementos: (f['suplementos'] as string | null) ?? null,
    acuerdos: (f['acuerdos'] ?? []) as { texto: string; cumplido: boolean }[],
    updatedAt: f['updated_at'] as Date,
  }
}

export async function registerConclusionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * La consulta, si es visible para quien pregunta.
   *
   * Se acota por clínica y alcance, NO por autoría: exigir que quien
   * escribe sea el mismo que abrió la consulta impediría que un
   * compañero cubra una baja, que es justo cuando más falta hace.
   */
  async function cargarConsulta(
    consultaId: string,
    pacienteId: string,
    tenantId: string,
    restringirA: string | null,
  ) {
    if (!esUuid(consultaId) || !esUuid(pacienteId)) return null
    const { rows } = await pool.query<{ id: string; estado: string }>(
      `select c.id, c.estado::text as estado
         from consulta c
         join paciente p on p.id = c.paciente_id
        where c.id = $1 and c.paciente_id = $2 and c.clinica_id = $3
          and ($4::uuid is null or p.nutricionista_id = $4)`,
      [consultaId, pacienteId, tenantId, restringirA],
    )
    return rows[0] ?? null
  }

  /* ---------------------------------------------------------------- */
  /* GET  …/consultas/:consultaId/conclusion                           */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/consultas/:consultaId/conclusion',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const consulta = await cargarConsulta(
        request.params.consultaId,
        request.params.id,
        tenantId,
        alcance.restringirA,
      )
      if (!consulta) return reply.code(404).send(noEncontradaConsulta())

      const { rows } = await pool.query(
        `select ${CAMPOS} from conclusion_valoracion where consulta_id = $1`,
        [consulta.id],
      )
      if (!rows[0]) {
        return reply
          .code(404)
          .send({ error: 'sin_conclusion', message: 'Esta consulta aún no tiene conclusión' })
      }
      return reply.send(aConclusion(rows[0] as Record<string, unknown>))
    },
  )

  /* ---------------------------------------------------------------- */
  /* PUT  …/consultas/:consultaId/conclusion                           */
  /* ---------------------------------------------------------------- */
  app.put<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/consultas/:consultaId/conclusion',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const consulta = await cargarConsulta(
        request.params.consultaId,
        request.params.id,
        tenantId,
        alcance.restringirA,
      )
      if (!consulta) return reply.code(404).send(noEncontradaConsulta())

      if (consulta.estado === 'finalizada') {
        return reply.code(409).send({
          error: 'consulta_finalizada',
          message: 'Una consulta finalizada no se edita: es el registro de lo que se valoró',
        })
      }

      const c = (request.body ?? {}) as Record<string, unknown>
      const errores: ErrorCampo[] = []

      function porcentaje(campo: string): number | null {
        const v = c[campo]
        if (v === undefined || v === null || v === '') return null
        const n = Number(v)
        if (!Number.isInteger(n) || n < 0 || n > 100) {
          errores.push({ campo, mensaje: 'Debe ser un entero entre 0 y 100' })
          return null
        }
        return n
      }

      const kcal = (() => {
        const v = c['kcalPrescritas']
        if (v === undefined || v === null || v === '') return null
        const n = Number(v)
        if (!Number.isInteger(n) || n <= 0 || n > 20000) {
          errores.push({ campo: 'kcalPrescritas', mensaje: 'Debe ser un entero mayor que 0' })
          return null
        }
        return n
      })()

      const pctProteina = porcentaje('pctProteina')
      const pctCho = porcentaje('pctCho')
      const pctGrasa = porcentaje('pctGrasa')

      // Los tres o ninguno, y sumando 100. La base lo repite con un
      // CHECK; aquí se comprueba para dar un mensaje que se entienda.
      const declarados = [pctProteina, pctCho, pctGrasa].filter((v) => v !== null).length
      if (declarados > 0 && declarados < 3) {
        errores.push({
          campo: 'macros',
          mensaje: 'Indica los tres porcentajes o ninguno',
        })
      } else if (declarados === 3 && (pctProteina ?? 0) + (pctCho ?? 0) + (pctGrasa ?? 0) !== 100) {
        errores.push({
          campo: 'macros',
          mensaje: `Los porcentajes deben sumar 100 (ahora suman ${(pctProteina ?? 0) + (pctCho ?? 0) + (pctGrasa ?? 0)})`,
        })
      }

      const restricciones = Array.isArray(c['restricciones'])
        ? (c['restricciones'] as unknown[]).filter(
            (r): r is string =>
              typeof r === 'string' && RESTRICCIONES.includes(r as (typeof RESTRICCIONES)[number]),
          )
        : undefined

      // Los acuerdos se normalizan: lo que se guarda tiene la forma que
      // la interfaz espera leer.
      const acuerdos = Array.isArray(c['acuerdos'])
        ? (c['acuerdos'] as unknown[])
            .map((a) => {
              const o = (a ?? {}) as Record<string, unknown>
              const texto = typeof o['texto'] === 'string' ? o['texto'].trim() : ''
              return texto === '' ? null : { texto, cumplido: o['cumplido'] === true }
            })
            .filter((a): a is { texto: string; cumplido: boolean } => a !== null)
        : undefined

      const recomendaciones = Array.isArray(c['recomendaciones'])
        ? (c['recomendaciones'] as unknown[])
            .filter((r): r is string => typeof r === 'string' && r.trim() !== '')
            .map((r) => r.trim())
        : undefined

      if (errores.length > 0) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa la conclusión', errores })
      }

      // Los gramos se derivan aquí, nunca se reciben.
      const gramos =
        kcal !== null && pctProteina !== null && pctCho !== null && pctGrasa !== null
          ? {
              proteina: Math.round(((kcal * pctProteina) / 100 / KCAL_G.proteina) * 10) / 10,
              cho: Math.round(((kcal * pctCho) / 100 / KCAL_G.cho) * 10) / 10,
              grasa: Math.round(((kcal * pctGrasa) / 100 / KCAL_G.grasa) * 10) / 10,
            }
          : { proteina: null, cho: null, grasa: null }

      const texto = (campo: string) =>
        typeof c[campo] === 'string' && (c[campo] as string).trim() !== ''
          ? (c[campo] as string).trim()
          : null

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        const { rows } = await cliente.query(
          `insert into conclusion_valoracion (
             clinica_id, paciente_id, consulta_id, profesional_id,
             diagnostico_principal, diagnostico_cie10, diagnostico_secundario,
             observaciones_clinicas, recomendaciones,
             kcal_prescritas, pct_proteina, pct_cho, pct_grasa,
             proteina_g, cho_g, grasa_g, restricciones, suplementos, acuerdos
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::jsonb
           )
           on conflict (consulta_id) do update set
             profesional_id = excluded.profesional_id,
             diagnostico_principal = excluded.diagnostico_principal,
             diagnostico_cie10 = excluded.diagnostico_cie10,
             diagnostico_secundario = excluded.diagnostico_secundario,
             observaciones_clinicas = excluded.observaciones_clinicas,
             recomendaciones = excluded.recomendaciones,
             kcal_prescritas = excluded.kcal_prescritas,
             pct_proteina = excluded.pct_proteina, pct_cho = excluded.pct_cho,
             pct_grasa = excluded.pct_grasa,
             proteina_g = excluded.proteina_g, cho_g = excluded.cho_g,
             grasa_g = excluded.grasa_g,
             restricciones = excluded.restricciones,
             suplementos = excluded.suplementos,
             acuerdos = excluded.acuerdos
           returning ${CAMPOS}`,
          [
            tenantId, request.params.id, consulta.id, alcance.profesionalId,
            texto('diagnosticoPrincipal'), texto('diagnosticoCie10'), texto('diagnosticoSecundario'),
            texto('observacionesClinicas'), JSON.stringify(recomendaciones ?? []),
            kcal, pctProteina, pctCho, pctGrasa,
            gramos.proteina, gramos.cho, gramos.grasa,
            JSON.stringify(restricciones ?? []), texto('suplementos'),
            JSON.stringify(acuerdos ?? []),
          ],
        )

        // Escribir la conclusión ES completar su sección, igual que en
        // antropometría, historial y dietético.
        await cliente.query(
          `update consulta
              set secciones_completas = jsonb_set(secciones_completas, '{conclusion}', 'true', true)
            where id = $1`,
          [consulta.id],
        )

        await cliente.query('commit')
        return reply.send(aConclusion(rows[0] as Record<string, unknown>))
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }
    },
  )
}
