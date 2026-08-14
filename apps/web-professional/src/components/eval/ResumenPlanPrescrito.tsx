/**
 * Plan alimentario vigente, visto desde la valoración — EVAL-07.
 *
 * Solo lectura. El plan se edita en su propia pestaña del expediente:
 * dos sitios donde tocar lo mismo acaban discrepando, y aquí lo que
 * hace falta es comprobar qué se le prescribió, no cambiarlo.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DIAS, TIPOS_COMIDA, getPlan, getPlanes, type PlanDetalle } from '../../api/planes'

export function ResumenPlanPrescrito({ pacienteId }: { pacienteId: string }) {
  const [plan, setPlan] = useState<PlanDetalle | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)

    getPlanes(pacienteId, ctrl.signal)
      .then(async (lista) => {
        const activo = lista.find((p) => p.estado === 'activo')
        if (!activo || ctrl.signal.aborted) return null
        return getPlan(activo.id, ctrl.signal)
      })
      .then((detalle) => {
        if (!ctrl.signal.aborted) setPlan(detalle ?? null)
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })

    return () => ctrl.abort()
  }, [pacienteId])

  if (cargando) return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />

  if (!plan) {
    return (
      <section className="rounded-lg border border-border bg-surface p-8 text-center">
        <p className="text-sm font-medium text-ink">Sin plan de alimentación activo</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          La prescripción de esta valoración indica cuánto y cómo; el plan concreta qué se come
          cada día.
        </p>
        <Link
          to={`/pacientes/${pacienteId}`}
          className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover"
        >
          Crear plan alimentario
        </Link>
      </section>
    )
  }

  const ocupadas = new Set<string>()
  let totalKcal = 0
  for (const [dia, comidas] of Object.entries(plan.dias)) {
    for (const c of comidas) {
      ocupadas.add(`${dia}_${c.tipoComida}`)
      totalKcal += c.caloriasKcal ?? 0
    }
  }

  // Solo las filas con algo: un plan de desayuno y cena no necesita seis
  // filas vacías empujando la rejilla, como en la pestaña del plan.
  const filas = TIPOS_COMIDA.filter((t) => DIAS.some((d) => ocupadas.has(`${d.numero}_${t.clave}`)))

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold text-ink">{plan.nombre}</h3>
          <span
            className="rounded-pill px-2 py-0.5 text-xs font-semibold"
            style={{
              color: 'var(--status-normal)',
              backgroundColor: 'color-mix(in srgb, var(--status-normal) 14%, transparent)',
            }}
          >
            Activo
          </span>
        </div>
        <Link
          to={`/pacientes/${pacienteId}`}
          className="text-sm font-medium text-primary hover:underline"
        >
          Editar el plan completo →
        </Link>
      </div>

      {plan.objetivo && <p className="text-sm text-muted">{plan.objetivo}</p>}

      {filas.length === 0 ? (
        <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted">
          El plan está activo pero aún no tiene comidas cargadas.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="w-24 px-2 py-1 text-left font-medium text-muted">Comida</th>
                  {DIAS.map((d) => (
                    <th key={d.numero} className="px-1 py-1 text-center font-medium text-muted">
                      {d.corto}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filas.map((t) => (
                  <tr key={t.clave}>
                    <th scope="row" className="px-2 py-1 text-left font-medium text-ink">
                      {t.etiqueta}
                    </th>
                    {DIAS.map((d) => {
                      const hay = ocupadas.has(`${d.numero}_${t.clave}`)
                      return (
                        <td key={d.numero} className="px-1 py-1">
                          {/* Rejilla de presencia, no de contenido: dice
                              qué días están cubiertos de un vistazo. */}
                          <span
                            aria-label={hay ? 'Con comida' : 'Sin comida'}
                            className={`mx-auto block h-5 rounded-sm ${
                              hay ? 'bg-primary-tint' : 'border border-dashed border-border'
                            }`}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalKcal > 0 && (
            <p className="text-right text-xs text-muted">
              Total declarado en la semana:{' '}
              <span className="font-semibold tabular-nums text-ink">
                {totalKcal.toLocaleString('es-CR')} kcal
              </span>
            </p>
          )}
        </>
      )}
    </section>
  )
}
