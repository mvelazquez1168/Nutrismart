/**
 * Hilo abierto — COM-01.
 *
 * Sondea cada 5 segundos pidiendo solo lo posterior al último mensaje
 * que ya tiene. Es lo bastante vivo para una conversación y no obliga a
 * montar WebSockets, que traerían su propia infraestructura.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError } from '../../api/client'
import {
  MAX_MENSAJE,
  enviarMensaje,
  getMensajes,
  marcarLeida,
  type Conversacion,
  type Mensaje,
} from '../../api/mensajeria'
import { MensajeBurbuja } from './MensajeBurbuja'
import { Avatar } from '../Avatar'

const SONDEO_MS = 5000

export function HiloConversacion({
  conversacion,
  onCambio,
}: {
  conversacion: Conversacion
  /** Avisa a la bandeja de que hay que refrescar la lista lateral. */
  onCambio: () => void
}) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [cargando, setCargando] = useState(true)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finRef = useRef<HTMLDivElement>(null)
  // En una ref y no en el estado: el temporizador del sondeo captura el
  // valor del render en que se creó, y con estado leería siempre el
  // primero.
  const ultimaMarcaRef = useRef<string | null>(null)

  function alFinal(suave = true) {
    finRef.current?.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'end' })
  }

  /* ---- Carga inicial al cambiar de hilo ---- */
  useEffect(() => {
    let cancelado = false
    setCargando(true)
    setMensajes([])
    setError(null)
    ultimaMarcaRef.current = null

    getMensajes(conversacion.id)
      .then(async (lista) => {
        if (cancelado) return
        setMensajes(lista)
        ultimaMarcaRef.current = lista.at(-1)?.createdAt ?? null
        // Abrir el hilo ES leerlo: se marca aquí y no con un botón.
        if (conversacion.noLeidos > 0) {
          await marcarLeida(conversacion.id).catch(() => {})
          onCambio()
        }
      })
      .catch((e: unknown) => {
        if (!cancelado) setError(e instanceof Error ? e.message : 'No se pudo cargar el hilo')
      })
      .finally(() => {
        if (!cancelado) {
          setCargando(false)
          // Sin animación en la primera carga: aparecer ya abajo es lo
          // natural, ver el hilo desplazarse solo, no.
          requestAnimationFrame(() => alFinal(false))
        }
      })

    return () => {
      cancelado = true
    }
  }, [conversacion.id, conversacion.noLeidos, onCambio])

  /* ---- Sondeo ---- */
  const sondear = useCallback(async () => {
    if (document.hidden) return
    try {
      const nuevos = await getMensajes(conversacion.id, ultimaMarcaRef.current)
      if (nuevos.length === 0) return
      ultimaMarcaRef.current = nuevos.at(-1)?.createdAt ?? ultimaMarcaRef.current
      setMensajes((prev) => [...prev, ...nuevos])
      if (nuevos.some((m) => m.autorTipo === 'paciente')) {
        await marcarLeida(conversacion.id).catch(() => {})
        onCambio()
      }
      requestAnimationFrame(() => alFinal())
    } catch {
      // Un sondeo fallido no se reporta: la red va y viene, y un aviso
      // cada cinco segundos sería más molesto que el fallo.
    }
  }, [conversacion.id, onCambio])

  useEffect(() => {
    const id = setInterval(() => void sondear(), SONDEO_MS)
    return () => clearInterval(id)
  }, [sondear])

  async function enviar() {
    const contenido = texto.trim()
    if (contenido === '' || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const creado = await enviarMensaje(conversacion.id, contenido)
      setMensajes((prev) => [...prev, creado])
      ultimaMarcaRef.current = creado.createdAt
      setTexto('')
      onCambio()
      requestAnimationFrame(() => alFinal())
    } catch (e) {
      // El texto NO se borra si falla: reescribirlo sería el castigo por
      // un fallo de red que no cometió quien escribe.
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar el mensaje')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <section className="flex h-[calc(100vh-13rem)] min-h-[24rem] flex-col rounded-lg border border-border bg-surface-2">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3">
        <Avatar nombre={conversacion.paciente.nombre} />
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink">{conversacion.paciente.nombre}</p>
          <Link
            to={`/pacientes/${conversacion.paciente.id}`}
            className="text-xs text-primary hover:underline"
          >
            Ver expediente
          </Link>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {cargando ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-surface" />
            ))}
          </div>
        ) : mensajes.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            Aún no hay mensajes. Escribe el primero.
          </p>
        ) : (
          <ul className="space-y-3">
            {mensajes.map((m) => (
              <MensajeBurbuja key={m.id} mensaje={m} />
            ))}
          </ul>
        )}
        <div ref={finRef} />
      </div>

      {error && (
        <p
          role="alert"
          className="mx-4 mb-2 rounded-md border border-[color:var(--status-critical)] bg-surface p-2 text-xs text-ink"
        >
          {error}
        </p>
      )}

      <div className="border-t border-border bg-surface p-3">
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={texto}
            maxLength={MAX_MENSAJE}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía, Mayús+Enter hace párrafo: es lo que espera
              // quien viene de cualquier otro mensajero.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void enviar()
              }
            }}
            placeholder="Escribe un mensaje…"
            aria-label="Mensaje"
            className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-[color:var(--ring)]"
          />
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando || texto.trim() === ''}
            className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
        {texto.length > MAX_MENSAJE - 200 && (
          <p className="mt-1 text-right text-xs text-muted">
            {texto.length}/{MAX_MENSAJE}
          </p>
        )}
      </div>
    </section>
  )
}
