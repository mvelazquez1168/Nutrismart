/**
 * Panel de notificaciones — COM-02.
 *
 * Deslizante desde el borde derecho, como en el diseño: caben avisos de
 * varias líneas sin que el desplegable tape la pantalla entera.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getNotificaciones,
  marcarNotificacionLeida,
  marcarTodasLeidas,
  type Notificacion,
} from '../../api/notificaciones'
import { NotificacionItem } from './NotificacionItem'

export function NotificacionesPanel({
  abierto,
  onCerrar,
  onCambio,
}: {
  abierto: boolean
  onCerrar: () => void
  /** Avisa a la campana de que el contador cambió. */
  onCambio: () => void
}) {
  const navigate = useNavigate()
  const [lista, setLista] = useState<Notificacion[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!abierto) return
    const ctrl = new AbortController()
    setCargando(true)
    getNotificaciones(20, ctrl.signal)
      .then(setLista)
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setCargando(false)
      })
    return () => ctrl.abort()
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alTeclear)
    return () => document.removeEventListener('keydown', alTeclear)
  }, [abierto, onCerrar])

  if (!abierto) return null

  async function abrir(n: Notificacion) {
    if (!n.leida) {
      setLista((prev) => prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x)))
      await marcarNotificacionLeida(n.id).catch(() => {})
      onCambio()
    }
    if (n.enlace) {
      onCerrar()
      // Solo rutas internas: la API ya rechaza cualquier otra cosa, y
      // esto lo confirma antes de navegar.
      if (n.enlace.startsWith('/')) navigate(n.enlace)
    }
  }

  async function leerTodas() {
    setLista((prev) => prev.map((n) => ({ ...n, leida: true })))
    await marcarTodasLeidas().catch(() => {})
    onCambio()
  }

  const sinLeer = lista.filter((n) => !n.leida).length

  return (
    <>
      {/* Fondo que captura el clic fuera. Un listener global sobre
          document cerraría también al pulsar la propia campana, y el
          panel se abriría y cerraría en el mismo gesto. */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onCerrar} aria-hidden="true" />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Notificaciones"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-lg"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-ink">Notificaciones</h2>
            {sinLeer > 0 && (
              <span className="rounded-pill bg-primary-tint px-2 py-0.5 text-xs font-semibold text-primary">
                {sinLeer} nueva{sinLeer === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {sinLeer > 0 && (
              <button
                type="button"
                onClick={() => void leerTodas()}
                className="text-sm font-medium text-primary hover:underline"
              >
                Marcar todo como leído
              </button>
            )}
            <button
              type="button"
              onClick={onCerrar}
              aria-label="Cerrar notificaciones"
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {cargando ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : lista.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-3xl" aria-hidden="true">
                🔔
              </p>
              <p className="mt-2 text-sm font-medium text-ink">Todo al día</p>
              <p className="mt-1 text-sm text-muted">No tienes notificaciones pendientes.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lista.map((n) => (
                <NotificacionItem key={n.id} notificacion={n} onAbrir={(x) => void abrir(x)} />
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  )
}
