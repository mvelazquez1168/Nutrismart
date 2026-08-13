/**
 * Indicador de tendencia de una métrica.
 *
 * Deliberadamente NEUTRO en color. Pintar de verde una bajada de peso
 * sería un juicio clínico que la interfaz no puede hacer: en un paciente
 * con desnutrición esa misma flecha es una alarma. Se muestra la
 * dirección y la magnitud; interpretarlas es del profesional.
 *
 * `delta` null (no hay punto previo) y delta 0 (no cambió) son casos
 * distintos y se ven distintos.
 */
import type { MetricaValor } from '../api/tipos'

export function Tendencia({ metrica }: { metrica: MetricaValor }) {
  if (metrica.delta === null) {
    return (
      <span className="text-xs text-muted" title="Primer registro, sin comparación previa">
        —
      </span>
    )
  }

  if (metrica.delta === 0) {
    return <span className="text-xs text-muted">Sin cambio</span>
  }

  const sube = metrica.delta > 0
  const signo = sube ? '+' : '−'
  const magnitud = Math.abs(metrica.delta)

  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-medium text-muted"
      title={`Anterior: ${metrica.anterior} ${metrica.unidad}`}
    >
      <span aria-hidden="true">{sube ? '↑' : '↓'}</span>
      {signo}
      {magnitud} {metrica.unidad}
    </span>
  )
}
