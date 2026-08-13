/**
 * Dashboard administrativo de la clínica — CLI-08.
 *
 * Solo lo ve un `admin_clinica`. La API responde 403 igualmente: lo de
 * aquí decide qué se pinta, no quién puede.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ETIQUETA_PERIODO,
  PERIODOS,
  getDashboard,
  type Dashboard,
  type Periodo,
} from '../api/admin'
import { KpiTile } from '../components/KpiTile'
import { AgendaHoy } from '../components/AgendaHoy'
import { TablaProfesionales } from '../components/TablaProfesionales'

/** '2026-08-01T06:00:00Z' → '1 de agosto'. */
function diaLegible(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'long' })
}

export function DashboardPage() {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [datos, setDatos] = useState<Dashboard | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(
    (signal?: AbortSignal) => {
      setCargando(true)
      getDashboard(periodo, signal)
        .then((d) => {
          if (signal?.aborted) return
          setDatos(d)
          setError(null)
        })
        .catch((e: unknown) => {
          if (signal?.aborted) return
          if (e instanceof DOMException && e.name === 'AbortError') return
          setError(e instanceof Error ? e.message : 'No se pudo cargar el dashboard')
        })
        .finally(() => {
          if (!signal?.aborted) setCargando(false)
        })
    },
    [periodo],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  const k = datos?.kpis

  /**
   * Sin citas no hay porcentaje: un "0 %" leería como "ninguna de las
   * que había", que es distinto de "no había ninguna".
   */
  function pct(parte: number | undefined): string | undefined {
    if (!k || k.citasTotal === 0 || parte === undefined) return undefined
    return `${((parte / k.citasTotal) * 100).toFixed(1)} % del total`
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
          <p className="text-sm text-muted">
            Actividad de la clínica.{' '}
            {datos && (
              <>
                Del {diaLegible(datos.desde)} al {diaLegible(datos.hasta)}.
              </>
            )}
          </p>
        </div>

        {/* Los tres botones son un grupo excluyente: radiogroup, no una
            fila de botones sueltos, para que el lector de pantalla
            anuncie cuál está elegido. */}
        <div role="radiogroup" aria-label="Período" className="flex gap-1">
          {PERIODOS.map((p) => {
            const activo = p === periodo
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => setPeriodo(p)}
                className={
                  activo
                    ? 'rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white'
                    : 'rounded-md border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface-2'
                }
              >
                {ETIQUETA_PERIODO[p]}
              </button>
            )
          })}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-4 text-sm text-ink"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={() => cargar()}
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
          >
            Reintentar
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile etiqueta="Citas del período" valor={k?.citasTotal ?? 0} cargando={cargando} />
        <KpiTile
          etiqueta="Completadas"
          valor={k?.citasCompletadas ?? 0}
          secundario={pct(k?.citasCompletadas)}
          cargando={cargando}
        />
        <KpiTile
          etiqueta="Canceladas"
          valor={k?.citasCanceladas ?? 0}
          secundario={pct(k?.citasCanceladas)}
          // Solo se tiñe si hay alguna: un cero en rojo daría una
          // alarma sobre la ausencia del problema.
          claseColor={(k?.citasCanceladas ?? 0) > 0 ? 'text-[color:var(--status-critical)]' : 'text-ink'}
          cargando={cargando}
        />
        <KpiTile
          etiqueta="Pendientes"
          valor={k?.citasPendientes ?? 0}
          secundario={pct(k?.citasPendientes)}
          cargando={cargando}
        />
        <KpiTile
          etiqueta="Pacientes activos"
          valor={k?.pacientesActivos ?? 0}
          secundario="en toda la clínica"
          cargando={cargando}
        />
        <KpiTile
          etiqueta="Nuevos en el período"
          valor={k?.pacientesNuevos ?? 0}
          cargando={cargando}
        />
      </div>

      {/* Controles y laboratorios van aparte de la rejilla de citas: son
          otra unidad de medida y mezclarlos invita a compararlos. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile
          etiqueta="Controles registrados"
          valor={k?.snapshotsCreados ?? 0}
          cargando={cargando}
        />
        <KpiTile
          etiqueta="Laboratorios cargados"
          valor={k?.examenesSubidos ?? 0}
          cargando={cargando}
        />
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-ink">Agenda de hoy</h2>
        {cargando ? (
          <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <AgendaHoy citas={datos?.agendaHoy ?? []} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-ink">Por profesional</h2>
        {cargando ? (
          <div className="h-32 animate-pulse rounded-lg bg-surface-2" />
        ) : (
          <TablaProfesionales profesionales={datos?.porProfesional ?? []} />
        )}
      </section>
    </div>
  )
}
