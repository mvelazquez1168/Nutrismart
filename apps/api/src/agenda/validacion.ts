/** Validacion del cuerpo de POST y PUT de citas. */

export const CITA_TIPOS = ['primera_vez', 'seguimiento', 'control', 'urgencia'] as const
export type CitaTipo = (typeof CITA_TIPOS)[number]

export const CITA_ESTADOS = [
  'programada',
  'confirmada',
  'completada',
  'cancelada',
  'no_asistio',
] as const
export type CitaEstado = (typeof CITA_ESTADOS)[number]

export interface DatosCita {
  pacienteId: string
  /** ISO 8601 con offset; la base la guarda como timestamptz. */
  inicio: string
  duracionMinutos: number
  tipo: CitaTipo
  notas: string | null
}

export interface ErrorCampo {
  campo: string
  mensaje: string
}

export type Validacion =
  | { ok: true; datos: DatosCita }
  | { ok: false; errores: ErrorCampo[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Coinciden con el check de la migración 006. */
const DURACION_MIN = 5
const DURACION_MAX = 480

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const t = valor.trim()
  return t === '' ? null : t
}

export function validarCita(cuerpo: unknown, exigirPaciente: boolean): Validacion {
  const errores: ErrorCampo[] = []

  if (typeof cuerpo !== 'object' || cuerpo === null) {
    return { ok: false, errores: [{ campo: '_', mensaje: 'El cuerpo debe ser un objeto JSON' }] }
  }
  const b = cuerpo as Record<string, unknown>

  // --- paciente ---
  // En PUT no se cambia de paciente: mover una cita a otra persona sería
  // rehacerla, no editarla.
  let pacienteId = ''
  if (exigirPaciente) {
    const raw = texto(b['pacienteId'])
    if (!raw) errores.push({ campo: 'pacienteId', mensaje: 'Selecciona un paciente' })
    else if (!UUID_RE.test(raw)) errores.push({ campo: 'pacienteId', mensaje: 'Paciente inválido' })
    else pacienteId = raw
  }

  // --- inicio ---
  const inicioRaw = texto(b['inicio'])
  let inicio = ''
  if (!inicioRaw) {
    errores.push({ campo: 'inicio', mensaje: 'Indica la fecha y hora' })
  } else {
    const fecha = new Date(inicioRaw)
    if (Number.isNaN(fecha.getTime())) {
      errores.push({ campo: 'inicio', mensaje: 'Fecha y hora inválidas' })
    } else {
      inicio = fecha.toISOString()
    }
  }

  // --- duracion ---
  const durRaw = b['duracionMinutos']
  let duracionMinutos = 0
  if (durRaw === undefined || durRaw === null || durRaw === '') {
    errores.push({ campo: 'duracionMinutos', mensaje: 'Indica la duración' })
  } else {
    const n = typeof durRaw === 'number' ? durRaw : Number(durRaw)
    if (!Number.isInteger(n)) {
      errores.push({ campo: 'duracionMinutos', mensaje: 'La duración debe ser un número entero de minutos' })
    } else if (n < DURACION_MIN || n > DURACION_MAX) {
      errores.push({
        campo: 'duracionMinutos',
        mensaje: `La duración debe estar entre ${DURACION_MIN} y ${DURACION_MAX} minutos`,
      })
    } else {
      duracionMinutos = n
    }
  }

  // --- tipo ---
  const tipoRaw = texto(b['tipo'])
  let tipo: CitaTipo = 'seguimiento'
  if (!tipoRaw) {
    errores.push({ campo: 'tipo', mensaje: 'Selecciona el tipo de consulta' })
  } else if (!(CITA_TIPOS as readonly string[]).includes(tipoRaw)) {
    errores.push({ campo: 'tipo', mensaje: `Debe ser uno de: ${CITA_TIPOS.join(', ')}` })
  } else {
    tipo = tipoRaw as CitaTipo
  }

  if (errores.length > 0) return { ok: false, errores }

  return {
    ok: true,
    datos: { pacienteId, inicio, duracionMinutos, tipo, notas: texto(b['notas']) },
  }
}

export function validarEstado(cuerpo: unknown): CitaEstado | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const raw = (cuerpo as Record<string, unknown>)['estado']
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  return (CITA_ESTADOS as readonly string[]).includes(v) ? (v as CitaEstado) : null
}
