/**
 * Tarjeta de métricas vitales del Resumen.
 *
 * Muestra el ÚLTIMO valor cerrado de cada métrica, que no tiene por qué
 * venir del mismo control: si en la última consulta no se midió la
 * cintura, sigue vigente la del control anterior. Por eso cada métrica
 * lleva su propia fecha.
 */
import type { MetricaValor } from '../api/tipos'
import { Tendencia } from './Tendencia'

function formatearFecha(iso: string | undefined): string {
  if (!iso) return ''
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

export function MetricasVitales({ metricas }: { metricas: MetricaValor[] }) {
  if (metricas.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-border bg-surface p-5">
        <h2 className="mb-1 font-semibold text-muted">Métricas y evolución</h2>
        <p className="text-sm text-muted">
          Aún sin registros — se llenan al cerrar el primer punto de control.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <h2 className="mb-4 font-semibold text-ink">Métricas vitales</h2>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {metricas.map((m) => (
          <div key={m.codigo}>
            <dt className="text-xs uppercase tracking-wide text-muted">{m.nombre}</dt>
            <dd>
              <span className="text-lg font-semibold text-ink">{m.valor}</span>
              <span className="ml-1 text-sm text-muted">{m.unidad}</span>
              <div className="mt-0.5 flex items-center gap-2">
                <Tendencia metrica={m} />
                {m.fecha && <span className="text-xs text-muted">{formatearFecha(m.fecha)}</span>}
              </div>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
