import type { CSSProperties } from 'react'
import type { EstadoClinico } from '../api/tipos'

/**
 * Los estados clinicos NO se re-tematizan con la marca de la clinica
 * (tokens.css lo marca explicitamente): un "critico" tiene que verse
 * igual en todas las instalaciones. Por eso van a --status-*, nunca a
 * --primary.
 */
const ESTILOS: Record<EstadoClinico, { etiqueta: string; token: string }> = {
  normal: { etiqueta: 'Normal', token: 'var(--status-normal)' },
  alerta: { etiqueta: 'Alerta', token: 'var(--status-alert)' },
  critico: { etiqueta: 'Crítico', token: 'var(--status-critical)' },
}

export function EstadoBadge({ estado }: { estado: EstadoClinico }) {
  const estilo = ESTILOS[estado]

  // Un estado desconocido no debe romper la tabla: si la base gana un
  // cuarto valor (el 'serious' del RPM) antes que el front, se muestra
  // en crudo en vez de reventar.
  if (!estilo) {
    return <span className="text-xs text-muted">{estado}</span>
  }

  return (
    <span className="badge-estado" style={{ '--estado-color': estilo.token } as CSSProperties}>
      {estilo.etiqueta}
    </span>
  )
}
