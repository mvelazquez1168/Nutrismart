/**
 * Mediciones antropométricas — EVAL-01.
 *
 * IMC e ICC NO se reciben ni se calculan aquí: son columnas generadas
 * por la base a partir del peso, la talla y los perímetros de su propia
 * fila. Un índice que llegara desde fuera podría no corresponder con
 * esos valores, y el expediente contendría dos verdades.
 *
 * Lo que sí se deriva en la API es el porcentaje de grasa, y solo
 * cuando no viene: es una estimación con varios métodos posibles, no
 * una identidad aritmética.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuth } from '../auth.js'
import { esUuid, type ErrorCampo } from '../pacientes/validacion.js'
import { resolverAlcance } from '../pacientes/acceso.js'
import { pacienteVisible } from './consultas.js'

const METODOS = ['bia', 'pliegues'] as const

const CAMPOS = `
  id, to_char(fecha_medicion, 'YYYY-MM-DD') as fecha_medicion, consulta_id,
  peso_kg, talla_cm, imc, cintura_cm, cadera_cm, icc, brazo_cm, pierna_cm,
  metodo::text as metodo, masa_libre_grasa_kg, masa_muscular_kg, pct_grasa,
  masa_grasa_kg, agua_corporal_pct, angulo_fase, pliegues_datos, pliegues_formula,
  created_at
`

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function aMedicion(f: Record<string, unknown>) {
  return {
    id: f['id'] as string,
    fechaMedicion: f['fecha_medicion'] as string,
    consultaId: (f['consulta_id'] as string | null) ?? null,
    pesoKg: num(f['peso_kg']),
    tallaCm: num(f['talla_cm']),
    imc: num(f['imc']),
    cinturaCm: num(f['cintura_cm']),
    caderaCm: num(f['cadera_cm']),
    icc: num(f['icc']),
    brazoCm: num(f['brazo_cm']),
    piernaCm: num(f['pierna_cm']),
    metodo: (f['metodo'] as string | null) ?? null,
    masaLibreGrasaKg: num(f['masa_libre_grasa_kg']),
    masaMuscularKg: num(f['masa_muscular_kg']),
    pctGrasa: num(f['pct_grasa']),
    masaGrasaKg: num(f['masa_grasa_kg']),
    aguaCorporalPct: num(f['agua_corporal_pct']),
    anguloFase: num(f['angulo_fase']),
    plieguesDatos: (f['pliegues_datos'] ?? null) as unknown,
    plieguesFormula: (f['pliegues_formula'] as string | null) ?? null,
    createdAt: f['created_at'] as Date,
  }
}

interface Entrada {
  consultaId: string | null
  fechaMedicion: string | null
  pesoKg: number | null
  tallaCm: number | null
  cinturaCm: number | null
  caderaCm: number | null
  brazoCm: number | null
  piernaCm: number | null
  metodo: string | null
  masaLibreGrasaKg: number | null
  masaMuscularKg: number | null
  pctGrasa: number | null
  masaGrasaKg: number | null
  aguaCorporalPct: number | null
  anguloFase: number | null
  plieguesDatos: unknown
  plieguesFormula: string | null
}

function validar(cuerpo: unknown): { ok: true; datos: Entrada } | { ok: false; errores: ErrorCampo[] } {
  const c = (cuerpo ?? {}) as Record<string, unknown>
  const errores: ErrorCampo[] = []

  function medida(campo: string, min: number, max: number): number | null {
    const v = c[campo]
    if (v === undefined || v === null || v === '') return null
    const n = Number(v)
    if (!Number.isFinite(n) || n <= min || n >= max) {
      errores.push({ campo, mensaje: `Debe ser un número entre ${min} y ${max}` })
      return null
    }
    return n
  }

  function porcentaje(campo: string): number | null {
    const v = c[campo]
    if (v === undefined || v === null || v === '') return null
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      errores.push({ campo, mensaje: 'Debe ser un porcentaje entre 0 y 100' })
      return null
    }
    return n
  }

  const metodo = c['metodo']
  if (metodo !== undefined && metodo !== null && metodo !== '') {
    if (typeof metodo !== 'string' || !METODOS.includes(metodo as (typeof METODOS)[number])) {
      errores.push({ campo: 'metodo', mensaje: `Debe ser uno de: ${METODOS.join(', ')}` })
    }
  }

  const consultaId = typeof c['consultaId'] === 'string' ? c['consultaId'] : null
  if (consultaId !== null && !esUuid(consultaId)) {
    errores.push({ campo: 'consultaId', mensaje: 'No es un identificador válido' })
  }

  const fecha = typeof c['fechaMedicion'] === 'string' ? c['fechaMedicion'] : null
  if (fecha !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    errores.push({ campo: 'fechaMedicion', mensaje: 'Debe tener el formato AAAA-MM-DD' })
  }

  const datos: Entrada = {
    consultaId,
    fechaMedicion: fecha,
    pesoKg: medida('pesoKg', 0, 500),
    tallaCm: medida('tallaCm', 30, 260),
    cinturaCm: medida('cinturaCm', 0, 250),
    caderaCm: medida('caderaCm', 0, 250),
    brazoCm: medida('brazoCm', 0, 100),
    piernaCm: medida('piernaCm', 0, 150),
    metodo: typeof metodo === 'string' && metodo !== '' ? metodo : null,
    masaLibreGrasaKg: medida('masaLibreGrasaKg', -1, 500),
    masaMuscularKg: medida('masaMuscularKg', -1, 500),
    pctGrasa: porcentaje('pctGrasa'),
    masaGrasaKg: medida('masaGrasaKg', -1, 500),
    aguaCorporalPct: porcentaje('aguaCorporalPct'),
    anguloFase: medida('anguloFase', 0, 20),
    plieguesDatos: c['plieguesDatos'] ?? null,
    plieguesFormula: typeof c['plieguesFormula'] === 'string' ? c['plieguesFormula'] : null,
  }

  // Una medición sin ninguna medida no es una medición.
  const hayAlgo = [
    datos.pesoKg, datos.tallaCm, datos.cinturaCm, datos.caderaCm, datos.brazoCm,
    datos.piernaCm, datos.masaLibreGrasaKg, datos.pctGrasa,
  ].some((v) => v !== null)
  if (!hayAlgo && datos.plieguesDatos === null) {
    errores.push({ campo: 'medicion', mensaje: 'Registra al menos una medida' })
  }

  if (errores.length > 0) return { ok: false, errores }
  return { ok: true, datos }
}

/**
 * Completa lo que se deduce sin ambigüedad de lo demás.
 *
 * Solo cuando el valor NO viene: si el aparato de bioimpedancia dio un
 * porcentaje, ese manda sobre cualquier cuenta nuestra.
 */
function derivar(d: Entrada): Entrada {
  const salida = { ...d }

  if (salida.pesoKg !== null && salida.masaLibreGrasaKg !== null) {
    const grasaKg = salida.pesoKg - salida.masaLibreGrasaKg
    if (grasaKg >= 0) {
      salida.masaGrasaKg ??= Math.round(grasaKg * 100) / 100
      salida.pctGrasa ??= Math.round((grasaKg / salida.pesoKg) * 10000) / 100
    }
  }

  // El camino inverso: con el porcentaje y el peso salen los kilos.
  if (salida.pesoKg !== null && salida.pctGrasa !== null) {
    const grasaKg = (salida.pctGrasa / 100) * salida.pesoKg
    salida.masaGrasaKg ??= Math.round(grasaKg * 100) / 100
    salida.masaLibreGrasaKg ??= Math.round((salida.pesoKg - grasaKg) * 100) / 100
  }

  return salida
}

export async function registerAntropometriaRoutes(app: FastifyInstance): Promise<void> {
  function sinProfesional() {
    return {
      error: 'profesional_no_encontrado',
      message: 'Tu usuario no tiene un profesional asociado en esta clínica',
    }
  }
  function noEncontradoPaciente() {
    return { error: 'paciente_no_encontrado', message: 'No se encontró el paciente' }
  }

  /* ---------------------------------------------------------------- */
  /* POST /api/pacientes/:id/antropometria                             */
  /* ---------------------------------------------------------------- */
  app.post<{ Params: { id: string } }>(
    '/api/pacientes/:id/antropometria',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const v = validar(request.body)
      if (!v.ok) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Revisa las medidas', errores: v.errores })
      }
      const d = derivar(v.datos)

      // La consulta, si viene, tiene que ser de ESTE paciente y no estar
      // finalizada: añadir mediciones a una valoración cerrada cambiaría
      // lo que ya se dio por bueno.
      if (d.consultaId) {
        const { rows } = await pool.query<{ estado: string }>(
          `select estado::text as estado from consulta
            where id = $1 and paciente_id = $2 and clinica_id = $3`,
          [d.consultaId, id, tenantId],
        )
        if (!rows[0]) {
          return reply.code(400).send({
            error: 'consulta_invalida',
            message: 'La consulta indicada no pertenece a este paciente',
          })
        }
        if (rows[0].estado === 'finalizada') {
          return reply.code(409).send({
            error: 'consulta_finalizada',
            message: 'No se pueden registrar medidas en una consulta finalizada',
          })
        }
      }

      const cliente = await pool.connect()
      try {
        await cliente.query('begin')

        /*
         * Una medición por consulta: si ya hay una, se reemplaza.
         *
         * El profesional que corrige el peso espera corregirlo, no
         * añadir una segunda medición del mismo día que compita con la
         * primera en el histórico.
         */
        const { rows } = await cliente.query(
          `insert into medicion_antropometrica (
             clinica_id, paciente_id, consulta_id, profesional_id, fecha_medicion,
             peso_kg, talla_cm, cintura_cm, cadera_cm, brazo_cm, pierna_cm,
             metodo, masa_libre_grasa_kg, masa_muscular_kg, pct_grasa, masa_grasa_kg,
             agua_corporal_pct, angulo_fase, pliegues_datos, pliegues_formula
           ) values (
             $1,$2,$3,$4, coalesce($5::date, current_date),
             $6,$7,$8,$9,$10,$11,
             $12::metodo_composicion,$13,$14,$15,$16,$17,$18,$19::jsonb,$20
           )
           on conflict (consulta_id) where consulta_id is not null
           do update set
             fecha_medicion = excluded.fecha_medicion,
             peso_kg = excluded.peso_kg, talla_cm = excluded.talla_cm,
             cintura_cm = excluded.cintura_cm, cadera_cm = excluded.cadera_cm,
             brazo_cm = excluded.brazo_cm, pierna_cm = excluded.pierna_cm,
             metodo = excluded.metodo,
             masa_libre_grasa_kg = excluded.masa_libre_grasa_kg,
             masa_muscular_kg = excluded.masa_muscular_kg,
             pct_grasa = excluded.pct_grasa, masa_grasa_kg = excluded.masa_grasa_kg,
             agua_corporal_pct = excluded.agua_corporal_pct,
             angulo_fase = excluded.angulo_fase,
             pliegues_datos = excluded.pliegues_datos,
             pliegues_formula = excluded.pliegues_formula
           returning ${CAMPOS}`,
          [
            tenantId, id, d.consultaId, alcance.profesionalId, d.fechaMedicion,
            d.pesoKg, d.tallaCm, d.cinturaCm, d.caderaCm, d.brazoCm, d.piernaCm,
            d.metodo, d.masaLibreGrasaKg, d.masaMuscularKg, d.pctGrasa, d.masaGrasaKg,
            d.aguaCorporalPct, d.anguloFase,
            d.plieguesDatos === null ? null : JSON.stringify(d.plieguesDatos),
            d.plieguesFormula,
          ],
        )

        // Guardar la antropometría ES completar su sección: obligar a
        // marcarla aparte solo produce valoraciones que parecen a medias.
        if (d.consultaId) {
          await cliente.query(
            `update consulta
                set secciones_completas = jsonb_set(secciones_completas, '{antrop}', 'true', true)
              where id = $1`,
            [d.consultaId],
          )
        }

        await cliente.query('commit')
        return reply.code(201).send(aMedicion(rows[0] as Record<string, unknown>))
      } catch (error) {
        await cliente.query('rollback')
        throw error
      } finally {
        cliente.release()
      }
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/antropometria                              */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string }; Querystring: { limite?: string } }>(
    '/api/pacientes/:id/antropometria',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id } = request.params
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const pedido = Number(request.query.limite)
      const limite = Number.isInteger(pedido) && pedido > 0 ? Math.min(pedido, 50) : 10

      const { rows } = await pool.query(
        `select ${CAMPOS} from medicion_antropometrica
          where clinica_id = $1 and paciente_id = $2
          order by fecha_medicion desc, created_at desc
          limit $3`,
        [tenantId, id, limite],
      )
      return reply.send(rows.map(aMedicion))
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/antropometria/ultima                       */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string } }>(
    '/api/pacientes/:id/antropometria/ultima',
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
        `select ${CAMPOS} from medicion_antropometrica
          where clinica_id = $1 and paciente_id = $2
          order by fecha_medicion desc, created_at desc limit 1`,
        [tenantId, id],
      )
      if (!rows[0]) {
        return reply.code(404).send({
          error: 'sin_mediciones',
          message: 'Este paciente no tiene mediciones registradas',
        })
      }
      return reply.send(aMedicion(rows[0] as Record<string, unknown>))
    },
  )

  /* ---------------------------------------------------------------- */
  /* GET /api/pacientes/:id/antropometria/consulta/:consultaId         */
  /* ---------------------------------------------------------------- */
  app.get<{ Params: { id: string; consultaId: string } }>(
    '/api/pacientes/:id/antropometria/consulta/:consultaId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { tenantId, sub, roles } = request.auth
      const alcance = await resolverAlcance(tenantId, sub, roles)
      if (!alcance) return reply.code(403).send(sinProfesional())

      const { id, consultaId } = request.params
      if (!esUuid(consultaId)) {
        return reply.code(404).send({ error: 'sin_medicion', message: 'No hay medición' })
      }
      if (!(await pacienteVisible(id, tenantId, alcance.restringirA))) {
        return reply.code(404).send(noEncontradoPaciente())
      }

      const { rows } = await pool.query(
        `select ${CAMPOS} from medicion_antropometrica
          where clinica_id = $1 and paciente_id = $2 and consulta_id = $3`,
        [tenantId, id, consultaId],
      )
      if (!rows[0]) {
        return reply.code(404).send({
          error: 'sin_medicion',
          message: 'Esta consulta aún no tiene medición',
        })
      }
      return reply.send(aMedicion(rows[0] as Record<string, unknown>))
    },
  )
}
