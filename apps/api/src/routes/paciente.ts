/**
 * Zona del paciente — PAC-02.
 *
 * La clínica se resuelve SIEMPRE desde la fila de `paciente`, nunca de un
 * claim ni del cliente. El paciente no elige su clínica: la tiene.
 *
 * Todo lo que se devuelve aquí ya se le podía enseñar en consulta. No se
 * expone nada que el profesional no le hubiera dicho de viva voz: ni
 * notas internas, ni interpretaciones de IA sin revisar, ni diagnósticos
 * de otras consultas.
 */
import type { FastifyInstance } from 'fastify'
import { pool } from '../db.js'
import { requireAuthPaciente } from '../auth.js'

interface Yo {
  paciente_id: string
  clinica_id: string
  nombre: string
  correo: string | null
  telefono: string | null
  fecha_nacimiento: string | null
  sexo: string | null
  clinica: string
  nombre_app: string | null
  color_primario: string | null
  logo_ruta: string | null
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

/**
 * Del `sub` del token al expediente. Devuelve undefined cuando la cuenta
 * existe en Keycloak pero todavía no está vinculada a ningún paciente.
 */
async function resolverPaciente(sub: string): Promise<Yo | undefined> {
  const { rows } = await pool.query<Yo>(
    `select p.id as paciente_id, p.clinica_id, p.nombre, p.correo, p.telefono,
            to_char(p.fecha_nacimiento,'YYYY-MM-DD') as fecha_nacimiento,
            p.sexo_biologico::text as sexo,
            coalesce(c.nombre_comercial, c.nombre_fiscal) as clinica,
            b.nombre_app, b.color_primario, b.logo_ruta
       from paciente p
       join clinica c on c.id = p.clinica_id
       left join brand_config b on b.clinica_id = p.clinica_id
      where p.keycloak_user_id = $1 and p.estado = 'activo'`,
    [sub],
  )
  return rows[0]
}

/**
 * Respuesta cuando el token es válido pero no hay expediente detrás.
 *
 * Se distingue el profesional que se equivocó de aplicación —merece
 * saberlo, y no se le revela nada que su propio token no revele ya— del
 * paciente que aún no ha usado su enlace.
 */
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
          message:
            'Tu cuenta todavía no está vinculada a un expediente. Usa el enlace de invitación de tu nutricionista.',
        },
      }
}

export async function registerPacienteRoutes(app: FastifyInstance): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* GET /api/paciente/yo                                              */
  /* ---------------------------------------------------------------- */
  app.get('/api/paciente/yo', { preHandler: requireAuthPaciente }, async (request, reply) => {
    const yo = await resolverPaciente(request.authPac.sub)
    if (!yo) {
      const r = await sinExpediente(request.authPac.sub)
      return reply.code(r.codigo).send(r.cuerpo)
    }

    return reply.send({
      id: yo.paciente_id,
      nombre: yo.nombre,
      correo: yo.correo,
      telefono: yo.telefono,
      fechaNacimiento: yo.fecha_nacimiento,
      sexo: yo.sexo,
      // La marca viaja con el perfil para que la app del paciente se
      // vista con los colores de SU clínica. Es el mismo white-label de
      // la Rebanada 6, aplicado al otro lado.
      clinica: {
        nombre: yo.nombre_app ?? yo.clinica,
        colorPrimario: yo.color_primario,
        tieneLogo: yo.logo_ruta !== null,
      },
    })
  })

  /* ---------------------------------------------------------------- */
  /* GET /api/paciente/dashboard                                       */
  /* ---------------------------------------------------------------- */
  app.get('/api/paciente/dashboard', { preHandler: requireAuthPaciente }, async (request, reply) => {
    const yo = await resolverPaciente(request.authPac.sub)
    if (!yo) {
      const r = await sinExpediente(request.authPac.sub)
      return reply.code(r.codigo).send(r.cuerpo)
    }

    const { paciente_id: pid, clinica_id: cid } = yo

    const [pesos, cita, plan, mensajes, ultimaConsulta] = await Promise.all([
      // Últimas 8 mediciones. La misma consulta sirve para el peso actual
      // y para la línea del gráfico: pedirlas dos veces devolvería dos
      // lecturas de la misma tabla que podrían no coincidir.
      pool.query(
        `select peso_kg, to_char(fecha_medicion,'YYYY-MM-DD') as fecha
           from medicion_antropometrica
          where clinica_id = $1 and paciente_id = $2 and peso_kg is not null
          order by fecha_medicion desc, created_at desc
          limit 8`,
        [cid, pid],
      ),

      // La cita usa `inicio` (timestamptz), no fecha + hora por separado.
      pool.query(
        `select to_char(inicio,'YYYY-MM-DD"T"HH24:MI:SSOF') as inicio,
                duracion_minutos, tipo::text as tipo,
                prof.nombre as profesional
           from cita c
           left join profesional prof on prof.id = c.profesional_id
          where c.clinica_id = $1 and c.paciente_id = $2
            and c.estado = 'programada' and c.inicio >= now()
          order by c.inicio asc limit 1`,
        [cid, pid],
      ),

      pool.query(
        `select cv.kcal_prescritas, cv.pct_proteina, cv.pct_cho, cv.pct_grasa,
                cv.proteina_g, cv.cho_g, cv.grasa_g,
                to_char(con.fecha_consulta,'YYYY-MM-DD') as fecha
           from conclusion_valoracion cv
           join consulta con on con.id = cv.consulta_id
          where con.clinica_id = $1 and con.paciente_id = $2
            and con.estado = 'finalizada'
          order by con.numero_consulta desc limit 1`,
        [cid, pid],
      ),

      pool.query(
        `select coalesce(sum(mensajes_no_leidos_pac), 0)::int as sin_leer
           from conversacion
          where clinica_id = $1 and paciente_id = $2 and activa = true`,
        [cid, pid],
      ),

      // Los acuerdos salen de la ÚLTIMA consulta finalizada, resuelta
      // antes de aplanar el jsonb. La consulta que traía la especificación
      // aplanaba primero y limitaba después, así que mezclaba acuerdos de
      // consultas distintas y el paciente vería como pendiente algo que
      // pactó hace seis meses y ya no aplica.
      pool.query(
        `select cv.acuerdos
           from conclusion_valoracion cv
           join consulta con on con.id = cv.consulta_id
          where con.clinica_id = $1 and con.paciente_id = $2
            and con.estado = 'finalizada'
          order by con.numero_consulta desc limit 1`,
        [cid, pid],
      ),
    ])

    const p = plan.rows[0]
    const acuerdos = (ultimaConsulta.rows[0]?.['acuerdos'] ?? []) as {
      texto: string
      cumplido: boolean
    }[]

    return reply.send({
      pesoActual: pesos.rows[0]
        ? { pesoKg: num(pesos.rows[0]['peso_kg']), fecha: pesos.rows[0]['fecha'] }
        : null,
      // En orden cronológico para la gráfica: la consulta los trae del
      // más reciente al más antiguo.
      historialPeso: pesos.rows
        .map((r) => ({ pesoKg: Number(r['peso_kg']), fecha: r['fecha'] as string }))
        .reverse(),
      proximaCita: cita.rows[0]
        ? {
            inicio: cita.rows[0]['inicio'],
            duracionMinutos: num(cita.rows[0]['duracion_minutos']),
            tipo: cita.rows[0]['tipo'],
            profesional: cita.rows[0]['profesional'],
          }
        : null,
      plan: p
        ? {
            kcal: num(p['kcal_prescritas']),
            pctProteina: num(p['pct_proteina']),
            pctCho: num(p['pct_cho']),
            pctGrasa: num(p['pct_grasa']),
            proteinaG: num(p['proteina_g']),
            choG: num(p['cho_g']),
            grasaG: num(p['grasa_g']),
            fecha: p['fecha'],
          }
        : null,
      // El diagnóstico NO se envía. Un texto como «obesidad grado I»
      // escrito para otro profesional aterriza distinto cuando lo lee
      // el paciente solo, en su móvil, sin nadie que lo acompañe. Eso
      // se dice en consulta.
      acuerdos: acuerdos.filter((a) => a.texto?.trim()),
      mensajesSinLeer: Number(mensajes.rows[0]?.['sin_leer'] ?? 0),
    })
  })
}
