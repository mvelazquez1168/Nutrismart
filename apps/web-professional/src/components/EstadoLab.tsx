/**
 * Badge de estado de un resultado de laboratorio.
 *
 * `sin_referencia` va en GRIS, no con color de estado clínico: no es un
 * nivel de gravedad entre normal y alterado, es la ausencia de criterio.
 * Pintarlo de amarillo lo convertiría en una alarma que nadie ha
 * declarado.
 *
 * Y `alterado` no significa "grave": significa fuera del rango que
 * declaró la clínica. La severidad es cosa del profesional.
 */
import type { CSSProperties } from 'react'
import type { EstadoResultado } from '../api/tipos'

interface Props {
  estado: EstadoResultado
  /** Para explicar por qué no hay criterio. */
  motivoSinReferencia?: string
}

export function EstadoLab({ estado, motivoSinReferencia }: Props) {
  if (estado === 'sin_referencia') {
    return (
      <span
        className="rounded-pill bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted"
        title={motivoSinReferencia ?? 'La clínica no ha definido rango para este analito'}
      >
        Sin referencia
      </span>
    )
  }

  const token = estado === 'alterado' ? 'var(--status-alert)' : 'var(--status-normal)'

  return (
    <span className="badge-estado" style={{ '--estado-color': token } as CSSProperties}>
      {estado === 'alterado' ? 'Alterado' : 'Normal'}
    </span>
  )
}

/** Muestra el rango tal como se aplicó, incluidos los de una sola cara. */
export function RangoTexto({
  rango,
  unidad,
}: {
  rango: { minimo: number | null; maximo: number | null } | null
  unidad: string
}) {
  if (!rango) return <span className="text-xs text-muted">—</span>

  const { minimo, maximo } = rango
  let texto: string
  if (minimo !== null && maximo !== null) texto = `${minimo} – ${maximo}`
  else if (minimo !== null) texto = `≥ ${minimo}`
  else if (maximo !== null) texto = `≤ ${maximo}`
  else texto = '—'

  return (
    <span className="text-xs text-muted">
      {texto} {unidad}
    </span>
  )
}
