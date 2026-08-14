/**
 * Evolución desde la consulta anterior — EVAL-08.
 *
 * Muestra la DIRECCIÓN y la magnitud del cambio, no si el cambio es
 * bueno o malo. Bajar dos kilos es un logro en un paciente con obesidad
 * y una señal de alarma en uno desnutrido; sin un objetivo registrado,
 * pintar la flecha de verde afirmaría algo que nadie ha comprobado.
 *
 * La flecha y el signo son aritmética. La lectura la pone quien atiende.
 */
import { useEffect, useState } from 'react'
import { getComparativa, type Comparativa, type Indicador } from '../../api/seguimiento'

const DESTACADOS = ['pesoKg', 'pctGrasa', 'masaLibreGrasaKg', 'anguloFase']

function Flecha({ direccion }: { direccion: Indicador['direccion'] }) {
  if (direccion === null || direccion === 'igual') return <span aria-hidden="true">→</span>
  return <span aria-hidden="true">{direccion === 'sube' ? '↑' : '↓'}</span>
}

function textoDelta(i: Indicador): string {
  if (i.delta === null) return '—'
  const signo = i.delta > 0 ? '+' : ''
  return `${signo}${i.delta} ${i.unidad}`.trim()
}

function Tarjeta({ indicador }: { indicador: Indicador }) {
  const i = indicador
  return (
    <li className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{i.etiqueta}</p>

      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-ink">
          {i.actual ?? '—'}
          {i.actual !== null && i.unidad && (
            <span className="ml-1 text-sm font-normal text-muted">{i.unidad}</span>
          )}
        </span>
      </p>

      {i.anterior !== null && (
        <p className="mt-0.5 text-xs text-muted">
          antes {i.anterior} {i.unidad}
        </p>
      )}

      {i.delta !== null && (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink">
          <Flecha direccion={i.direccion} />
          {textoDelta(i)}
          {i.pctCambio !== null && (
            <span className="font-normal text-muted">
              ({i.pctCambio > 0 ? '+' : ''}
              {i.pctCambio} %)
            </span>
          )}
        </p>
      )}
    </li>
  )
}

export function DashboardDeltaConsultas({
  pacienteId,
  consultaId,
}: {
  pacienteId: string
  consultaId: string
}) {
  const [datos, setDatos] = useState<Comparativa | null>(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    getComparativa(pacienteId, consultaId, ctrl.signal)
      .then((d) => {
        if (!ctrl.signal.aborted) setDatos(d)
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId, consultaId])

  if (cargando) return <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
  if (!datos || !datos.anterior) return null

  const conDelta = datos.indicadores.filter((i) => i.delta !== null)
  const destacados = conDelta.filter((i) => DESTACADOS.includes(i.clave))
  const resto = conDelta.filter((i) => !DESTACADOS.includes(i.clave))

  if (conDelta.length === 0) {
    return (
      <section className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-sm font-medium text-ink">Aún no hay nada que comparar</p>
        <p className="mt-1 text-sm text-muted">
          Registra las medidas de hoy y aquí verás el cambio respecto a la consulta anterior.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold text-ink">Evolución desde la consulta anterior</h2>
        <p className="text-sm text-muted">
          {datos.anterior.consulta.fechaConsulta} → {datos.actual.consulta.fechaConsulta}
          {datos.diasEntre !== null && datos.diasEntre > 0 && ` · ${datos.diasEntre} días`}
        </p>
      </div>

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {destacados.map((i) => (
          <Tarjeta key={i.clave} indicador={i} />
        ))}

        {datos.acuerdos.total > 0 && (
          <li className="rounded-lg border border-border bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-muted">Acuerdos anteriores</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
              {datos.acuerdos.cumplidos}
              <span className="text-sm font-normal text-muted"> de {datos.acuerdos.total}</span>
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {datos.acuerdos.detalle.map((a) => (
                <li key={a.texto} className="truncate text-xs text-muted">
                  <span aria-hidden="true">{a.cumplido ? '●' : '○'}</span> {a.texto}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>

      {resto.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {['Indicador', 'Anterior', 'Actual', 'Cambio'].map((h) => (
                  <th
                    key={h}
                    className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted ${
                      h === 'Indicador' ? '' : 'text-right'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {resto.map((i) => (
                <tr key={i.clave}>
                  <td className="px-4 py-2 text-ink">{i.etiqueta}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted">
                    {i.anterior ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">{i.actual ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink">
                    <Flecha direccion={i.direccion} /> {textoDelta(i)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        Las flechas indican en qué dirección se movió cada valor. No dicen si el cambio es bueno o
        malo: eso depende del objetivo de cada paciente.
      </p>
    </section>
  )
}
