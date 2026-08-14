/**
 * Rejilla del plan en modo LECTURA (CLI-09).
 *
 * Siete columnas por seis filas. Solo se muestran las filas que tienen
 * al menos una comida: un plan que solo prescribe desayuno y cena no
 * necesita cuatro filas vacías empujando la tabla.
 */
import { DIAS, TIPOS_COMIDA, type ComidaPlan } from '../api/planes'

export function PlanGrilla({ dias }: { dias: Record<string, ComidaPlan[]> }) {
  // Mapa plano 'dia_tipo' → comida, para no recorrer la lista en cada celda.
  const mapa = new Map<string, ComidaPlan>()
  for (const [dia, comidas] of Object.entries(dias)) {
    for (const c of comidas) mapa.set(`${dia}_${c.tipoComida}`, c)
  }

  const filas = TIPOS_COMIDA.filter((t) => DIAS.some((d) => mapa.has(`${d.numero}_${t.clave}`)))

  if (filas.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-muted">
        Este plan aún no tiene comidas. Usa «Editar comidas» para cargarlas.
      </p>
    )
  }

  const total = [...mapa.values()].reduce((suma, c) => suma + (c.caloriasKcal ?? 0), 0)

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="w-28 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Comida
              </th>
              {DIAS.map((d) => (
                <th
                  key={d.numero}
                  scope="col"
                  className="min-w-[7.5rem] px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted"
                >
                  <abbr title={d.largo} className="no-underline">
                    {d.corto}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((tipo) => (
              <tr key={tipo.clave} className="border-t border-border align-top">
                <th
                  scope="row"
                  className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink"
                >
                  {tipo.etiqueta}
                </th>
                {DIAS.map((d) => {
                  const c = mapa.get(`${d.numero}_${tipo.clave}`)
                  return (
                    <td key={d.numero} className="px-2 py-2">
                      {c ? (
                        <div className="rounded-md bg-surface-2 p-2">
                          <p className="text-xs text-ink">{c.descripcion}</p>
                          {c.caloriasKcal !== null && (
                            <p className="mt-1 text-xs tabular-nums text-muted">
                              {c.caloriasKcal} kcal
                            </p>
                          )}
                        </div>
                      ) : (
                        // Celda vacía explícita: un hueco sin nada se lee
                        // como un fallo de carga.
                        <div className="h-10 rounded-md border border-dashed border-border" />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <p className="text-right text-xs text-muted">
          {/* Suma de lo declarado, no un objetivo calórico: los macros son
              opcionales y el total no dice cuántas celdas los traen. */}
          Total declarado en la semana:{' '}
          <span className="font-semibold tabular-nums text-ink">
            {total.toLocaleString('es-CR')} kcal
          </span>
        </p>
      )}
    </div>
  )
}
