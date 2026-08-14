/**
 * Reglas de notificación automática — COM-03.
 *
 * Son de la CLÍNICA, no de quien las creó: describen cómo trabaja el
 * centro. Cualquier profesional las ve y las edita.
 *
 * Tarjetas y no tabla, como en el diseño: cada regla necesita una línea
 * de explicación en lenguaje llano, y en una celda no cabe.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  TIPOS_REGLA,
  activarRegla,
  eliminarRegla,
  evaluarReglas,
  getReglas,
  type Regla,
} from '../api/notificaciones'
import { ModalRegla } from '../components/notificaciones/ModalRegla'

const ICONO: Record<string, string> = {
  cumpleanos: '🎂',
  reminder: '⏰',
  checkup: '🩺',
  fecha_importante: '📌',
}

/** Qué hace la regla, en una frase, a partir de sus parámetros. */
function explicar(regla: Regla): string {
  const p = regla.parametros
  if (regla.tipo === 'cumpleanos') {
    return `El día del cumpleaños del paciente, a las ${String(p['hora'] ?? '09:00')}`
  }
  if (regla.tipo === 'reminder') {
    const dias = Number(p['diasAntes'] ?? 1)
    return `${dias} ${dias === 1 ? 'día' : 'días'} antes de cada cita, a las ${String(p['hora'] ?? '09:00')}`
  }
  if (regla.tipo === 'checkup') {
    return `Cuando un paciente lleva más de ${String(p['intervaloDias'] ?? 30)} días sin consulta`
  }
  return `El ${String(p['fecha'] ?? '—')} · «${String(p['mensaje'] ?? '')}»`
}

export function ReglasNotificacion() {
  const [reglas, setReglas] = useState<Regla[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const [modalAbierto, setModalAbierto] = useState(false)
  const [enEdicion, setEnEdicion] = useState<Regla | null>(null)

  const cargar = useCallback(async (signal?: AbortSignal) => {
    try {
      const lista = await getReglas(signal)
      if (!signal?.aborted) {
        setReglas(lista)
        setError(null)
      }
    } catch (e) {
      if (signal?.aborted) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las reglas')
    } finally {
      if (!signal?.aborted) setCargando(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  async function accion(fn: () => Promise<unknown>) {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    try {
      await fn()
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo completar la acción')
    } finally {
      setOcupado(false)
    }
  }

  async function evaluar() {
    setOcupado(true)
    setError(null)
    setAviso(null)
    try {
      const { generadas, reglasEvaluadas } = await evaluarReglas()
      setAviso(
        generadas === 0
          ? `Se evaluaron ${reglasEvaluadas} reglas y no había nada nuevo que avisar.`
          : `Se generaron ${generadas} ${generadas === 1 ? 'notificación' : 'notificaciones'}.`,
      )
      await cargar()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudieron evaluar las reglas')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Notificaciones automáticas</h1>
          <p className="text-sm text-muted">
            Reglas de la clínica que generan avisos solas según el estado de cada paciente.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void evaluar()}
            disabled={ocupado}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
          >
            Evaluar ahora
          </button>
          <button
            type="button"
            onClick={() => {
              setEnEdicion(null)
              setModalAbierto(true)
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
          >
            + Nueva regla
          </button>
        </div>
      </header>

      {aviso && (
        <p className="rounded-md border border-border bg-primary-tint p-3 text-sm text-primary">
          {aviso}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      {cargando ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      ) : reglas.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-10 text-center text-sm text-muted">
          Aún no hay reglas. Crea la primera para que la clínica avise sola.
        </p>
      ) : (
        <ul className="space-y-3">
          {reglas.map((r) => (
            <li
              key={r.id}
              className={`flex flex-wrap items-center gap-4 rounded-lg border bg-surface p-4 shadow-sm ${
                r.activa ? 'border-primary' : 'border-border opacity-60'
              }`}
            >
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-lg"
              >
                {ICONO[r.tipo] ?? '🔔'}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{r.nombre}</span>
                  <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs text-muted">
                    {TIPOS_REGLA.find((t) => t.clave === r.tipo)?.etiqueta ?? r.tipo}
                  </span>
                  {!r.activa && (
                    <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs text-muted line-through">
                      Inactiva
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-muted">{explicar(r)}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {/* Interruptor real: un checkbox con apariencia de switch
                    conserva teclado y lector de pantalla. */}
                <label className="flex cursor-pointer items-center gap-2">
                  <span className="sr-only">
                    {r.activa ? 'Desactivar regla' : 'Activar regla'}
                  </span>
                  <input
                    type="checkbox"
                    checked={r.activa}
                    disabled={ocupado}
                    onChange={() => void accion(() => activarRegla(r.id, !r.activa))}
                    className="h-4 w-4 accent-[color:var(--primary)]"
                  />
                  <span className="text-xs text-muted">{r.activa ? 'Activa' : 'Inactiva'}</span>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setEnEdicion(r)
                    setModalAbierto(true)
                  }}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                >
                  Editar
                </button>

                {r.activa && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          'La regla dejará de ejecutarse. Se conserva para explicar los avisos que ya generó. ¿Continuar?',
                        )
                      ) {
                        void accion(() => eliminarRegla(r.id))
                      }
                    }}
                    disabled={ocupado}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[color:var(--status-critical)] hover:bg-surface-2 disabled:opacity-60"
                  >
                    Desactivar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <ModalRegla
        abierto={modalAbierto}
        regla={enEdicion}
        onCerrar={() => setModalAbierto(false)}
        onGuardado={cargar}
      />
    </div>
  )
}
