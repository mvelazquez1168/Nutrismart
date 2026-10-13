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
  onResumen,
}: {
  plan: Plan
  seleccionado: boolean
  onClick: () => void
  /** Abre el resumen clinico de este plan (R49). */
  onResumen?: () => void
}) {
  // Fecha de prescripción: la de inicio si el plan la declara; si no
  // —un borrador que aún no rige—, el día en que se creó. La lista es un
  // histórico, y un ítem sin fecha no se sitúa en él (R41).
  const desde = fechaCorta(plan.fechaInicio)
  const creado = fechaCorta(plan.createdAt.slice(0, 10))

  /*
   * La tarjeta es un DIV con dos botones dentro, no un boton con otro
   * boton anidado: eso es HTML invalido, y el navegador lo desarma por su
   * cuenta de un modo que deja el clic del interior sin funcionar.
   *
   * El boton del resumen (R49) va en su propia franja, separado por una
   * linea: el area de seleccion del plan sigue siendo toda la tarjeta de
   * arriba, y abrir el resumen no selecciona el plan ni al reves.
   */
  return (
    <div
      className={`rounded-md border transition-colors ${
        seleccionado ? 'border-primary bg-primary-tint' : 'border-border bg-surface'
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        aria-current={seleccionado ? 'true' : undefined}
        className={`w-full rounded-t-md p-3 text-left ${
          seleccionado ? '' : 'hover:bg-surface-2'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="min-w-0 text-sm font-medium text-ink">{plan.nombre}</span>
          <span className="shrink-0">
            <ChipEstadoPlan estado={plan.estado} />
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">
          {desde ? `Desde ${desde}` : creado ? `Creado el ${creado}` : 'Sin fecha'}
        </p>
      </button>

      {onResumen && (
        <div className="border-t border-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={onResumen}
            className="text-xs font-medium text-primary hover:underline"
          >
            {/*
              El texto dice cual de los dos es. Los planes de antes de la
              R49 no tienen resumen, y ofrecer «Ver resumen» para abrir un
              modal vacio seria prometer algo que no hay.
            */}
            {plan.tieneResumen ? 'Ver resumen clinico' : 'Generar resumen clinico'}
          </button>
        </div>
      )}
    </div>
  )
}
