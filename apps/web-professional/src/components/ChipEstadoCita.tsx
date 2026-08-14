/**
 * Estado de una cita.
 *
 * Vivía dentro de Agenda.tsx; se extrae aquí porque el dashboard
 * (CLI-08) muestra la agenda del día y tiene que pintar los estados
 * EXACTAMENTE igual. Duplicar los colores es cómo dos pantallas acaban
 * discrepando sobre qué significa "cancelada".
 */
import type { CSSProperties } from 'react'
import type { CitaEstado } from '../api/tipos'

export function ChipEstadoCita({ estado }: { estado: CitaEstado }) {
  if (estado === 'programada') {
    return (
      <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-xs font-medium text-primary">
        Programada
      </span>
    )
  }

  // Confirmada es "programada, y además el paciente dijo que viene": el
  // mismo color con relleno lleno, para que se lea como un paso más
  // dentro de la misma vía y no como otro estado.
  if (estado === 'confirmada') {
    return (
      <span className="rounded-pill bg-primary px-2 py-0.5 text-xs font-medium text-white">
        Confirmada
      </span>
    )
  }

  if (estado === 'completada') {
    return (
      <span
        className="badge-estado"
        style={{ '--estado-color': 'var(--status-normal)' } as CSSProperties}
      >
        Completada
      </span>
    )
  }

  // La ausencia se lee distinto de la cancelación, y por eso lleva su
  // propio color. Cancelar es un aviso —el hueco se pudo reasignar—; no
  // presentarse es un hueco perdido, y quien mira la agenda de la
  // semana necesita distinguirlos de un vistazo.
  if (estado === 'no_asistio') {
    return (
      <span
        className="badge-estado"
        style={{ '--estado-color': 'var(--status-alert)' } as CSSProperties}
      >
        No asistió
      </span>
    )
  }

  // Tachada y en gris: una cita cancelada ocurrió en la agenda pero no
  // en la realidad, y conviene que se lea distinto de un vacío.
  return (
    <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted line-through">
      Cancelada
    </span>
  )
}
