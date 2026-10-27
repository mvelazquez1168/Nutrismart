/**
 * El agua del día — R55.
 *
 * Dos rutas: cuánto hay que beber y cuánto se lleva, y un botón para
 * sumar un vaso.
 *
 * ── De dónde sale la meta ───────────────────────────────────────────
 *
 * De `conclusion_valoracion.meta_agua_ml` de la ÚLTIMA consulta
 * finalizada, que es la misma consulta que usa `paciente-registros.ts`
 * para el objetivo de calorías. No se inventa ninguna por defecto: dos
 * litros para todo el mundo es justo la clase de consejo que el
 * profesional está para corregir, y enseñarlo como si lo hubiera
 * indicado él sería mentir sobre quién lo dijo.
 *
 * ── Sobre el prefijo de la ruta ─────────────────────────────────────
 *
 * El encargo las pone bajo `/api/gamificacion/`, fuera del
 * `/api/paciente/` del resto de la app. Se respeta, pero la
 * autenticación NO cambia: `requireAuthPaciente` y el paciente se
 * resuelve del `sub` del token, nunca de la URL. Un id de paciente en
 * la ruta volvería a abrir la puerta que el resto de la API tiene
 * cerrada.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../../db.js'
import { requireAuthPaciente } from '../../auth.js'

/** Tope por llamada. Un vaso grande son 500 ml; 2 litros de un toque no. */
const MAX_POR_REGISTRO = 2000

interface Pac {
  id: string
  clinica_id: string
  zona_horaria: string
}

/**
 * Del token al expediente, con la zona horaria de su clínica.
 *
 * La zona hace falta para saber qué día es «hoy». Con la del servidor,
 * un vaso de agua a las once de la noche en Costa Rica se sumaría al
 * día siguiente si el contenedor corre en UTC — y el paciente vería su
 * botella vaciarse de golpe.
 */
async function resolverPaciente(sub: string): Promise<Pac | undefined> {
  const { rows } = await pool.query<Pac>(
    `select p.id, p.clinica_id, c.zona_horaria
       from paciente p
       join clinica c on c.id = p.clinica_id
      where p.keycloak_user_id = $1 and p.estado = 'activo'`,
    [sub],
  )
  return rows[0]
}

/** La misma respuesta que da el resto de rutas del paciente. */
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

/**
 * La meta vigente. `null` si el profesional no la fijó.
 *
 * Misma consulta que el objetivo de calorías en `paciente-registros.ts`:
 * la última consulta FINALIZADA. Una consulta a medio escribir no es
 * una indicación todavía.
 */
async function metaVigente(pacienteId: string, clinicaId: string): Promise<number | null> {
  const { rows } = await pool.query<{ meta_agua_ml: number | null }>(
    `select cv.meta_agua_ml
       from conclusion_valoracion cv
       join consulta c on c.id = cv.consulta_id
      where c.paciente_id = $1 and c.clinica_id = $2 and c.estado = 'finalizada'
      order by c.numero_consulta desc limit 1`,
    [pacienteId, clinicaId],
  )
  const v = rows[0]?.meta_agua_ml
  return v === null || v === undefined ? null : Number(v)
}

export async function registerAguaRoutes(app: FastifyInstance): Promise<void> {
  /* ================================================================ */
  /* GET /api/gamificacion/agua/hoy                                    */
  /* ================================================================ */

  app.get(
    '/api/gamificacion/agua/hoy',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      // La fecha y el total salen de la MISMA consulta: pedir «hoy» por
      // un lado y el registro por otro deja una rendija en la que el
      // día puede cambiar entre las dos.
      const { rows } = await pool.query<{ fecha: string; ml_total: string | null }>(
        `select to_char((now() at time zone $3)::date, 'YYYY-MM-DD') as fecha,
                (select ml_total from registro_agua
                  where paciente_id = $1 and clinica_id = $2
                    and fecha = (now() at time zone $3)::date) as ml_total`,
        [pac.id, pac.clinica_id, pac.zona_horaria],
      )

      const f = rows[0]!
      return reply.send({
        fecha: f.fecha,
        meta_ml: await metaVigente(pac.id, pac.clinica_id),
        // Sin fila todavía no se ha bebido nada registrado, que es 0 y
        // no «desconocido»: la botella arranca vacía, no en blanco.
        registrado_hoy_ml: f.ml_total === null ? 0 : Number(f.ml_total),
      })
    },
  )

  /* ================================================================ */
  /* POST /api/gamificacion/agua/registro                              */
  /* ================================================================ */

  /**
   * Suma mililitros al día de hoy.
   *
   * El UPSERT suma en la propia sentencia (`ml_total + $4`) en vez de
   * leer, sumar en JavaScript y escribir. Dos toques seguidos en el
   * móvil —que es el gesto normal aquí— se pisarían con lo segundo: los
   * dos leerían el mismo total y el último ganaría, perdiendo un vaso.
   */
  app.post<{ Body: Record<string, unknown> }>(
    '/api/gamificacion/agua/registro',
    { preHandler: requireAuthPaciente },
    async (request, reply) => {
      const pac = await resolverPaciente(request.authPac.sub)
      if (!pac) {
        const r = await sinExpediente(request.authPac.sub)
        return reply.code(r.codigo).send(r.cuerpo)
      }

      const ml = Number((request.body ?? {})['ml'])
      if (!Number.isInteger(ml) || ml <= 0 || ml > MAX_POR_REGISTRO) {
        return reply.code(400).send({
          error: 'validacion',
          message: `Indica una cantidad entre 1 y ${MAX_POR_REGISTRO} ml`,
        })
      }

      const { rows } = await pool.query<{ fecha: string; ml_total: number }>(
        `insert into registro_agua (paciente_id, clinica_id, fecha, ml_total)
         values ($1, $2, (now() at time zone $3)::date, $4)
         on conflict (paciente_id, clinica_id, fecha) do update
           set ml_total = registro_agua.ml_total + excluded.ml_total,
               updated_at = now()
         returning to_char(fecha,'YYYY-MM-DD') as fecha, ml_total`,
        [pac.id, pac.clinica_id, pac.zona_horaria, ml],
      )

      const r = rows[0]!
      return reply.code(201).send({
        fecha: r.fecha,
        meta_ml: await metaVigente(pac.id, pac.clinica_id),
        registrado_hoy_ml: Number(r.ml_total),
      })
    },
  )
}
