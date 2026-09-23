/**
 * Encabezado del plan alimentario en Conclusiones — R39.
 *
 * Muestra, en solo lectura, lo que la calculadora dejó y el backend
 * persistió: meta calórica, método de dieta, distribución de macros (con
 * g/kg) y las líneas de intercambio con porciones. Se hidrata desde la
 * conclusión guardada, así que aparece al abrir la valoración sin reabrir
 * la calculadora; al aplicar la calculadora de nuevo, se actualiza.
 */
import { METODOS_DIETA, type DatosCalculadora } from '../../lib/calculadoraNutricion'

export function PlanAlimentarioCard({ datos }: { datos: DatosCalculadora | null }) {
  if (!datos) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-4 text-sm text-muted">
        Abre la calculadora para definir la meta calórica y la distribución de macros.
      </div>
    )
  }

  const m = datos.distribucionMacros
  const macros = [
    { n: 'CHO', pct: m.choPct, g: m.choG, gk: m.choGkg },
    { n: 'Prot', pct: m.protPct, g: m.protG, gk: m.protGkg },
    { n: 'Grasa', pct: m.grasaPct, g: m.grasaG, gk: m.grasaGkg },
  ]

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">
          Meta calórica{' '}
          <span className="tabular-nums text-primary">{datos.metaCalorica.toLocaleString('es-CR')}</span>{' '}
          kcal/día
        </p>
        <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
          Método: {METODOS_DIETA[datos.metodoDieta].etiqueta}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {macros.map((x) => (
          <div key={x.n} className="rounded-md bg-surface-2 p-2 text-center">
            <p className="text-xs text-muted">{x.n}</p>
            <p className="text-sm font-semibold tabular-nums text-ink">
              {x.pct}% · {x.g} g
            </p>
            <p className="text-xs tabular-nums text-muted">{x.gk} g/kg</p>
          </div>
        ))}
      </div>

      {datos.listasIntercambio.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Distribución de Macros
          </p>
          {/* Un card por grupo con porciones > 0; fluyen en filas y en
              móvil se apilan solos por el flex-wrap. */}
          <div className="flex flex-wrap gap-2">
            {datos.listasIntercambio.map((l) => (
              <div
                key={l.grupo}
                className="flex min-w-[90px] flex-col items-center rounded-md border border-border bg-surface px-3 py-2 shadow-sm"
              >
                <span className="text-center text-xs leading-tight text-muted">{l.grupo}</span>
                <span className="mt-1 text-lg font-bold tabular-nums text-ink">{l.porciones}</span>
                <span className="text-xs text-muted">porciones</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
