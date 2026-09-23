/**
 * Tendencia de la clínica y exportación — GAM-03.
 *
 * Va debajo del dashboard de la Rebanada 8, en la misma pantalla. Aquel
 * responde «qué pasa hoy»; esto responde «cómo va la clínica». Dos
 * entradas de menú llamadas «Dashboard» habrían sido peor que una
 * pantalla con dos secciones.
 */
import { useEffect, useState } from 'react'
import { ApiError, apiDescargar, apiGet } from '../../api/client'

interface Mes {
  mes: string
  citas: number
  completadas: number
  noAsistio: number
  altas: number
}

interface Estadisticas {
  pacientes: { activos: number; inactivos: number; altasEsteMes: number }
  adherencia: {
    pct: number | null
    conApp: number
    activos: number
    diasConRegistro: number
  }
  meses: Mes[]
  profesionales: {
    nombre: string
    rol: string
    pacientes: number
    citas90d: number
    completadas90d: number
  }[]
}

function etiquetaMes(m: string): string {
  const [a, mm] = m.split('-')
  return new Date(Number(a), Number(mm) - 1, 1).toLocaleDateString('es-CR', { month: 'short' })
}

/**
 * Doce meses de citas, en barras.
 *
 * Las completadas se dibujan dentro de la barra total, no al lado: son
 * un subconjunto, y ponerlas en paralelo haría creer que se suman.
 */
function BarrasCitas({ meses }: { meses: Mes[] }) {
  const max = Math.max(1, ...meses.map((m) => m.citas))

  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {meses.map((m) => {
          const alturaTotal = (m.citas / max) * 100
          const alturaHechas = m.citas === 0 ? 0 : (m.completadas / m.citas) * 100
          return (
            <div key={m.mes} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="relative w-full rounded-t-sm bg-surface-2"
                style={{ height: `${Math.max(alturaTotal, 2)}%` }}
                title={`${m.mes}: ${m.citas} citas, ${m.completadas} completadas`}
              >
                <div
                  className="absolute bottom-0 w-full rounded-t-sm bg-primary"
                  style={{ height: `${alturaHechas}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1">
        {meses.map((m) => (
          <span key={m.mes} className="flex-1 text-center text-[0.6rem] text-muted">
            {etiquetaMes(m.mes)}
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-primary" aria-hidden="true" /> Completadas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-surface-2" aria-hidden="true" /> Agendadas
        </span>
      </div>
    </div>
  )
}

export function Tendencia() {
  const [datos, setDatos] = useState<Estadisticas | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [bajando, setBajando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<Estadisticas>('/api/admin/estadisticas')
      .then(setDatos)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'No se pudo cargar'))
  }, [])

  async function descargar(que: 'pacientes' | 'citas') {
    setBajando(true)
    setError(null)
    try {
      const p = new URLSearchParams()
      if (que === 'citas') {
        if (desde) p.set('desde', desde)
        if (hasta) p.set('hasta', hasta)
      }
      const cola = p.toString()
      await apiDescargar(
        `/api/admin/exportar/${que}${cola ? `?${cola}` : ''}`,
        `${que}.csv`,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo exportar')
    } finally {
      setBajando(false)
    }
  }

  if (error && !datos) {
    return (
      <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
        {error}
      </p>
    )
  }
  if (!datos) return <div className="h-64 animate-pulse rounded-lg bg-surface-2" />

  const ad = datos.adherencia

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">Cómo va la clínica</h2>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-3 font-semibold text-ink">Citas y altas, últimos 12 meses</h3>
          <BarrasCitas meses={datos.meses} />
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted">
            {datos.pacientes.altasEsteMes} altas este mes · {datos.pacientes.activos} pacientes
            activos
            {datos.pacientes.inactivos > 0 && ` · ${datos.pacientes.inactivos} dados de baja`}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
          <h3 className="font-semibold text-ink">Uso de la aplicación</h3>
          <p className="mb-3 mt-0.5 text-xs text-muted">Últimos 7 días.</p>

          {ad.pct === null ? (
            <p className="text-sm text-muted">
              Ningún paciente tiene todavía la aplicación activada. Sin eso no hay adherencia
              que medir.
            </p>
          ) : (
            <>
              <p className="text-3xl font-bold text-ink">
                {ad.pct}
                <span className="ml-1 text-base font-normal text-muted">%</span>
              </p>
              <div className="mt-2 h-2.5 overflow-hidden rounded-pill bg-surface-2">
                <div
                  className="h-full rounded-pill bg-primary"
                  style={{ width: `${Math.min(ad.pct, 100)}%` }}
                />
              </div>
              {/* Se dice sobre cuántos se calcula. Un porcentaje sin
                  denominador es un número, no una medida. */}
              <p className="mt-2 text-xs text-muted">
                {ad.diasConRegistro} de {ad.conApp * 7} días posibles, sobre{' '}
                {ad.conApp} {ad.conApp === 1 ? 'paciente' : 'pacientes'} con la aplicación
                activada.
                {ad.activos > ad.conApp && (
                  <>
                    {' '}
                    Los otros {ad.activos - ad.conApp} no la tienen todavía y no cuentan: no
                    pueden apuntar nada.
                  </>
                )}
              </p>
            </>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-3 font-semibold text-ink">Por profesional, últimos 90 días</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-1.5 font-medium">Profesional</th>
              <th className="py-1.5 font-medium">Pacientes</th>
              <th className="py-1.5 font-medium">Citas</th>
              <th className="py-1.5 font-medium">Completadas</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {datos.profesionales.map((p) => (
              <tr key={p.nombre}>
                <td className="py-1.5 text-ink">
                  {p.nombre}
                  {p.rol === 'admin_clinica' && (
                    <span className="ml-2 text-xs text-muted">admin</span>
                  )}
                </td>
                <td className="py-1.5 tabular-nums text-ink">{p.pacientes}</td>
                <td className="py-1.5 tabular-nums text-muted">{p.citas90d}</td>
                <td className="py-1.5 tabular-nums text-muted">
                  {p.completadas90d}
                  {/* Un porcentaje sobre cero citas leería como "0 % de
                      cumplimiento", que no es lo que pasa. */}
                  {p.citas90d > 0 && (
                    <span className="ml-1 text-xs">
                      ({Math.round((p.completadas90d / p.citas90d) * 100)} %)
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
        <h3 className="font-semibold text-ink">Exportar</h3>
        <p className="mb-3 mt-0.5 text-xs text-muted">
          Archivos CSV, listos para abrir en una hoja de cálculo. Contienen datos personales de
          pacientes: guárdalos donde corresponda.
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={() => void descargar('pacientes')}
            disabled={bajando}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:border-primary disabled:opacity-60"
          >
            Pacientes
          </button>

          <div className="flex items-end gap-2">
            <div>
              <label htmlFor="exp-desde" className="mb-0.5 block text-xs text-muted">
                Desde
              </label>
              <input
                id="exp-desde"
                type="date"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </div>
            <div>
              <label htmlFor="exp-hasta" className="mb-0.5 block text-xs text-muted">
                Hasta
              </label>
              <input
                id="exp-hasta"
                type="date"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink"
              />
            </div>
            <button
              type="button"
              onClick={() => void descargar('citas')}
              disabled={bajando}
              className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:border-primary disabled:opacity-60"
            >
              Citas
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">Sin fechas, las citas salen del último mes.</p>

        {error && (
          <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
