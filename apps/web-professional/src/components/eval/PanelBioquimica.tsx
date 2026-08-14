/**
 * Bioquímica de la valoración — EVAL-02.
 *
 * Relee los laboratorios ya cargados; no se capturan valores aquí. Los
 * grupos son los del catálogo de biomarcadores, no una clasificación
 * propia de esta pantalla: así el informe y la valoración hablan de lo
 * mismo.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getBioquimica, marcarSeccion, type Bioquimica, type EstadoMarcador } from '../../api/valoracion'

const COLOR: Record<EstadoMarcador, string> = {
  normal: 'var(--status-normal)',
  bajo: 'var(--status-alert)',
  alto: 'var(--status-alert)',
  sin_referencia: 'var(--muted)',
}

const ETIQUETA: Record<EstadoMarcador, string> = {
  normal: 'Normal',
  bajo: 'Bajo',
  alto: 'Alto',
  sin_referencia: 'Sin referencia',
}

function ChipEstado({ estado }: { estado: EstadoMarcador }) {
  return (
    <span
      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
      style={{
        color: COLOR[estado],
        backgroundColor: `color-mix(in srgb, ${COLOR[estado]} 14%, transparent)`,
      }}
    >
      {ETIQUETA[estado]}
    </span>
  )
}

function rangoTexto(rango: { minimo: number | null; maximo: number | null } | null): string {
  if (!rango || (rango.minimo === null && rango.maximo === null)) return '—'
  if (rango.minimo !== null && rango.maximo !== null) return `${rango.minimo} – ${rango.maximo}`
  if (rango.minimo !== null) return `≥ ${rango.minimo}`
  return `≤ ${rango.maximo}`
}

export function PanelBioquimica({
  pacienteId,
  consultaId,
  bloqueada,
  onGuardado,
}: {
  pacienteId: string
  consultaId: string
  bloqueada: boolean
  onGuardado: () => void | Promise<void>
}) {
  const [datos, setDatos] = useState<Bioquimica | null>(null)
  const [cargando, setCargando] = useState(true)
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [marcando, setMarcando] = useState(false)

  useEffect(() => {
    const ctrl = new AbortController()
    setCargando(true)
    getBioquimica(pacienteId, 90, ctrl.signal)
      .then((d) => {
        if (ctrl.signal.aborted) return
        setDatos(d)
        // Se despliegan solos los grupos con algo alterado: es lo que hay
        // que mirar, y obligar a abrirlos uno a uno esconde justo eso.
        setAbiertos(new Set(d.grupos.filter((g) => g.tieneAlterados).map((g) => g.nombre)))
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e instanceof ApiError ? e.message : 'No se pudo cargar la bioquímica')
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [pacienteId])

  async function marcarCompleta() {
    setMarcando(true)
    try {
      await marcarSeccion(pacienteId, consultaId, 'bioquim', true)
      await onGuardado()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo marcar la sección')
    } finally {
      setMarcando(false)
    }
  }

  if (cargando) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  if (error) {
    return (
      <p
        role="alert"
        className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
      >
        {error}
      </p>
    )
  }

  if (!datos || datos.totalMarcadores === 0) {
    return (
      <div
        className="rounded-lg border bg-surface p-6 text-center"
        style={{ borderColor: 'var(--status-alert)' }}
      >
        <p className="text-sm font-medium text-ink">Sin laboratorios en los últimos 90 días</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          La bioquímica de la valoración se construye con los estudios ya cargados en el
          expediente; aquí no se capturan valores.
        </p>
        <Link
          to={`/pacientes/${pacienteId}`}
          className="mt-3 inline-block rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2"
        >
          Ir a Laboratorios
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
        <div>
          <p className="text-sm font-semibold text-ink">
            Último estudio: {datos.fechaMasReciente ?? '—'}
          </p>
          <p className="text-xs text-muted">
            {datos.totalMarcadores} marcadores · se muestra el valor más reciente de cada uno
          </p>
        </div>
        <span
          className="rounded-pill px-3 py-1 text-xs font-semibold"
          style={{
            color: datos.marcadoresAlterados > 0 ? 'var(--status-alert)' : 'var(--status-normal)',
            backgroundColor: `color-mix(in srgb, ${
              datos.marcadoresAlterados > 0 ? 'var(--status-alert)' : 'var(--status-normal)'
            } 14%, transparent)`,
          }}
        >
          {datos.marcadoresAlterados > 0
            ? `${datos.marcadoresAlterados} fuera de rango`
            : 'Todo dentro de rango'}
        </span>
      </div>

      {datos.alterados.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Marcadores a revisar
          </p>
          <ul className="flex flex-wrap gap-2">
            {datos.alterados.map((m) => (
              <li key={m.codigo}>
                <span className="rounded-pill bg-surface-2 px-2.5 py-1 text-xs text-ink">
                  {m.nombre} · {ETIQUETA[m.estado].toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-2">
        {datos.grupos.map((g) => {
          const abierto = abiertos.has(g.nombre)
          return (
            <li key={g.nombre} className="overflow-hidden rounded-lg border border-border bg-surface">
              <button
                type="button"
                aria-expanded={abierto}
                onClick={() =>
                  setAbiertos((prev) => {
                    const s = new Set(prev)
                    if (s.has(g.nombre)) s.delete(g.nombre)
                    else s.add(g.nombre)
                    return s
                  })
                }
                className="flex w-full items-center justify-between gap-2 bg-surface-2 px-4 py-2.5 text-left"
              >
                <span className="text-sm font-semibold text-ink">
                  {g.nombre}
                  <span className="ml-2 font-normal text-muted">
                    {g.marcadores.length} marcador{g.marcadores.length === 1 ? '' : 'es'}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {g.tieneAlterados && (
                    <span
                      className="rounded-pill px-2 py-0.5 text-xs font-semibold"
                      style={{
                        color: 'var(--status-alert)',
                        backgroundColor: 'color-mix(in srgb, var(--status-alert) 14%, transparent)',
                      }}
                    >
                      Revisar
                    </span>
                  )}
                  <span aria-hidden="true" className="text-muted">
                    {abierto ? '−' : '+'}
                  </span>
                </span>
              </button>

              {abierto && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          Marcador
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                          Valor
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted">
                          Referencia
                        </th>
                        <th className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                          Estado
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {g.marcadores.map((m) => (
                        <tr key={m.codigo}>
                          <td className="px-4 py-2 text-ink">{m.nombre}</td>
                          <td className="px-4 py-2 text-right tabular-nums text-ink">
                            {m.valor} {m.unidad}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-muted">
                            {rangoTexto(m.rango)}
                          </td>
                          <td className="px-4 py-2">
                            <ChipEstado estado={m.estado} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted">
        «Bajo» y «alto» son aritmética contra el rango declarado por la clínica, no un diagnóstico.
      </p>

      {!bloqueada && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void marcarCompleta()}
            disabled={marcando}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {marcando ? 'Guardando…' : 'Marcar bioquímica revisada'}
          </button>
        </div>
      )}
    </div>
  )
}
