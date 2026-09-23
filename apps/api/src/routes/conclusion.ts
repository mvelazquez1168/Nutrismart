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

/**
 * Restricciones que el servidor ACEPTA.
 *
 * Ojo: es mas larga que la que ofrece la pantalla. 'diabetica' y 'renal'
 * dejaron de ofrecerse en la R37, pero se siguen aceptando aqui a
 * proposito.
 *
 * El motivo esta tres lineas mas abajo, en la validacion: los valores
 * que no estan en esta lista se DESCARTAN en silencio. Si se quitaran,
 * abrir una conclusion antigua marcada como 'renal' y volver a
 * guardarla —cambiando cualquier otra cosa— borraria esa restriccion sin
 * decirlo. Eso es perder informacion clinica por un cambio de menu, y
 * va contra la trazabilidad del proyecto.
 *
 * La pantalla ya no las ofrece; quien las tenga, las conserva.
 */
const RESTRICCIONES = [
  'sin_gluten',
  'sin_lactosa',
  'bajo_sodio',
  'bajo_grasa',
  'vegetariana',
  'vegana',
  // ---- Densidad calorica ----
  'hipocalorica',
  'normocalorica',
  'hipercalorica',
  // ---- Fibra ----
  'alta_fibra',
  'fibra_soluble',
  'fibra_insoluble',
  // ---- Proteina ----
  'hiperproteica',
  'hipoproteica',
  'normoproteica',
  // ---- Retiradas del menu, aun validas si ya estaban guardadas ----
  'diabetica',
  'renal',
] as const

/** Kilocalorías por gramo. Atwater, redondeado como en la práctica. */
const KCAL_G = { proteina: 4, cho: 4, grasa: 9 }

const CAMPOS = `
  id, consulta_id, diagnostico_principal, diagnostico_cie10, diagnostico_secundario,
  observaciones_clinicas, objetivos, recomendaciones, kcal_prescritas,
  pct_proteina, pct_cho, pct_grasa, proteina_g, cho_g, grasa_g,
  restricciones, suplementos, acuerdos,
  peso_objetivo, to_char(fecha_objetivo_peso,'YYYY-MM-DD') as fecha_objetivo_peso,
  datos_calculadora,
  updated_at
`

/**
 * Sanea el bloque de la calculadora (R39). Es un documento cerrado que
 * el cliente arma; aquí se acepta con forma conocida y se descarta lo
 * demás, para no guardar basura en el jsonb.
 */
function sanearDatosCalculadora(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const meta = Number(o['metaCalorica'])
  const metodo = o['metodoDieta']
  if (!Number.isFinite(meta) || (metodo !== 'ADA' && metodo !== 'INCIENSA' && metodo !== 'Colombiana')) {
    return null
  }
  const n = (x: unknown) => {
    const k = Number(x)
    return Number.isFinite(k) ? k : 0
  }
  const dm = (o['distribucionMacros'] ?? {}) as Record<string, unknown>
  const lineasRaw = Array.isArray(o['listasIntercambio']) ? o['listasIntercambio'] : []
  const listasIntercambio = lineasRaw
    .map((l) => {
      const lo = (l ?? {}) as Record<string, unknown>
      const grupo = typeof lo['grupo'] === 'string' ? lo['grupo'].trim() : ''
      const porciones = Number(lo['porciones'])
      return grupo !== '' && Number.isFinite(porciones) && porciones > 0 ? { grupo, porciones } : null
    })
    .filter((x): x is { grupo: string; porciones: number } => x !== null)

  /* ---- Cunningham y gasto por ejercicio (R42) ----
   *
   * Opcionales: un bloque guardado antes de la R42 no los trae y tiene
   * que seguir siendo válido. Se copian solo si vienen bien formados —
   * esto es una lista blanca, y lo que no se nombra aquí no se guarda.
   */
  const METODOS_GER = ['schofield', 'mifflin', 'fao_oms', 'harris', 'cunningham']
  const metodoGer = typeof o['metodoGer'] === 'string' && METODOS_GER.includes(o['metodoGer'])
    ? (o['metodoGer'] as string)
    : null

  /** Número finito y no negativo, o null. Distinto de `n`, que cae a 0. */
  const opcional = (x: unknown): number | null => {
    if (x === null || x === undefined || x === '') return null
    const k = Number(x)
    return Number.isFinite(k) && k >= 0 ? k : null
  }

  interface EntradaGeeGuardada {
    id: string
    actividad: string
    mets: number
    kg: number
    minutos: number
    gee: number
  }

  const geeRaw = Array.isArray(o['geeEntradas']) ? o['geeEntradas'] : []
  const geeEntradas = geeRaw
    .map((e): EntradaGeeGuardada | null => {
      const eo = (e ?? {}) as Record<string, unknown>
      const actividad =
        typeof eo['actividad'] === 'string' ? eo['actividad'].trim().slice(0, 120) : ''
      const mets = opcional(eo['mets'])
      const kg = opcional(eo['kg'])
      const minutos = opcional(eo['minutos'])
      if (actividad === '' || mets === null || kg === null || minutos === null) return null
      return {
        id: typeof eo['id'] === 'string' ? eo['id'].slice(0, 64) : '',
        actividad,
        mets,
        kg,
        minutos,
        // El `gee` que manda el cliente se ignora y se recalcula con la
        // misma fórmula: así lo guardado cuadra siempre con sus propios
        // factores, y un total inventado no entra en el expediente.
        gee: Math.round(0.0175 * kg * minutos * mets * 10) / 10,
      }
    })
    .filter((x): x is EntradaGeeGuardada => x !== null)

  return {
    metaCalorica: Math.round(meta),
    metodoDieta: metodo,
    distribucionMacros: {
      choPct: n(dm['choPct']),
      protPct: n(dm['protPct']),
      grasaPct: n(dm['grasaPct']),
      choG: n(dm['choG']),
      protG: n(dm['protG']),
      grasaG: n(dm['grasaG']),
      choGkg: n(dm['choGkg']),
      protGkg: n(dm['protGkg']),
      grasaGkg: n(dm['grasaGkg']),
    },
    listasIntercambio,
    ...(metodoGer !== null ? { metodoGer } : {}),
    mlgKg: opcional(o['mlgKg']),
    geeEntradas,
    geeTotal: opcional(o['geeTotal']),
    getCunningham: opcional(o['getCunningham']),
    disponibilidadEnergetica: opcional(o['disponibilidadEnergetica']),
  }
}

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
    objetivos: (f['objetivos'] as string | null) ?? null,
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
    // La meta ponderal: lo que hace computable el progreso del paciente
    // (ver la Rebanada 16, donde faltaba justo esto).
    pesoObjetivo: f['peso_objetivo'] === null ? null : Number(f['peso_objetivo']),
    fechaObjetivoPeso: (f['fecha_objetivo_peso'] as string | null) ?? null,
    acuerdos: (f['acuerdos'] ?? []) as { texto: string; cumplido: boolean }[],
    // Documento cerrado de la calculadora (R39); null si nunca se aplicó.
    datosCalculadora: (f['datos_calculadora'] as unknown) ?? null,
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

      // Meta de peso. Sin fecha se admite —hay objetivos sin plazo
      // cerrado— pero una fecha sin peso no dice nada y se descarta.
      const pesoBruto = c['pesoObjetivo']
      let pesoObjetivo: number | null = null
      if (pesoBruto !== undefined && pesoBruto !== null && pesoBruto !== '') {
        const n = Number(pesoBruto)
        if (!Number.isFinite(n) || n <= 20 || n >= 400) {
          return reply.code(400).send({
            error: 'validacion',
            message: 'La meta de peso debe estar entre 20 y 400 kg',
          })
        }
        pesoObjetivo = n
      }
      const fBruto = c['fechaObjetivoPeso']
      const fechaObjetivoPeso =
        pesoObjetivo !== null && typeof fBruto === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fBruto)
          ? fBruto
          : null

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

      const datosCalc = sanearDatosCalculadora(c['datosCalculadora'])

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        const { rows } = await cliente.query(
          `insert into conclusion_valoracion (
             clinica_id, paciente_id, consulta_id, profesional_id,
             diagnostico_principal, diagnostico_cie10, diagnostico_secundario,
             observaciones_clinicas, objetivos, recomendaciones,
             kcal_prescritas, pct_proteina, pct_cho, pct_grasa,
             proteina_g, cho_g, grasa_g, restricciones, suplementos, acuerdos,
             peso_objetivo, fecha_objetivo_peso, datos_calculadora
           ) values (
             $1,$2,$3,$4,$5,$6,$7,$8,$22,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19::jsonb,
             $20,$21::date,$23::jsonb
           )
           on conflict (consulta_id) do update set
             profesional_id = excluded.profesional_id,
             diagnostico_principal = excluded.diagnostico_principal,
             diagnostico_cie10 = excluded.diagnostico_cie10,
             diagnostico_secundario = excluded.diagnostico_secundario,
             observaciones_clinicas = excluded.observaciones_clinicas,
             objetivos = excluded.objetivos,
             recomendaciones = excluded.recomendaciones,
             kcal_prescritas = excluded.kcal_prescritas,
             pct_proteina = excluded.pct_proteina, pct_cho = excluded.pct_cho,
             pct_grasa = excluded.pct_grasa,
             proteina_g = excluded.proteina_g, cho_g = excluded.cho_g,
             grasa_g = excluded.grasa_g,
             restricciones = excluded.restricciones,
             suplementos = excluded.suplementos,
             acuerdos = excluded.acuerdos,
             peso_objetivo = excluded.peso_objetivo,
             fecha_objetivo_peso = excluded.fecha_objetivo_peso,
             datos_calculadora = excluded.datos_calculadora
           returning ${CAMPOS}`,
          [
            tenantId, request.params.id, consulta.id, alcance.profesionalId,
            texto('diagnosticoPrincipal'), texto('diagnosticoCie10'), texto('diagnosticoSecundario'),
            texto('observacionesClinicas'), JSON.stringify(recomendaciones ?? []),
            kcal, pctProteina, pctCho, pctGrasa,
            gramos.proteina, gramos.cho, gramos.grasa,
            JSON.stringify(restricciones ?? []), texto('suplementos'),
            JSON.stringify(acuerdos ?? []),
            pesoObjetivo, fechaObjetivoPeso,
            texto('objetivos'),
            datosCalc === null ? null : JSON.stringify(datosCalc),
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
