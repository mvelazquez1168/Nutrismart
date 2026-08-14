/**
 * Tarjeta de un plan en la lista lateral (CLI-09).
 *
 * El estado va con los tokens del design system, no con la escala de
 * Tailwind: `activo` usa el mismo `--status-normal` que el chip
 * "Completada" de la agenda. Dos verdes distintos para "esto está en
 * marcha" dentro de la misma aplicación sería el defecto.
 */
import type { CSSProperties } from 'react'
import type { EstadoPlan, Plan } from '../api/planes'

const ETIQUETA: Record<EstadoPlan, string> = {
  borrador: 'Borrador',
  activo: 'Activo',
  archivado: 'Archivado',
}

export function ChipEstadoPlan({ estado }: { estado: EstadoPlan }) {
  if (estado === 'activo') {
    return (
      <span
        className="badge-estado"
        style={{ '--estado-color': 'var(--status-normal)' } as CSSProperties}
      >
        {ETIQUETA.activo}
      </span>
    )
  }

  // Borrador y archivado comparten forma pero no peso: el archivado va
  // tachado, como la cita cancelada, porque ya no rige.
  return (
    <span
      className={`rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted ${
        estado === 'archivado' ? 'line-through' : ''
      }`}
    >
      {ETIQUETA[estado]}
    </span>
  )
}

/** 'AAAA-MM-DD' → '17/08/2026'. Sin pasar por Date: es fecha sin hora. */
function fechaCorta(iso: string | null): string | null {
  if (!iso) return null
  const [anio, mes, dia] = iso.split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

export function PlanCard({
  plan,
  seleccionado,
  onClick,
}: {
  plan: Plan
  seleccionado: boolean
  onClick: () => void
}) {
  const desde = fechaCorta(plan.fechaInicio)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={seleccionado ? 'true' : undefined}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        seleccionado
          ? 'border-primary bg-primary-tint'
          : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-medium text-ink">{plan.nombre}</span>
        <span className="shrink-0">
          <ChipEstadoPlan estado={plan.estado} />
        </span>
      </div>
      {desde && <p className="mt-1 text-xs text-muted">Desde {desde}</p>}
    </button>
  )
}
