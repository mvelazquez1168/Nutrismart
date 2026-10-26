/**
 * Felicitaciones de cumpleaños — R54.
 *
 * Corre cada hora, no una vez al día. Las clínicas no están todas en la
 * misma zona horaria (`clinica.zona_horaria`), así que «las 8 de la
 * mañana» es una hora distinta para cada una; un disparo diario en UTC
 * acertaría solo con las de un huso.
 *
 * Correr cada hora sería peligroso sin la reserva previa: se felicitaría
 * veinticuatro veces. Por eso la fila de `felicitacion_cumpleanos` se
 * inserta ANTES de mandar nada, y el único (paciente_id, anio) deja
 * pasar a uno solo. Es el mismo patrón de `recordatorios.ts`, y por la
 * misma razón: enviar primero y marcar después registra los fallos como
 * éxitos y duplica cuando hay dos instancias.
 */
import { pool } from '../db.js'
import { felicitarCumpleanos } from './notificaciones.js'

/** A partir de qué hora local se felicita. */
const HORA_ENVIO = 8

interface Cumpleanero {
  paciente_id: string
  clinica_id: string
  nombre: string
  correo: string
  anio: number
}

/**
 * Los que cumplen años HOY en la hora de SU clínica.
 *
 * Todo el filtro va en SQL y no en JavaScript porque la comparación de
 * fechas depende de la zona horaria de cada fila: `now() at time zone
 * c.zona_horaria` convierte el instante a la hora local de esa clínica,
 * y de ahí salen el día, el mes y la hora con los que se compara. Traer
 * los pacientes y filtrarlos fuera obligaría a reimplementar eso.
 *
 * Se excluye a quien no tiene correo y a quien no está activo: felicitar
 * a un paciente dado de baja es, en el mejor de los casos, raro.
 */
const PENDIENTES = `
  with local as (
    select p.id as paciente_id, p.clinica_id, p.nombre, p.correo,
           p.fecha_nacimiento,
           (now() at time zone c.zona_horaria) as ahora
      from paciente p
      join clinica c on c.id = p.clinica_id
     where p.estado = 'activo'
       and p.correo is not null and btrim(p.correo) <> ''
       and p.fecha_nacimiento is not null
  )
  select paciente_id, clinica_id, nombre, correo,
         extract(year from ahora)::int as anio
    from local
   where extract(month from fecha_nacimiento) = extract(month from ahora)
     and extract(day   from fecha_nacimiento) = extract(day   from ahora)
     and extract(hour  from ahora) >= $1
     -- El que ya se felicitó este año no vuelve a entrar. La reserva
     -- lo impediría igual, pero filtrando aquí no se intenta insertar
     -- una fila por paciente y hora durante todo el día.
     and not exists (
       select 1 from felicitacion_cumpleanos f
        where f.paciente_id = local.paciente_id
          and f.anio = extract(year from ahora)::int
     )
`

/**
 * Reserva el envío.
 *
 * `on conflict do nothing` + `returning`: si devuelve fila, esta
 * ejecución es la que manda el correo; si no devuelve nada, ya lo
 * reservó otra y aquí no se hace nada.
 */
async function reservar(c: Cumpleanero): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into felicitacion_cumpleanos (clinica_id, paciente_id, anio, destinatario)
     values ($1, $2, $3, $4)
     on conflict (paciente_id, anio) do nothing
     returning id`,
    [c.clinica_id, c.paciente_id, c.anio, c.correo],
  )
  return rows[0]?.id ?? null
}

async function anotar(id: string, exito: boolean, error?: string): Promise<void> {
  await pool.query(
    `update felicitacion_cumpleanos set exito = $2, error = $3 where id = $1`,
    [id, exito, error?.slice(0, 500) ?? null],
  )
}

/**
 * Una pasada. Devuelve cuántas felicitaciones salieron.
 *
 * No lanza nunca: corre dentro de un temporizador y una excepción sin
 * capturar se lo lleva por delante —y con él los recordatorios de cita,
 * que comparten proceso—.
 */
export async function procesarCumpleanos(): Promise<number> {
  let enviadas = 0
  try {
    const { rows } = await pool.query<Cumpleanero>(PENDIENTES, [HORA_ENVIO])

    for (const c of rows) {
      const reserva = await reservar(c)
      if (!reserva) continue

      try {
        const r = await felicitarCumpleanos({
          clinicaId: c.clinica_id,
          correo: c.correo,
          nombre: c.nombre,
        })
        await anotar(reserva, r === 'enviado', r === 'enviado' ? undefined : r)
        if (r === 'enviado') enviadas++
      } catch (e) {
        await anotar(reserva, false, e instanceof Error ? e.message : String(e))
      }
    }
  } catch (e) {
    console.error('[cumpleanos] la pasada fallo:', e)
  }
  return enviadas
}
