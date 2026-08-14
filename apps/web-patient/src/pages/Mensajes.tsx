/**
 * Mensajería del paciente — PAC-03.
 *
 * Sondeo cada 5 s pidiendo solo lo posterior al último mensaje que ya
 * tenemos. Es lo que cabe en esta rebanada; el tiempo real llegará con
 * su propia infraestructura.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, enviarMensaje, getConversacion, getMensajes, type Mensaje } from '../lib/api'
import { entrar, initKeycloak } from '../lib/keycloak'
import { NavBar } from '../components/NavBar'

const INTERVALO_MS = 5000

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })
}

function dia(iso: string): string {
  const f = new Date(iso)
  const hoy = new Date()
  const mismoDia = f.toDateString() === hoy.toDateString()
  if (mismoDia) return 'Hoy'
  return f.toLocaleDateString('es-CR', { day: 'numeric', month: 'long' })
}

export function Mensajes() {
  const navegar = useNavigate()
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [profesional, setProfesional] = useState('Tu nutricionista')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sinConversacion, setSinConversacion] = useState(false)

  const fin = useRef<HTMLDivElement>(null)
  const ultimo = useRef<string | null>(null)

  /**
   * Añade solo lo que no teníamos. El sondeo puede repetir un mensaje si
   * dos llegan en el mismo instante, y duplicarlo en pantalla asusta.
   */
  const incorporar = useCallback((nuevos: Mensaje[]) => {
    if (nuevos.length === 0) return
    setMensajes((previos) => {
      const vistos = new Set(previos.map((m) => m.id))
      const añadir = nuevos.filter((m) => !vistos.has(m.id))
      if (añadir.length === 0) return previos
      const todos = [...previos, ...añadir]
      ultimo.current = todos[todos.length - 1]!.createdAt
      return todos
    })
  }, [])

  useEffect(() => {
    let vivo = true
    async function arrancar() {
      try {
        if (!(await initKeycloak())) {
          entrar(`${window.location.origin}/mensajes`)
          return
        }
        const conv = await getConversacion()
        if (!vivo) return
        setProfesional(conv.profesional)
        incorporar(await getMensajes())
      } catch (e) {
        if (!vivo) return
        if (e instanceof ApiError && e.codigo === 'sin_vincular') {
          navegar('/activar', { replace: true })
          return
        }
        if (e instanceof ApiError && e.codigo === 'sin_conversacion') {
          setSinConversacion(true)
        } else {
          setError(e instanceof ApiError ? e.message : 'No hemos podido cargar tus mensajes')
        }
      } finally {
        if (vivo) setCargando(false)
      }
    }
    void arrancar()
    return () => {
      vivo = false
    }
  }, [navegar, incorporar])

  useEffect(() => {
    if (cargando || sinConversacion || error) return
    const id = setInterval(() => {
      getMensajes(ultimo.current ?? undefined)
        .then(incorporar)
        // Un sondeo fallido no molesta al paciente: lo intentará de nuevo
        // en cinco segundos.
        .catch(() => {})
    }, INTERVALO_MS)
    return () => clearInterval(id)
  }, [cargando, sinConversacion, error, incorporar])

  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes])

  async function enviar() {
    const contenido = texto.trim()
    if (contenido === '' || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const m = await enviarMensaje(contenido)
      setTexto('')
      incorporar([m])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo enviar el mensaje')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-primary px-4 pb-4 pt-10 text-white">
        <button
          type="button"
          onClick={() => navegar('/inicio')}
          aria-label="Volver"
          className="opacity-90"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-current" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <div>
          <h1 className="font-semibold">{profesional}</h1>
          <p className="text-xs opacity-90">Tu nutricionista</p>
        </div>
      </header>

      <section className="flex-1 space-y-3 px-4 py-4 pb-44">
        {cargando && <div className="h-20 animate-pulse rounded-lg bg-surface-2" />}

        {sinConversacion && (
          <p className="mx-auto mt-8 max-w-xs text-center text-sm text-muted">
            Todavía no hay una conversación abierta. Tu nutricionista la iniciará.
          </p>
        )}

        {!cargando && !sinConversacion && mensajes.length === 0 && (
          <p className="mx-auto mt-8 max-w-xs text-center text-sm text-muted">
            Aquí verás lo que hables con tu nutricionista. Escribe el primer mensaje.
          </p>
        )}

        {mensajes.map((m, i) => {
          const anterior = mensajes[i - 1]
          const nuevoDia = !anterior || dia(anterior.createdAt) !== dia(m.createdAt)
          const mio = m.autorTipo === 'paciente'
          return (
            <div key={m.id}>
              {nuevoDia && (
                <p className="my-3 text-center text-xs text-muted">{dia(m.createdAt)}</p>
              )}
              <div className={`flex ${mio ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-lg px-4 py-2.5 text-sm leading-relaxed ${
                    mio
                      ? 'bg-primary text-white'
                      : 'border border-border bg-surface text-ink shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.contenido}</p>
                  <p className={`mt-1 text-right text-[10px] ${mio ? 'opacity-70' : 'text-muted'}`}>
                    {hora(m.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          )
        })}

        {error && (
          <p role="alert" className="text-center text-sm" style={{ color: 'var(--status-critical)' }}>
            {error}
          </p>
        )}

        <div ref={fin} />
      </section>

      {!sinConversacion && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface px-3 pb-nav pt-2">
          <div className="flex items-end gap-2">
            <label htmlFor="mensaje" className="sr-only">
              Escribe un mensaje
            </label>
            <textarea
              id="mensaje"
              rows={1}
              value={texto}
              maxLength={4000}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // Enter envía; Mayús+Enter salta de línea. En el móvil el
                // teclado trae su propia tecla de envío.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void enviar()
                }
              }}
              placeholder="Escribe un mensaje…"
              className="max-h-28 flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
            />
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={texto.trim() === '' || enviando}
              aria-label="Enviar mensaje"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-pill bg-primary disabled:opacity-40"
            >
              {enviando ? (
                <span className="h-4 w-4 animate-spin rounded-pill border-2 border-white border-t-transparent" />
              ) : (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-white" strokeWidth={2}>
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}

      <NavBar />
    </main>
  )
}
