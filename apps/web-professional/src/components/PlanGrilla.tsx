/**
 * Plan alimentario en modo LECTURA (CLI-09 / R38).
 *
 * Tres columnas —tiempo de comida, patrón y ejemplo de menú— por los
 * tiempos que tengan algo escrito. Una franja sin patrón ni ejemplo es
 * «no hay comida prescrita» y no ocupa fila.
 */
import { TIPOS_COMIDA, type ComidaPlan } from '../api/planes'

export function PlanGrilla({ comidas }: { comidas: ComidaPlan[] }) {
  const mapa = new Map(comidas.map((c) => [c.tipoComida, c]))
  const filas = TIPOS_COMIDA.filter((t) => {
    const c = mapa.get(t.clave)
    return c && ((c.patron ?? '') !== '' || (c.ejemploMenu ?? '') !== '')
  })

  if (filas.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        Este plan aún no tiene comidas. Usa «Editar comidas» para cargarlas.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            <th
              scope="col"
              className="w-40 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Tiempo de comida
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Patrón
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted"
            >
              Ejemplo de menú
            </th>
          </tr>
        </thead>
        <tbody>
          {filas.map((t) => {
            const c = mapa.get(t.clave)!
            return (
              <tr key={t.clave} className="border-t border-border align-top">
                <th
                  scope="row"
                  className="w-40 whitespace-nowrap bg-surface-2 px-3 py-2 text-left text-xs font-medium text-ink"
                >
                  {t.etiqueta}
                </th>
                <td className="whitespace-pre-wrap px-3 py-2 text-ink">{c.patron ?? '—'}</td>
                <td className="whitespace-pre-wrap px-3 py-2 text-ink">{c.ejemploMenu ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
