/** Envoltura de campo: etiqueta, control y error inline. */
import type { ReactNode } from 'react'

export const CLASE_CONTROL =
  'w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:ring-2 focus:ring-[color:var(--ring)] disabled:opacity-60'

export function claseControl(hayError: boolean): string {
  // El error se marca con el color de estado crítico, no con un rojo
  // suelto: es el mismo token que usa el resto de la app.
  return `${CLASE_CONTROL} ${hayError ? 'border-[color:var(--status-critical)]' : 'border-border focus:border-primary'}`
}

interface Props {
  id: string
  etiqueta: string
  requerido?: boolean
  error?: string | undefined
  ayuda?: string | undefined
  children: ReactNode
}

export function Campo({ id, etiqueta, requerido, error, ayuda, children }: Props) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {etiqueta}
        {requerido && (
          <span className="ml-0.5 text-[color:var(--status-critical)]" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children}

      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-[color:var(--status-critical)]">
          {error}
        </p>
      ) : (
        ayuda && <p className="mt-1 text-xs text-muted">{ayuda}</p>
      )}
    </div>
  )
}
