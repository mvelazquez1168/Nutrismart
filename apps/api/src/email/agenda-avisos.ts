/**
 * El puente entre la agenda y el correo — R54.
 *
 * Los handlers de `routes/agenda.ts` saben el id de la cita y poco más:
 * `crearCita` devuelve un id, `cambiarEstado` devuelve un booleano.
 * Pasarles por parámetro el nombre y el correo del paciente y del
 * profesional obligaría a cambiar las firmas del repositorio para algo
 * que no es su asunto.
 *
 * Así que el aviso parte del id y lee lo que necesita. Una consulta más
 * por cita agendada es barata, y deja los handlers en una línea.
 */
import { pool } from '../db.js'
import {
  avisarAgendaProfesional,
  avisarCitaAgendada,
  avisarCitaCancelada,
  avisarCitaReagendada,
  enSegundoPlano,
  type CambioAgenda,
  type DatosCita,
} from './notificaciones.js'

interface Registro {
  clinica_id: string
  inicio: string
  tipo: string
  motivo: string | null
  paciente: string
  paciente_correo: string | null
  profesional: string
  profesional_correo: string | null
}

/** El instante de una cita, para saber si un cambio la movió de hora. */
export async function inicioDeCita(citaId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ inicio: string }>(
      `select inicio from cita where id = $1`,
      [citaId],
    )
    return rows[0]?.inicio ?? null
  } catch {
    return null
  }
}

async function cargar(citaId: string): Promise<DatosCita | null> {
  const { rows } = await pool.query<Registro>(
    `select c.clinica_id, c.inicio, c.tipo::text as tipo, c.motivo,
            p.nombre as paciente, p.correo as paciente_correo,
            pr.nombre as profesional, pr.correo as profesional_correo
       from cita c
       join paciente p     on p.id  = c.paciente_id
       join profesional pr on pr.id = c.profesional_id
      where c.id = $1`,
    [citaId],
  )

  const r = rows[0]
  if (!r) return null

  return {
    clinicaId: r.clinica_id,
    pacienteCorreo: r.paciente_correo,
    pacienteNombre: r.paciente,
    profesionalCorreo: r.profesional_correo,
    profesionalNombre: r.profesional,
    inicio: new Date(r.inicio).toISOString(),
    tipo: r.tipo,
    motivo: r.motivo,
  }
}

interface Log {
  error: (o: unknown, m: string) => void
}

/**
 * Avisa a las dos partes de un cambio en una cita.
 *
 * **No se espera.** Devuelve en cuanto ha lanzado las promesas; el
 * handler contesta su 201 o su 200 sin que un Resend lento añada
 * segundos a la petición. Un fallo de correo no debe hacer fallar —ni
 * ralentizar— la operación principal.
 *
 * Al paciente y al profesional se les manda por separado a propósito:
 * si el paciente no tiene correo en el expediente, el profesional
 * recibe el suyo igual.
 */
export function avisarCambioDeCita(
  citaId: string,
  cambio: CambioAgenda,
  opciones: { inicioAnterior?: string | null; log?: Log } = {},
): void {
  const tarea = (async () => {
    const datos = await cargar(citaId)
    if (!datos) return

    const anterior = opciones.inicioAnterior
      ? new Date(opciones.inicioAnterior).toISOString()
      : undefined
    const conAnterior = { ...datos, inicioAnterior: anterior }

    const alPaciente =
      cambio === 'agendada'
        ? avisarCitaAgendada(datos)
        : cambio === 'cancelada'
          ? avisarCitaCancelada(datos)
          : avisarCitaReagendada(conAnterior)

    await Promise.allSettled([
      alPaciente,
      avisarAgendaProfesional({ ...conAnterior, cambio }),
    ])
  })()

  enSegundoPlano(tarea.then(() => 'enviado' as const), `aviso de cita ${cambio}`, opciones.log)
}
