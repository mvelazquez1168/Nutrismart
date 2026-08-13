/**
 * Diálogo modal accesible.
 *
 * Tres cosas que un modal casero suele olvidar y aquí no:
 *  - Escape cierra (salvo mientras se guarda: cerrar a medias dejaría
 *    al usuario sin saber si su cambio se aplicó).
 *  - El foco entra al abrir y vuelve al elemento anterior al cerrar.
 *  - El scroll del fondo se bloquea, para que la página no se mueva
 *    detrás del diálogo.
 */
import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  titulo: string
  descripcion?: string
  abierto: boolean
  onCerrar: () => void
  /** Mientras es true, Escape y el clic en el fondo no cierran. */
  bloqueado?: boolean
  ancho?: 'md' | 'lg'
  children: ReactNode
  pie?: ReactNode
}

export function Modal({
  titulo,
  descripcion,
  abierto,
  onCerrar,
  bloqueado = false,
  ancho = 'lg',
  children,
  pie,
}: Props) {
  const contenedorRef = useRef<HTMLDivElement>(null)
  const focoPrevioRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!abierto) return

    focoPrevioRef.current = document.activeElement as HTMLElement | null

    const primero = contenedorRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button',
    )
    primero?.focus()

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bloqueado) onCerrar()
    }
    document.addEventListener('keydown', alTeclear)

    const overflowPrevio = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', alTeclear)
      document.body.style.overflow = overflowPrevio
      focoPrevioRef.current?.focus()
    }
  }, [abierto, bloqueado, onCerrar])

  if (!abierto) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10"
      onMouseDown={(e) => {
        // Solo cierra si el clic empieza Y termina en el fondo: si no,
        // arrastrar para seleccionar texto dentro del modal lo cerraría.
        if (e.target === e.currentTarget && !bloqueado) onCerrar()
      }}
    >
      <div
        ref={contenedorRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-titulo"
        className={`w-full ${ancho === 'lg' ? 'max-w-2xl' : 'max-w-md'} rounded-lg border border-border bg-surface shadow-lg`}
      >
        <header className="border-b border-border px-6 py-4">
          <h2 id="modal-titulo" className="text-lg font-bold text-ink">
            {titulo}
          </h2>
          {descripcion && <p className="mt-0.5 text-sm text-muted">{descripcion}</p>}
        </header>

        <div className="px-6 py-5">{children}</div>

        {pie && (
          <footer className="flex justify-end gap-3 border-t border-border px-6 py-4">{pie}</footer>
        )}
      </div>
    </div>
  )
}
