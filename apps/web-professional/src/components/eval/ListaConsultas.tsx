/**
 * Consultas previas del paciente, en su expediente — EVAL-00.
 *
 * Es la puerta de entrada a la valoración: desde aquí se abre una nueva
 * o se reabre una anterior.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { crearConsulta, getConsultas, type Consulta } from '../../api/valoracion'

export function ListaConsultas({ pacienteId }: { pacienteId: string }) {
  const navigate = useNavigate()
  const [consultas, setConsultas] = useState<Consulta[]>([])
  const [cargando, setCargando] = useState(true)
  const [creando, setCreando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const lista = await getConsultas(pacienteId, signal)
        if (!signal?.aborted) setConsultas(lista)
      } catch (e) {
        if (signal?.aborted) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar las consultas')
      } finally {
        if (!signal?.aborted) setCargando(false)
      }
    },
    [pacienteId],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    void cargar(ctrl.signal)
    return () => ctrl.abort()
  }, [cargar])

  async function nueva() {
    setCreando(true)
    setError(null)
    try {
      const c = await crearConsulta(pacienteId)
      // Se navega directamente: la consulta nace vacía y lo siguiente
      // que toca es medir.
      navigate(`/pacientes/${pacienteId}/valoracion/${c.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo crear la consulta')
      setCreando(false)
    }
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">Valoraciones</h2>
        <button
          type="button"
          onClick={() => void nueva()}
          disabled={creando}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {creando ? 'Creando…' : '+ Nueva consulta'}
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-[color:var(--status-critical)] bg-surface p-2 text-xs text-ink"
        >
          {error}
        </p>
      )}

      {cargando ? (
        <div className="h-16 animate-pulse rounded-md bg-surface-2" />
      ) : consultas.length === 0 ? (
        <p className="text-sm text-muted">Sin valoraciones registradas.</p>
      ) : (
        <ul className="divide-y divide-border">
          {consultas.map((c) => {
            const finalizada = c.estado === 'finalizada'
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">
                    Consulta #{c.numeroConsulta}
                    <span className="ml-2 font-normal text-muted">
                      {c.tipo === 'inicial' ? 'Inicial' : 'Seguimiento'}
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {c.fechaConsulta}
                    {c.profesional ? ` · ${c.profesional}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="rounded-pill px-2 py-0.5 text-xs font-semibold"
                    style={{
                      color: finalizada ? 'var(--status-normal)' : 'var(--status-alert)',
                      backgroundColor: `color-mix(in srgb, ${
                        finalizada ? 'var(--status-normal)' : 'var(--status-alert)'
                      } 14%, transparent)`,
                    }}
                  >
                    {finalizada ? 'Finalizada' : 'En curso'}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(`/pacientes/${pacienteId}/valoracion/${c.id}`)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
                  >
                    {finalizada ? 'Ver' : 'Continuar'}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
