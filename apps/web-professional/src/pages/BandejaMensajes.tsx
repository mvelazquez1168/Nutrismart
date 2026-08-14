/**
 * Bandeja de mensajes — COM-01.
 *
 * Dos paneles: hilos a la izquierda, conversación abierta a la derecha.
 * La lista se refresca cuando el hilo avisa de que algo cambió, no con
 * su propio temporizador: dos sondeos independientes sobre lo mismo se
 * pisan y muestran contadores que no cuadran entre sí.
 */
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  abrirConversacion,
  getConversaciones,
  type Conversacion,
} from '../api/mensajeria'
import { getPacientes } from '../api/pacientes'
import type { Paciente } from '../api/tipos'
import { ConversacionItem } from '../components/mensajeria/ConversacionItem'
import { HiloConversacion } from '../components/mensajeria/HiloConversacion'
import { Modal } from '../components/Modal'
import { claseControl } from '../components/Campo'

export function BandejaMensajes() {
  const [conversaciones, setConversaciones] = useState<Conversacion[]>([])
  const [activaId, setActivaId] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const [nuevoAbierto, setNuevoAbierto] = useState(false)
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [abriendo, setAbriendo] = useState(false)

  const cargar = useCallback(async (signal?: AbortSignal) => {
    try {
      const lista = await getConversaciones(signal)
      if (signal?.aborted) return
      setConversaciones(lista)
      setError(null)
    } catch (e) {
      if (signal?.aborted) return
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las conversaciones')
    } finally {
      if (!signal?.aborted) setCargando(false)
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  // La lista de pacientes solo se pide al abrir el diálogo: en la carga
  // de la bandeja sería una petición que casi nunca se usa.
  useEffect(() => {
    if (!nuevoAbierto) return
    const ctrl = new AbortController()
    getPacientes({}, ctrl.signal)
      .then(setPacientes)
      .catch(() => {})
    return () => ctrl.abort()
  }, [nuevoAbierto])

  const activa = conversaciones.find((c) => c.id === activaId) ?? null

  const filtradas = busqueda.trim()
    ? conversaciones.filter((c) =>
        c.paciente.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
      )
    : conversaciones

  async function abrirCon(pacienteId: string) {
    setAbriendo(true)
    setError(null)
    try {
      const conv = await abrirConversacion(pacienteId)
      await cargar()
      setActivaId(conv.id)
      setNuevoAbierto(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo abrir la conversación')
    } finally {
      setAbriendo(false)
    }
  }

  // Los que ya tienen hilo no se ofrecen otra vez: crearlo devolvería el
  // mismo, y verlos en la lista sugiere que se puede duplicar.
  const conHilo = new Set(conversaciones.map((c) => c.paciente.id))
  const disponibles = pacientes.filter((p) => !conHilo.has(p.id))

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Mensajería</h1>
          <p className="text-sm text-muted">
            Tus conversaciones con pacientes. Cada hilo es privado entre el paciente y tú.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setNuevoAbierto(true)}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
        >
          + Nueva conversación
        </button>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--status-critical)] bg-surface p-3 text-sm text-ink"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <aside className="w-full shrink-0 overflow-hidden rounded-lg border border-border bg-surface lg:w-80">
          <div className="border-b border-border p-3">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar paciente…"
              aria-label="Buscar conversación"
              className={claseControl(false)}
            />
          </div>

          {cargando ? (
            <div className="space-y-2 p-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : filtradas.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              {conversaciones.length === 0
                ? 'Aún no tienes conversaciones.'
                : 'Ningún paciente coincide con la búsqueda.'}
            </p>
          ) : (
            <ul className="max-h-[calc(100vh-16rem)] divide-y divide-border overflow-y-auto">
              {filtradas.map((c) => (
                <ConversacionItem
                  key={c.id}
                  conversacion={c}
                  activa={c.id === activaId}
                  onClick={() => setActivaId(c.id)}
                />
              ))}
            </ul>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          {activa ? (
            <HiloConversacion conversacion={activa} onCambio={() => void cargar()} />
          ) : (
            <p className="rounded-lg border border-border bg-surface p-16 text-center text-sm text-muted">
              Selecciona una conversación o empieza una nueva.
            </p>
          )}
        </div>
      </div>

      <Modal
        abierto={nuevoAbierto}
        titulo="Nueva conversación"
        descripcion="Elige el paciente con quien quieres hablar."
        ancho="md"
        bloqueado={abriendo}
        onCerrar={() => setNuevoAbierto(false)}
      >
        {disponibles.length === 0 ? (
          <p className="text-sm text-muted">
            {pacientes.length === 0
              ? 'No hay pacientes disponibles.'
              : 'Ya tienes una conversación abierta con cada uno de tus pacientes.'}
          </p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {disponibles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={abriendo}
                  onClick={() => void abrirCon(p.id)}
                  className="w-full px-2 py-2.5 text-left text-sm text-ink hover:bg-surface-2 disabled:opacity-60"
                >
                  {p.nombre}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}
