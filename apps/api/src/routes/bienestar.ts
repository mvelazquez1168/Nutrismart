/**
 * Lo que el paciente reporta cada día — RPM-01.
 *
 * Dos cosas distintas que comparten pantalla:
 *
 * El **parte de bienestar** es cómo se encuentra y qué síntomas tiene.
 * Es la mitad barata del seguimiento continuo y la que más dice: el peso
 * se mueve despacio y hace falta una báscula; «hoy dormí mal y me duele
 * la cabeza» se contesta en tres segundos y explica por qué la semana
 * que viene el peso no baja.
 *
 * Las **medidas corporales** son las de la cinta métrica en casa. No se
 * mezclan con `medicion_antropometrica`, que es lo que el profesional
 * mide en consulta con puntos anatómicos. Misma línea que la Rebanada 22
 * trazó con el peso.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuthPaciente } from '../auth.js'

/**
 * Catálogo cerrado de síntomas.
 *
 * Debe coincidir con el `CHECK` de la migración 029. Si fuese texto
 * libre, cada paciente escribiría «jaqueca», «dolor de cabeza» y «me
 * duele la cabeza», y el profesional no podría contar nada.
 */
const SINTOMAS = [
  'dolor_cabeza',
  'fatiga',
  'insomnio',
  'ansiedad',
  'estres',
  'hinchazon',
  'estrenimiento',
  'diarrea',
  'acidez',
  'nauseas',
  'antojos',
  'mareo',
  'dolor_muscular',
] as const

/** Las seis circunferencias, con su rango plausible en centímetros. */
const MEDIDAS = {
  cinturaCm: { col: 'cintura_cm', min: 20, max: 300 },
  caderaCm: { col: 'cadera_cm', min: 20, max: 300 },
  pechoCm: { col: 'pecho_cm', min: 20, max: 300 },
  brazoCm: { col: 'brazo_cm', min: 10, max: 100 },
  musloCm: { col: 'muslo_cm', min: 10, max: 150 },
  cuelloCm: { col: 'cuello_cm', min: 10, max: 100 },
} as const

type ClaveMedida = keyof typeof MEDIDAS

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/

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

/** Días hacia atrás, acotado. Un `NaN` no puede llegar a la consulta. */
function diasPedidos(v: unknown, porDefecto: number, tope: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 1) return porDefecto
  return Math.min(Math.floor(n), tope)
}

export async function registerBienestarRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* Parte de bienestar                                                */
  /* ================================================================ */

  app.get<{ Querystring: { dias?: string } }>(
    '/api/paciente/bienestar',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const dias = diasPedidos(request.query.dias, 30, 365)

      // Las fechas salen con `to_char` y no crudas del driver: `pg`
      // convierte una columna `date` a un Date de JavaScript a medianoche
      // LOCAL, y al serializarlo a JSON en UTC el día puede retroceder
      // uno. Un parte del martes que aparece como lunes es un fallo que
      // nadie ve hasta que alguien lo cuenta.
      const { rows } = await pool.query(
        `select to_char(fecha,'YYYY-MM-DD') as fecha, estado, sintomas, nota
           from registro_bienestar
          where paciente_id = $1 and clinica_id = $2 and activo = true
            and fecha >= (now() at time zone 'America/Costa_Rica')::date - make_interval(days => $3)
          order by fecha desc, id desc`,
        [pac.id, pac.clinica_id, dias],
      )

      const partes = rows.map((r) => ({
        fecha: r['fecha'] as string,
        estado: Number(r['estado']),
        sintomas: (r['sintomas'] ?? []) as string[],
        nota: r['nota'] as string | null,
      }))

      // La racha se cuenta desde HOY hacia atrás y se corta en el primer
      // día sin parte. Contar «días con parte en el último mes» daría un
      // número más bonito y no sería una racha.
      const conParte = new Set(partes.map((p) => p.fecha))
      const { rows: hoyRows } = await pool.query<{ hoy: string }>(
        `select (now() at time zone 'America/Costa_Rica')::date::text as hoy`,
      )
      const hoy = new Date(`${hoyRows[0]!.hoy}T12:00:00`)
      let racha = 0
      for (let i = 0; i < dias; i++) {
        const d = new Date(hoy)
        d.setDate(d.getDate() - i)
        const clave = d.toISOString().slice(0, 10)
        // El día de hoy todavía sin rellenar no rompe la racha: aún
        // puede rellenarlo. Los anteriores sí.
        if (conParte.has(clave)) racha++
        else if (i > 0) break
      }

      return reply.send({
        dias,
        hoy: hoyRows[0]!.hoy,
        partes,
        racha,
        sintomasPosibles: SINTOMAS,
      })
    },
  )

  app.put<{ Body: Record<string, unknown> }>(
    '/api/paciente/bienestar',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}

      const estado = Number(b['estado'])
      if (!Number.isInteger(estado) || estado < 1 || estado > 5) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Dime cómo te encuentras, del 1 al 5' })
      }

      const crudos = b['sintomas']
      if (crudos !== undefined && !Array.isArray(crudos)) {
        return reply.code(400).send({ error: 'validacion', message: 'Los síntomas no son válidos' })
      }
      const sintomas = [...new Set((crudos ?? []) as unknown[])]
      if (!sintomas.every((s) => typeof s === 'string' && (SINTOMAS as readonly string[]).includes(s))) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Hay algún síntoma que no reconocemos' })
      }

      const nota = typeof b['nota'] === 'string' ? b['nota'].trim() : ''
      if (nota.length > 500) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'La nota no puede pasar de 500 caracteres' })
      }

      const f = b['fecha']
      const fecha = typeof f === 'string' && RE_FECHA.test(f) ? f : null

      // PUT y no POST: hay un parte por día. Si el paciente lo rellena
      // por la mañana y por la tarde cambia de idea, se corrige el del
      // día en vez de acumular dos versiones de cómo estuvo el martes.
      const { rows } = await pool.query(
        `insert into registro_bienestar (clinica_id, paciente_id, fecha, estado, sintomas, nota)
         values ($1, $2,
                 coalesce($3::date, (now() at time zone 'America/Costa_Rica')::date),
                 $4, $5, $6)
         on conflict (paciente_id, fecha) do update
           set estado = excluded.estado,
               sintomas = excluded.sintomas,
               nota = excluded.nota,
               activo = true,
               updated_at = now()
         returning to_char(fecha,'YYYY-MM-DD') as fecha, estado, sintomas, nota`,
        [pac.clinica_id, pac.id, fecha, estado, sintomas as string[], nota === '' ? null : nota],
      )

      const r = rows[0]!
      return reply.send({
        fecha: r['fecha'],
        estado: Number(r['estado']),
        sintomas: r['sintomas'],
        nota: r['nota'],
      })
    },
  )

  /* ================================================================ */
  /* Medidas corporales                                                */
  /* ================================================================ */

  app.get<{ Querystring: { dias?: string } }>(
    '/api/paciente/medidas-corporales',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const dias = diasPedidos(request.query.dias, 180, 730)

      const { rows } = await pool.query(
        `select to_char(fecha,'YYYY-MM-DD') as fecha,
                cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm, nota
           from registro_medida_corporal
          where paciente_id = $1 and clinica_id = $2 and activo = true
            and fecha >= (now() at time zone 'America/Costa_Rica')::date - make_interval(days => $3)
          order by fecha desc, id desc`,
        [pac.id, pac.clinica_id, dias],
      )

      const registros = rows.map((r) => ({
        fecha: r['fecha'] as string,
        cinturaCm: num(r['cintura_cm']),
        caderaCm: num(r['cadera_cm']),
        pechoCm: num(r['pecho_cm']),
        brazoCm: num(r['brazo_cm']),
        musloCm: num(r['muslo_cm']),
        cuelloCm: num(r['cuello_cm']),
        nota: r['nota'] as string | null,
      }))

      // El cambio se calcula por medida y solo cuando hay dos tomas de
      // ESA medida. Si el paciente midió cintura en marzo y cadera en
      // julio, no hay ningún cambio que contar en ninguna de las dos.
      const cambios: Record<string, { primero: number; ultimo: number; delta: number } | null> = {}
      for (const clave of Object.keys(MEDIDAS) as ClaveMedida[]) {
        const conValor = registros.filter((r) => r[clave] !== null)
        if (conValor.length < 2) {
          cambios[clave] = null
          continue
        }
        // `registros` viene de más reciente a más antiguo.
        const ultimo = conValor[0]![clave] as number
        const primero = conValor[conValor.length - 1]![clave] as number
        cambios[clave] = {
          primero,
          ultimo,
          delta: Math.round((ultimo - primero) * 10) / 10,
        }
      }

      return reply.send({ dias, registros, cambios })
    },
  )

  app.put<{ Body: Record<string, unknown> }>(
    '/api/paciente/medidas-corporales',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const b = request.body ?? {}
      const valores: Record<ClaveMedida, number | null> = {
        cinturaCm: null,
        caderaCm: null,
        pechoCm: null,
        brazoCm: null,
        musloCm: null,
        cuelloCm: null,
      }

      for (const clave of Object.keys(MEDIDAS) as ClaveMedida[]) {
        const v = b[clave]
        if (v === undefined || v === null || v === '') continue
        const n = Number(v)
        const { min, max } = MEDIDAS[clave]
        if (!Number.isFinite(n) || n <= min || n >= max) {
          return reply.code(400).send({
            error: 'validacion',
            message: `La medida no parece correcta: debe estar entre ${min} y ${max} cm`,
          })
        }
        valores[clave] = Math.round(n * 10) / 10
      }

      // Sin ninguna medida no hay registro que guardar: ocuparía un día
      // en la gráfica sin aportar un punto.
      if (Object.values(valores).every((v) => v === null)) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'Apunta al menos una medida' })
      }

      const nota = typeof b['nota'] === 'string' ? b['nota'].trim() : ''
      if (nota.length > 300) {
        return reply
          .code(400)
          .send({ error: 'validacion', message: 'La nota no puede pasar de 300 caracteres' })
      }

      const f = b['fecha']
      const fecha = typeof f === 'string' && RE_FECHA.test(f) ? f : null

      // Al corregir un día, `coalesce` conserva lo que ya había: quien
      // solo vuelve a medirse la cintura no borra la cadera de esa
      // misma fecha por no haberla mandado.
      const { rows } = await pool.query(
        `insert into registro_medida_corporal
           (clinica_id, paciente_id, fecha, cintura_cm, cadera_cm, pecho_cm,
            brazo_cm, muslo_cm, cuello_cm, nota)
         values ($1, $2,
                 coalesce($3::date, (now() at time zone 'America/Costa_Rica')::date),
                 $4, $5, $6, $7, $8, $9, $10)
         on conflict (paciente_id, fecha) do update
           set cintura_cm = coalesce(excluded.cintura_cm, registro_medida_corporal.cintura_cm),
               cadera_cm  = coalesce(excluded.cadera_cm,  registro_medida_corporal.cadera_cm),
               pecho_cm   = coalesce(excluded.pecho_cm,   registro_medida_corporal.pecho_cm),
               brazo_cm   = coalesce(excluded.brazo_cm,   registro_medida_corporal.brazo_cm),
               muslo_cm   = coalesce(excluded.muslo_cm,   registro_medida_corporal.muslo_cm),
               cuello_cm  = coalesce(excluded.cuello_cm,  registro_medida_corporal.cuello_cm),
               nota       = coalesce(excluded.nota, registro_medida_corporal.nota),
               activo     = true,
               updated_at = now()
         returning to_char(fecha,'YYYY-MM-DD') as fecha,
                   cintura_cm, cadera_cm, pecho_cm, brazo_cm, muslo_cm, cuello_cm, nota`,
        [
          pac.clinica_id,
          pac.id,
          fecha,
          valores.cinturaCm,
          valores.caderaCm,
          valores.pechoCm,
          valores.brazoCm,
          valores.musloCm,
          valores.cuelloCm,
          nota === '' ? null : nota,
        ],
      )

      const r = rows[0]!
      return reply.code(201).send({
        fecha: r['fecha'],
        cinturaCm: num(r['cintura_cm']),
        caderaCm: num(r['cadera_cm']),
        pechoCm: num(r['pecho_cm']),
        brazoCm: num(r['brazo_cm']),
        musloCm: num(r['muslo_cm']),
        cuelloCm: num(r['cuello_cm']),
        nota: r['nota'],
      })
    },
  )

  app.delete<{ Params: { fecha: string } }>(
    '/api/paciente/medidas-corporales/:fecha',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const { fecha } = request.params
      if (!RE_FECHA.test(fecha)) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'No se encontró ese día' })
      }

      // Archivar, no borrar.
      const { rowCount } = await pool.query(
        `update registro_medida_corporal set activo = false, updated_at = now()
          where paciente_id = $1 and clinica_id = $2 and fecha = $3::date and activo = true`,
        [pac.id, pac.clinica_id, fecha],
      )
      if (rowCount === 0) {
        return reply.code(404).send({ error: 'no_encontrado', message: 'No se encontró ese día' })
      }
      return reply.send({ ok: true })
    },
  )
}

export { SINTOMAS }
