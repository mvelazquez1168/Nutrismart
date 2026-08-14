/**
 * Recordatorios automáticos de cita — AGE-03.
 *
 * Un proceso periódico busca las citas que entran en la ventana de
 * aviso, RESERVA el envío en la base y solo entonces manda el correo.
 *
 * El orden importa. El encargo proponía enviar y marcar después, con
 * una bandera en la propia cita; así, dos instancias de la API que se
 * solapen mandan el mismo aviso dos veces, y un fallo de Resend queda
 * registrado como enviado. Reservando primero, quien consigue insertar
 * la fila es quien envía —el índice único lo garantiza— y el resultado
 * real se anota encima.
 */
import { pool } from '../db.js'
import { config } from '../config.js'
import { enviarRecordatorioCita } from './email-recordatorio.js'

export type Antelacion = '24h' | '1h'

interface CitaPendiente {
  id: string
  clinica_id: string
  inicio: string
  tipo: string
  correo: string
  paciente: string
  clinica: string
}

/**
 * Ventanas holgadas a propósito.
 *
 * El proceso corre cada 15 minutos, así que una ventana de exactamente
 * 24 h se saltaría casi todas las citas: solo entrarían las que caen
 * justo en el instante del ciclo. Con 23–25 h y 55–65 min, cada cita
 * pasa por varios ciclos y el índice único evita el duplicado.
 */
const VENTANAS: Record<Antelacion, { desdeMin: number; hastaMin: number }> = {
  '24h': { desdeMin: 23 * 60, hastaMin: 25 * 60 },
  '1h': { desdeMin: 55, hastaMin: 65 },
}

async function procesar(antelacion: Antelacion): Promise<number> {
  const v = VENTANAS[antelacion]

  const { rows } = await pool.query<CitaPendiente>(
    `select c.id, c.clinica_id,
            to_char(c.inicio at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as inicio,
            c.tipo::text as tipo,
            p.correo, p.nombre as paciente,
            coalesce(cl.nombre_comercial, cl.nombre_fiscal) as clinica
       from cita c
       join paciente p on p.id = c.paciente_id
       join clinica cl on cl.id = c.clinica_id
      where c.inicio between now() + ($1 || ' minutes')::interval
                         and now() + ($2 || ' minutes')::interval
        -- Solo lo que sigue en pie. El enum real usa 'completada', no
        -- 'realizada' como asumia el encargo: comparar contra una
        -- etiqueta inexistente hace fallar la consulta entera, no
        -- ignorar la fila.
        and c.estado in ('programada', 'confirmada')
        and p.correo is not null
        and p.estado = 'activo'
        and not exists (
          select 1 from recordatorio_cita r
           where r.cita_id = c.id and r.antelacion = $3
        )`,
    [v.desdeMin, v.hastaMin, antelacion],
  )

  let enviados = 0

  for (const cita of rows) {
    // Reserva. Si otra instancia se adelantó, `on conflict do nothing`
    // no devuelve fila y esta se salta la cita sin enviar nada.
    const { rows: reserva } = await pool.query<{ id: string }>(
      `insert into recordatorio_cita (clinica_id, cita_id, antelacion, destinatario)
       values ($1,$2,$3,$4)
       on conflict (cita_id, antelacion) do nothing
       returning id`,
      [cita.clinica_id, cita.id, antelacion, cita.correo],
    )
    const reservaId = reserva[0]?.id
    if (!reservaId) continue

    const resultado = await enviarRecordatorioCita({
      correoPaciente: cita.correo,
      nombrePaciente: cita.paciente,
      nombreClinica: cita.clinica,
      inicio: cita.inicio,
      tipoCita: cita.tipo,
      antelacion,
    })

    await pool.query(
      `update recordatorio_cita set exito = $2, error = $3 where id = $1`,
      [reservaId, resultado.ok, resultado.error ?? null],
    )
    if (resultado.ok) enviados++
  }

  return enviados
}

/** Un ciclo completo. Nunca lanza: es lo que llama el temporizador. */
export async function procesarRecordatorios(): Promise<{ ['24h']: number; ['1h']: number }> {
  const resultado = { '24h': 0, '1h': 0 }
  for (const antelacion of ['24h', '1h'] as const) {
    try {
      resultado[antelacion] = await procesar(antelacion)
    } catch (e) {
      console.error('[AGE] fallo procesando recordatorios de %s:', antelacion, e)
    }
  }

  if (resultado['24h'] + resultado['1h'] > 0) {
    console.log('[AGE] recordatorios enviados — 24h: %d, 1h: %d', resultado['24h'], resultado['1h'])
  }
  return resultado
}

/** true cuando hay con qué enviar; lo usa el arranque para avisar. */
export function correoConfigurado(): boolean {
  return config.resend !== undefined
}
