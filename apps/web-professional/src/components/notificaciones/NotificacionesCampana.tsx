/**
 * Campana con contador — COM-02.
 *
 * Sondea cada 30 segundos, no cada 5 como el hilo de mensajería: una
 * notificación no es una conversación en curso y enterarse medio minuto
 * después no cambia nada. Multiplicar la frecuencia por seis para eso
 * es carga sin beneficio.
 */
import { useCallback, useEffect, useState } from 'react'
import { getContadorNotificaciones } from '../../api/notificaciones'
import { NotificacionesPanel } from './NotificacionesPanel'

const SONDEO_MS = 30_000

export function NotificacionesCampana() {
  const [noLeidas, setNoLeidas] = useState(0)
  const [abierto, setAbierto] = useState(false)

  const refrescar = useCallback(async (signal?: AbortSignal) => {
    try {
      const { noLeidas: n } = await getContadorNotificaciones(signal)
      if (!signal?.aborted) setNoLeidas(n)
    } catch {
      // Un contador que no llega deja el anterior en pantalla. Poner un
      // error donde va un número sería peor que un número algo viejo.
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void refrescar(ctrl.signal)
    const id = setInterval(() => {
      // Sin sondear con la pestaña oculta: son peticiones que nadie va a
      // ver, y al volver se refresca igualmente.
      if (!document.hidden) void refrescar()
    }, SONDEO_MS)
    return () => {
      ctrl.abort()
      clearInterval(id)
    }
  }, [refrescar])

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-label={
          noLeidas > 0 ? `Notificaciones, ${noLeidas} sin leer` : 'Notificaciones'
        }
        aria-expanded={abierto}
        className="relative rounded-md p-2 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
          focusable="false"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>

        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-pill bg-[color:var(--status-critical)] px-1 text-[10px] font-bold text-white">
            {noLeidas > 99 ? '99+' : noLeidas}
          </span>
        )}
      </button>

      <NotificacionesPanel
        abierto={abierto}
        onCerrar={() => setAbierto(false)}
        onCambio={() => void refrescar()}
      />
    </>
  )
}
